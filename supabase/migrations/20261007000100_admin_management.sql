-- =============================================================================
-- Admin management, data corrections & audit (spec §5–7, §13, §63, §66,
-- §69–70, §78–79). Prompt 12.
--
--   * Authority: one rule for every admin write, private.can_administer().
--   * Corrections: domain-specific, validated SECURITY DEFINER functions. They
--     lock the row, check the version the admin saw (stale → 40001) and update
--     the active record. The original is preserved in the audit log (old → new,
--     actor, time, reason) as ADMIN_CORRECTION. There is no generic row editor.
--   * Account status: soft deactivation/activation. The last active super admin
--     is protected.
--   * PIN reset: service role only (admin-users Edge Function), via the
--     existing bcrypt auth_set_pin().
--   * Readers: user list/search (paginated, server-side), account detail, daily
--     nutrition, audit log and dashboard. Admins see everything; managers see
--     only their assigned users; everyone else is refused.
--   * audit_logs is already append-only (…0700); the actor always comes from
--     the session (auth.uid()) or the verified Edge Function caller.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit: the same trigger as before (…0700), plus an explicit ADMIN_CORRECTION
-- marker set by the correction functions in this transaction.
-- -----------------------------------------------------------------------------
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_col text := nullif(tg_argv[0], '');
  v_mode      text := tg_argv[1];
  v_date_col  text := nullif(tg_argv[2], '');
  v_old       jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new       jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row       jsonb := coalesce(v_new, v_old);
  v_owner     uuid := case when v_owner_col is not null then (v_row ->> v_owner_col)::uuid end;
  v_actor     uuid := private.current_actor_id();
  v_old_diff  jsonb;
  v_new_diff  jsonb;
  v_action    public.audit_action;
  v_date      date;
  v_locked    boolean;
begin
  if v_mode = 'foreign' and (v_actor is null or v_actor = v_owner) then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(o.key, o.value) into v_old_diff
    from jsonb_each(v_old) o
    where o.key <> 'updated_at' and (v_new -> o.key) is distinct from o.value;

    if v_old_diff is null then
      return null; -- nothing meaningful changed
    end if;

    select jsonb_object_agg(k, v_new -> k) into v_new_diff from jsonb_object_keys(v_old_diff) k;
  end if;

  v_action := case
    when tg_table_name = 'user_roles' then 'ROLE_CHANGE'
    when tg_op = 'INSERT' then 'CREATE'
    when tg_op = 'DELETE' then 'DELETE'
    when v_old_diff ? 'is_deleted' then
      case when (v_new ->> 'is_deleted')::boolean then 'DELETE' else 'RESTORE' end
    when tg_table_name = 'profiles' and v_old_diff ? 'is_active' then
      case when (v_new ->> 'is_active')::boolean then 'RESTORE' else 'DELETE' end
    when v_old_diff ? 'is_locked' then
      case when (v_new ->> 'is_locked')::boolean then 'LOCK' else 'UNLOCK' end
    else 'UPDATE'
  end::public.audit_action;

  -- A change by someone other than the owner to a locked record is an
  -- admin correction (spec §69).
  if v_action = 'UPDATE' and v_mode = 'foreign' and v_owner is not null then
    v_locked := coalesce((v_old ->> 'is_locked')::boolean, false);
    if v_date_col is not null then
      v_date := (v_old ->> v_date_col)::date;
    elsif tg_table_name = 'meal_items' then
      select m.meal_date, m.is_locked or v_locked into v_date, v_locked
      from public.meals m where m.id = (v_old ->> 'meal_id')::uuid;
    end if;
    if v_locked or v_date < private.user_local_date(v_owner) then
      v_action := 'ADMIN_CORRECTION';
    end if;
  end if;

  -- Admin correction functions mark their updates explicitly (also for records
  -- that are not yet locked).
  if v_action = 'UPDATE' and current_setting('app.audit_action', true) = 'ADMIN_CORRECTION' then
    v_action := 'ADMIN_CORRECTION';
  end if;

  insert into public.audit_logs (
    actor_user_id, target_user_id, entity_type, entity_id, action,
    old_values_json, new_values_json, reason
  ) values (
    v_actor,
    v_owner,
    tg_table_name,
    case when v_row ? 'id' then (v_row ->> 'id')::uuid end,
    v_action,
    case tg_op when 'INSERT' then null when 'DELETE' then v_old else v_old_diff end,
    case tg_op when 'INSERT' then v_new when 'DELETE' then null else v_new_diff end,
    nullif(current_setting('app.audit_reason', true), '')
  );

  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Authority (spec §6).
--   * SUPER_ADMIN: administers anyone else.
--   * ADMIN: administers USER and MANAGER accounts, never ADMIN or
--     SUPER_ADMIN ones ("cannot manage super-admin authority"; managing admins
--     belongs to super admins).
--   * Nobody administers their own account through admin tools.
--   * MANAGER: read-only on assigned users (the existing RLS); no admin writes.
-- -----------------------------------------------------------------------------
create function private.can_administer_as(p_actor uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_actor is not null and p_user is not null and p_actor <> p_user
    and exists (select 1 from public.profiles a where a.id = p_actor and a.is_active)
    and exists (select 1 from public.profiles t where t.id = p_user)
    and (
      private.user_has_role(p_actor, 'SUPER_ADMIN')
      or (
        private.user_has_role(p_actor, 'ADMIN')
        and not private.user_has_role(p_user, 'SUPER_ADMIN')
        and not private.user_has_role(p_user, 'ADMIN')
      )
    ),
    false);
$$;

create function private.can_administer(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_administer_as(auth.uid(), p_user);
$$;

-- Who may look at a user in the admin area: admins (all users) and managers
-- (their assigned users) — the same boundary as the existing RLS.
create function private.can_view_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_admin() or private.is_manager_of(p_user), false);
$$;

-- Every admin write starts here: authority check, then the reason and the
-- ADMIN_CORRECTION marker for the audit rows written in this transaction.
create function private.begin_admin_action(p_user uuid, p_reason text, p_correction boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.can_administer(p_user) then
    raise exception 'You are not allowed to administer this account' using errcode = '42501';
  end if;
  perform set_config('app.audit_reason', coalesce(left(nullif(btrim(p_reason), ''), 500), ''), true);
  perform set_config('app.audit_action', case when p_correction then 'ADMIN_CORRECTION' else '' end, true);
end;
$$;

-- Optimistic concurrency: the record must still be the version the admin saw.
create function private.assert_current_version(p_current timestamptz, p_expected timestamptz)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_expected is null or p_current is distinct from p_expected then
    raise exception 'This record changed since you opened it. Refresh and try again.' using errcode = '40001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Domain-specific corrections (spec §13, §66, §69). No generic row editor:
-- each function takes only the fields of its domain, validates them, locks the
-- row, checks the version the admin saw, and updates the active record. The
-- original values stay in the audit log (old → new, admin, time, reason).
-- Derived values follow through the existing triggers (meal-item snapshots
-- rescale with quantity; training calorie estimates follow type/duration;
-- InBody weight syncs to weight history). Target snapshots and
-- recommendations are never touched. User locking is unchanged: the record
-- stays locked for its owner.
-- -----------------------------------------------------------------------------

-- Meal item: quantity, or the food itself. The snapshot trigger forbids
-- changing an item's food, so a food correction soft-deletes the original item
-- and adds a replacement (both audited); returns the active item's id.
create function public.admin_correct_meal_item(
  p_item_id uuid,
  p_expected_updated_at timestamptz,
  p_quantity numeric,
  p_food_item_id uuid default null,
  p_reason text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.meal_items%rowtype;
  v_new uuid;
begin
  select * into v_item from public.meal_items where id = p_item_id for update;
  if not found or v_item.is_deleted then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  perform private.begin_admin_action(v_item.user_id, p_reason);
  perform private.assert_current_version(v_item.updated_at, p_expected_updated_at);
  if p_quantity is null or p_quantity <= 0 or p_quantity > 100000 then
    raise exception 'Quantity must be greater than 0' using errcode = '22023';
  end if;

  if p_food_item_id is null or p_food_item_id is not distinct from v_item.food_item_id then
    if p_quantity = v_item.quantity then
      raise exception 'Nothing to correct' using errcode = '22023';
    end if;
    update public.meal_items set quantity = p_quantity where id = p_item_id;
    return p_item_id;
  end if;

  if not exists (
    select 1 from public.food_items f
    where f.id = p_food_item_id and not f.is_deleted and f.merged_into_food_id is null
  ) then
    raise exception 'Food is not available' using errcode = '22023';
  end if;
  update public.meal_items
  set is_deleted = true, delete_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Replaced by an admin correction'), 500)
  where id = p_item_id;
  insert into public.meal_items (
    meal_id, user_id, food_item_id, quantity, unit, food_name_snapshot,
    snapshot_calories, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g, snapshot_fiber_g
  ) values (v_item.meal_id, v_item.user_id, p_food_item_id, p_quantity, '', '', 0, 0, 0, 0, 0)
  returning id into v_new;
  return v_new;
end;
$$;

create function public.admin_correct_meal(
  p_meal_id uuid,
  p_expected_updated_at timestamptz,
  p_meal_category public.meal_category,
  p_reason text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_meal public.meals%rowtype;
begin
  select * into v_meal from public.meals where id = p_meal_id for update;
  if not found or v_meal.is_deleted then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  perform private.begin_admin_action(v_meal.user_id, p_reason);
  perform private.assert_current_version(v_meal.updated_at, p_expected_updated_at);
  if p_meal_category is null or p_meal_category is not distinct from v_meal.meal_category then
    raise exception 'Nothing to correct' using errcode = '22023';
  end if;
  update public.meals set meal_category = p_meal_category where id = p_meal_id;
end;
$$;

-- Workout or activity: type, optional name, duration, manual calories (null =
-- use the database estimate, which follows type and duration).
create function public.admin_correct_training(
  p_kind text,
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_type text,
  p_name text,
  p_duration_minutes integer,
  p_manual_calories numeric,
  p_reason text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old record;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if p_kind = 'workout' then
    select user_id, updated_at, is_deleted, workout_type as type, custom_name as name, duration_minutes, manual_calories
      into v_old from public.workouts where id = p_id for update;
  elsif p_kind = 'activity' then
    select user_id, updated_at, is_deleted, activity_type as type, custom_name as name, duration_minutes, manual_calories
      into v_old from public.activities where id = p_id for update;
  else
    raise exception 'Unknown record kind' using errcode = '22023';
  end if;
  if not found or v_old.is_deleted then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  perform private.begin_admin_action(v_old.user_id, p_reason);
  perform private.assert_current_version(v_old.updated_at, p_expected_updated_at);
  if p_duration_minutes is null or p_duration_minutes not between 1 and 1440 then
    raise exception 'Duration must be 1–1,440 minutes' using errcode = '22023';
  end if;
  if p_manual_calories is not null and p_manual_calories not between 0 and 10000 then
    raise exception 'Calories must be 0–10,000' using errcode = '22023';
  end if;
  if (p_type, v_name, p_duration_minutes, p_manual_calories)
     is not distinct from (v_old.type, v_old.name, v_old.duration_minutes, v_old.manual_calories) then
    raise exception 'Nothing to correct' using errcode = '22023';
  end if;
  -- Type, name and CUSTOM rules are the table's own CHECK constraints.
  if p_kind = 'workout' then
    update public.workouts
    set workout_type = p_type, custom_name = v_name, duration_minutes = p_duration_minutes, manual_calories = p_manual_calories
    where id = p_id;
  else
    update public.activities
    set activity_type = p_type, custom_name = v_name, duration_minutes = p_duration_minutes, manual_calories = p_manual_calories
    where id = p_id;
  end if;
end;
$$;

-- A step entry's value (the entry keeps its place in "latest valid entry").
create function public.admin_correct_steps(
  p_entry_id uuid,
  p_expected_updated_at timestamptz,
  p_steps integer,
  p_reason text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_entry public.steps_entries%rowtype;
begin
  select * into v_entry from public.steps_entries where id = p_entry_id for update;
  if not found or v_entry.is_deleted then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  perform private.begin_admin_action(v_entry.user_id, p_reason);
  perform private.assert_current_version(v_entry.updated_at, p_expected_updated_at);
  if p_steps is null or p_steps not between 0 and 200000 then
    raise exception 'Steps must be 0–200,000' using errcode = '22023';
  end if;
  if p_steps = v_entry.steps then
    raise exception 'Nothing to correct' using errcode = '22023';
  end if;
  update public.steps_entries set steps = p_steps where id = p_entry_id;
end;
$$;

-- A manual weight measurement. InBody weights come from the report's metrics
-- and are corrected there.
create function public.admin_correct_weight(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_weight_kg numeric,
  p_reason text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.weight_measurements%rowtype;
begin
  select * into v_row from public.weight_measurements where id = p_id for update;
  if not found or v_row.is_deleted then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  perform private.begin_admin_action(v_row.user_id, p_reason);
  perform private.assert_current_version(v_row.updated_at, p_expected_updated_at);
  if v_row.source <> 'MANUAL' then
    raise exception 'InBody weights are corrected through the InBody metrics' using errcode = '22023';
  end if;
  if p_weight_kg is null or p_weight_kg not between 20 and 400 then
    raise exception 'Weight must be 20–400 kg' using errcode = '22023';
  end if;
  if p_weight_kg = v_row.weight_kg then
    raise exception 'Nothing to correct' using errcode = '22023';
  end if;
  update public.weight_measurements set weight_kg = p_weight_kg where id = p_id;
end;
$$;

-- Structured InBody metrics of a report that already has them (no metrics
-- are ever fabricated for a report without results).
create function public.admin_correct_inbody_metrics(
  p_report_id uuid,
  p_expected_updated_at timestamptz,
  p_weight_kg numeric,
  p_body_fat_percent numeric,
  p_muscle_mass_kg numeric,
  p_bmi numeric,
  p_bmr_kcal integer,
  p_reason text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.inbody_metrics%rowtype;
begin
  select m.* into v_row from public.inbody_metrics m
  join public.inbody_reports r on r.id = m.report_id and not r.is_deleted
  where m.report_id = p_report_id
  for update of m;
  if not found then
    raise exception 'This report has no recorded metrics to correct' using errcode = 'P0002';
  end if;
  perform private.begin_admin_action(v_row.user_id, p_reason);
  perform private.assert_current_version(v_row.updated_at, p_expected_updated_at);
  if (p_weight_kg is not null and p_weight_kg not between 20 and 400)
     or (p_body_fat_percent is not null and p_body_fat_percent not between 0 and 100)
     or (p_muscle_mass_kg is not null and p_muscle_mass_kg not between 0 and 200)
     or (p_bmi is not null and p_bmi not between 5 and 100)
     or (p_bmr_kcal is not null and p_bmr_kcal not between 500 and 5000) then
    raise exception 'A metric is outside its allowed range' using errcode = '22023';
  end if;
  if (p_weight_kg, p_body_fat_percent, p_muscle_mass_kg, p_bmi, p_bmr_kcal)
     is not distinct from (v_row.weight_kg, v_row.body_fat_percent, v_row.muscle_mass_kg, v_row.bmi, v_row.bmr_kcal) then
    raise exception 'Nothing to correct' using errcode = '22023';
  end if;
  update public.inbody_metrics
  set weight_kg = p_weight_kg, body_fat_percent = p_body_fat_percent, muscle_mass_kg = p_muscle_mass_kg,
      bmi = p_bmi, bmr_kcal = p_bmr_kcal
  where id = v_row.id;
end;
$$;

-- Profile fields with the onboarding rules (name 1–100, age 13–100, height
-- 100–250 cm, capacity 2–6). Phone is the login identifier and is not editable.
create function public.admin_correct_profile(
  p_user_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_date_of_birth date,
  p_gender public.gender,
  p_height_cm numeric,
  p_activity_level public.activity_level,
  p_workout_days_per_week integer,
  p_reason text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.profiles%rowtype;
  v_today date;
  v_name text := btrim(coalesce(p_name, ''));
begin
  select * into v_row from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  perform private.begin_admin_action(p_user_id, p_reason);
  perform private.assert_current_version(v_row.updated_at, p_expected_updated_at);
  v_today := (now() at time zone v_row.timezone)::date;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'Name must be 1–100 characters' using errcode = '22023';
  end if;
  if p_date_of_birth is null
     or p_date_of_birth > (v_today - interval '13 years')::date
     or p_date_of_birth <= (v_today - interval '101 years')::date then
    raise exception 'Age must be 13–100' using errcode = '22023';
  end if;
  if p_gender is null then
    raise exception 'Gender is required' using errcode = '22023';
  end if;
  if p_height_cm is null or p_height_cm not between 100 and 250 then
    raise exception 'Height must be 100–250 cm' using errcode = '22023';
  end if;
  if p_workout_days_per_week is not null and p_workout_days_per_week not between 2 and 6 then
    raise exception 'Workout capacity must be 2–6 days per week' using errcode = '22023';
  end if;
  if (v_name, p_date_of_birth, p_gender, p_height_cm, p_activity_level, p_workout_days_per_week)
     is not distinct from (v_row.name, v_row.date_of_birth, v_row.gender, v_row.height_cm, v_row.activity_level, v_row.workout_days_per_week) then
    raise exception 'Nothing to correct' using errcode = '22023';
  end if;
  update public.profiles
  set name = v_name, date_of_birth = p_date_of_birth, gender = p_gender, height_cm = p_height_cm,
      activity_level = p_activity_level, workout_days_per_week = p_workout_days_per_week
  where id = p_user_id;
end;
$$;

-- Soft deletion by an admin (spec §70): the record is kept, flagged deleted and
-- excluded from analytics; who, when and why are recorded.
create function public.admin_delete_record(
  p_domain text,
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_reason text default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_updated timestamptz;
  v_deleted boolean;
  v_source public.measurement_source;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'Deleted by an admin'), 500);
begin
  case p_domain
    when 'meal' then select user_id, updated_at, is_deleted into v_user, v_updated, v_deleted from public.meals where id = p_id for update;
    when 'meal_item' then select user_id, updated_at, is_deleted into v_user, v_updated, v_deleted from public.meal_items where id = p_id for update;
    when 'workout' then select user_id, updated_at, is_deleted into v_user, v_updated, v_deleted from public.workouts where id = p_id for update;
    when 'activity' then select user_id, updated_at, is_deleted into v_user, v_updated, v_deleted from public.activities where id = p_id for update;
    when 'steps' then select user_id, updated_at, is_deleted into v_user, v_updated, v_deleted from public.steps_entries where id = p_id for update;
    when 'weight' then
      select user_id, updated_at, is_deleted, source into v_user, v_updated, v_deleted, v_source
      from public.weight_measurements where id = p_id for update;
    else raise exception 'This record type cannot be deleted here' using errcode = '22023';
  end case;
  if v_user is null or v_deleted then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  perform private.begin_admin_action(v_user, p_reason, false);
  perform private.assert_current_version(v_updated, p_expected_updated_at);
  if v_source = 'INBODY' then
    raise exception 'InBody weights are corrected through the InBody metrics' using errcode = '22023';
  end if;
  case p_domain
    when 'meal' then update public.meals set is_deleted = true, delete_reason = v_reason where id = p_id;
    when 'meal_item' then update public.meal_items set is_deleted = true, delete_reason = v_reason where id = p_id;
    when 'workout' then update public.workouts set is_deleted = true, delete_reason = v_reason where id = p_id;
    when 'activity' then update public.activities set is_deleted = true, delete_reason = v_reason where id = p_id;
    when 'steps' then update public.steps_entries set is_deleted = true, delete_reason = v_reason where id = p_id;
    else update public.weight_measurements set is_deleted = true, delete_reason = v_reason where id = p_id;
  end case;
end;
$$;

-- -----------------------------------------------------------------------------
-- Account status (spec §7): soft deactivation, never deletion. Access ends at
-- once (RLS requires an active profile; PIN login refuses a disabled account).
-- The last active super admin can never be deactivated.
-- -----------------------------------------------------------------------------
create function public.admin_set_user_active(p_user_id uuid, p_active boolean, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  if p_active is null then
    raise exception 'Choose activate or deactivate' using errcode = '22023';
  end if;
  perform private.begin_admin_action(p_user_id, p_reason, false);
  select is_active into v_active from public.profiles where id = p_user_id for update;
  if v_active = p_active then
    raise exception 'The account is already %', case when p_active then 'active' else 'inactive' end using errcode = '22023';
  end if;
  if not p_active and private.user_has_role(p_user_id, 'SUPER_ADMIN') and not exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.role = 'SUPER_ADMIN' and p.is_active and r.user_id <> p_user_id
  ) then
    raise exception 'Cannot deactivate the last active super admin' using errcode = '42501';
  end if;
  update public.profiles set is_active = p_active where id = p_user_id;
end;
$$;

-- PIN reset (spec §5) for the admin-users Edge Function (service role): the
-- actor comes from the verified session, the authority rule is re-checked
-- here, and the existing bcrypt auth_set_pin() stores and audits it
-- (PIN_RESET, never any PIN material).
create function public.admin_reset_pin(p_actor_id uuid, p_user_id uuid, p_pin text, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.can_administer_as(p_actor_id, p_user_id) then
    raise exception 'You are not allowed to administer this account' using errcode = '42501';
  end if;
  perform set_config('app.audit_reason', coalesce(left(nullif(btrim(p_reason), ''), 500), ''), true);
  perform set_config('app.actor_id', p_actor_id::text, true);
  perform public.auth_set_pin(p_user_id, p_pin, p_actor_id);
end;
$$;

-- Which global role an actor may give a new account: ADMIN → USER / MANAGER;
-- SUPER_ADMIN → also ADMIN. SUPER_ADMIN is never granted from the admin UI.
create function public.admin_can_create_role(p_actor_id uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (select 1 from public.profiles a where a.id = p_actor_id and a.is_active)
    and case p_role
      when 'USER' then private.user_has_role(p_actor_id, 'ADMIN') or private.user_has_role(p_actor_id, 'SUPER_ADMIN')
      when 'MANAGER' then private.user_has_role(p_actor_id, 'ADMIN') or private.user_has_role(p_actor_id, 'SUPER_ADMIN')
      when 'ADMIN' then private.user_has_role(p_actor_id, 'SUPER_ADMIN')
      else false
    end,
    false);
$$;

-- -----------------------------------------------------------------------------
-- Admin readers. Admins see every user; managers only their assigned users;
-- anyone else is refused. No PIN material or auth data is ever returned.
-- -----------------------------------------------------------------------------
create function private.user_missing_fields(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when p.name is null then 'name' end,
    case when p.date_of_birth is null then 'date_of_birth' end,
    case when p.gender is null then 'gender' end,
    case when p.height_cm is null then 'height_cm' end,
    case when not exists (select 1 from public.weight_measurements w where w.user_id = p.id and not w.is_deleted)
         then 'current_weight' end
  ], null)
  from public.profiles p where p.id = p_user;
$$;

create function private.user_last_activity(p_user uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select max(meal_date) from public.meals where user_id = p_user and not is_deleted),
    (select max(workout_date) from public.workouts where user_id = p_user and not is_deleted),
    (select max(activity_date) from public.activities where user_id = p_user and not is_deleted),
    (select max(entry_date) from public.steps_entries where user_id = p_user and not is_deleted),
    (select max(measurement_date) from public.weight_measurements where user_id = p_user and not is_deleted)
  );
$$;

-- IN_REVIEW / ACTIVE / NONE for the recommendation covering the user's today.
create function private.user_recommendation_status(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when c.status = 'IN_REVIEW' and private.user_local_date(p_user) <= c.review_deadline
                then 'IN_REVIEW' else 'ACTIVE' end
    from public.recommendation_cycles c
    where c.user_id = p_user and c.status <> 'REPLACED'
      and c.period_start <= private.user_local_date(p_user)
      and (c.period_end is null or c.period_end >= private.user_local_date(p_user))
    order by c.period_start desc
    limit 1
  ), 'NONE');
$$;

create function public.admin_list_users(
  p_search text default null,
  p_role public.app_role default null,
  p_active boolean default null,
  p_complete boolean default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  user_id               uuid,
  name                  text,
  phone                 text,
  roles                 public.app_role[],
  is_active             boolean,
  is_profile_complete   boolean,
  missing_fields        text[],
  recommendation_status text,
  last_activity         date,
  created_at            timestamptz,
  total_count           bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
begin
  if not (private.is_admin() or private.has_role('MANAGER')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  with scoped as (
    select p.id, p.name, p.phone, p.is_active, p.created_at,
           coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = p.id), '{}') as roles,
           private.user_missing_fields(p.id) as missing
    from public.profiles p
    where (private.is_admin() or private.is_manager_of(p.id))
      and (v_text is null or p.name ilike '%' || v_text || '%' or (v_digits is not null and p.phone like '%' || v_digits || '%'))
      and (p_active is null or p.is_active = p_active)
  ), filtered as (
    select s.* from scoped s
    where (p_role is null or p_role = any (s.roles))
      and (p_complete is null or (cardinality(s.missing) = 0) = p_complete)
  )
  select f.id, f.name, f.phone, f.roles, f.is_active, cardinality(f.missing) = 0, f.missing,
         private.user_recommendation_status(f.id), private.user_last_activity(f.id), f.created_at,
         count(*) over ()
  from filtered f
  order by f.name nulls last, f.created_at, f.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create function public.admin_user_account(p_user_id uuid)
returns table (
  user_id               uuid,
  name                  text,
  phone                 text,
  roles                 public.app_role[],
  is_active             boolean,
  created_at            timestamptz,
  updated_at            timestamptz,
  deactivated_at        timestamptz,
  deactivated_by_name   text,
  timezone              text,
  date_of_birth         date,
  gender                public.gender,
  height_cm             numeric,
  activity_level        public.activity_level,
  job                   text,
  hobbies               text,
  workout_days_per_week smallint,
  missing_fields        text[],
  recommendation_status text,
  last_activity         date,
  can_administer        boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_view_user(p_user_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select p.id, p.name, p.phone,
         coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = p.id), '{}'),
         p.is_active, p.created_at, p.updated_at, p.deleted_at,
         (select d.name from public.profiles d where d.id = p.deactivated_by),
         p.timezone, p.date_of_birth, p.gender, p.height_cm, p.activity_level, p.job, p.hobbies,
         p.workout_days_per_week, private.user_missing_fields(p.id), private.user_recommendation_status(p.id),
         private.user_last_activity(p.id), private.can_administer(p.id)
  from public.profiles p
  where p.id = p_user_id;
end;
$$;

-- Daily totals for a viewed user (the same aggregation as daily_nutrition).
create function public.admin_daily_nutrition(p_user_id uuid, p_start date, p_end date)
returns table (
  nutrition_date date,
  calories       numeric,
  protein_g      numeric,
  carbs_g        numeric,
  fat_g          numeric,
  fiber_g        numeric,
  item_count     integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_view_user(p_user_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'A valid date range is required' using errcode = '22023';
  end if;
  return query select * from public.recommendation_daily_nutrition(p_user_id, p_start, p_end);
end;
$$;

-- Audit history (spec §63), admins only, newest first, filtered server-side.
-- PIN rows never carry PIN material (auth_set_pin writes none).
create function public.admin_audit_log(
  p_from date default null,
  p_to date default null,
  p_action public.audit_action default null,
  p_entity text default null,
  p_actor_search text default null,
  p_target_search text default null,
  p_target_user_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  id              uuid,
  created_at      timestamptz,
  actor_user_id   uuid,
  actor_name      text,
  target_user_id  uuid,
  target_name     text,
  entity_type     text,
  entity_id       uuid,
  action          public.audit_action,
  reason          text,
  old_values_json jsonb,
  new_values_json jsonb,
  total_count     bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select p.timezone into v_tz from public.profiles p where p.id = auth.uid();
  return query
  select a.id, a.created_at, a.actor_user_id, ac.name, a.target_user_id, tg.name, a.entity_type, a.entity_id,
         a.action, a.reason, a.old_values_json - 'pin_hash', a.new_values_json - 'pin_hash', count(*) over ()
  from public.audit_logs a
  left join public.profiles ac on ac.id = a.actor_user_id
  left join public.profiles tg on tg.id = a.target_user_id
  where (p_from is null or (a.created_at at time zone coalesce(v_tz, 'UTC'))::date >= p_from)
    and (p_to is null or (a.created_at at time zone coalesce(v_tz, 'UTC'))::date <= p_to)
    and (p_action is null or a.action = p_action)
    and (p_entity is null or a.entity_type = p_entity)
    and (p_target_user_id is null or a.target_user_id = p_target_user_id)
    and (nullif(btrim(coalesce(p_actor_search, '')), '') is null or ac.name ilike '%' || btrim(p_actor_search) || '%')
    and (nullif(btrim(coalesce(p_target_search, '')), '') is null or tg.name ilike '%' || btrim(p_target_search) || '%')
  order by a.created_at desc, a.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Admin dashboard indicators (spec §78), from existing data only.
create function public.admin_dashboard()
returns table (
  active_users               bigint,
  inactive_users             bigint,
  incomplete_profiles        bigint,
  recommendations_in_review  bigint,
  recommendations_pending    bigint,
  recommendation_failures    bigint,
  active_groups              bigint,
  food_submissions_pending   bigint,
  ai_spend                   numeric,
  ai_budget                  numeric,
  ai_currency                text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date;
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_month := date_trunc('month', coalesce(private.user_local_date(auth.uid()), current_date))::date;
  return query
  select
    (select count(*) from public.profiles where is_active),
    (select count(*) from public.profiles where not is_active),
    (select count(*) from public.profile_readiness where not is_profile_complete),
    (select count(*) from public.profiles p where p.is_active and private.user_recommendation_status(p.id) = 'IN_REVIEW'),
    (select count(*) from public.recommendation_processing_users where status in ('PENDING', 'PROCESSING')),
    (select count(*) from private.recommendation_states() s where s.state = 'FAILED'),
    (select count(*) from public.groups where is_active),
    (select count(*) from public.food_submissions where status = 'PENDING_REVIEW'),
    (select s.spent from private.ai_month_spend(v_month) s),
    (select case when jsonb_typeof(value_json) = 'number' then (value_json::text)::numeric end
     from public.system_settings where key = 'ai_monthly_budget'),
    coalesce((select value_json #>> '{}' from public.system_settings where key = 'ai_budget_currency'), 'INR');
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  private.can_administer_as(uuid, uuid), private.can_administer(uuid), private.can_view_user(uuid),
  private.begin_admin_action(uuid, text, boolean), private.assert_current_version(timestamptz, timestamptz),
  private.user_missing_fields(uuid), private.user_last_activity(uuid), private.user_recommendation_status(uuid)
from public, anon;
grant execute on function
  private.can_administer_as(uuid, uuid), private.can_administer(uuid), private.can_view_user(uuid),
  private.begin_admin_action(uuid, text, boolean), private.assert_current_version(timestamptz, timestamptz),
  private.user_missing_fields(uuid), private.user_last_activity(uuid), private.user_recommendation_status(uuid)
to authenticated, service_role;

revoke all on function
  public.admin_correct_meal_item(uuid, timestamptz, numeric, uuid, text),
  public.admin_correct_meal(uuid, timestamptz, public.meal_category, text),
  public.admin_correct_training(text, uuid, timestamptz, text, text, integer, numeric, text),
  public.admin_correct_steps(uuid, timestamptz, integer, text),
  public.admin_correct_weight(uuid, timestamptz, numeric, text),
  public.admin_correct_inbody_metrics(uuid, timestamptz, numeric, numeric, numeric, numeric, integer, text),
  public.admin_correct_profile(uuid, timestamptz, text, date, public.gender, numeric, public.activity_level, integer, text),
  public.admin_delete_record(text, uuid, timestamptz, text),
  public.admin_set_user_active(uuid, boolean, text),
  public.admin_list_users(text, public.app_role, boolean, boolean, integer, integer),
  public.admin_user_account(uuid),
  public.admin_daily_nutrition(uuid, date, date),
  public.admin_audit_log(date, date, public.audit_action, text, text, text, uuid, integer, integer),
  public.admin_dashboard(),
  public.admin_reset_pin(uuid, uuid, text, text),
  public.admin_can_create_role(uuid, public.app_role)
from public, anon;
grant execute on function
  public.admin_correct_meal_item(uuid, timestamptz, numeric, uuid, text),
  public.admin_correct_meal(uuid, timestamptz, public.meal_category, text),
  public.admin_correct_training(text, uuid, timestamptz, text, text, integer, numeric, text),
  public.admin_correct_steps(uuid, timestamptz, integer, text),
  public.admin_correct_weight(uuid, timestamptz, numeric, text),
  public.admin_correct_inbody_metrics(uuid, timestamptz, numeric, numeric, numeric, numeric, integer, text),
  public.admin_correct_profile(uuid, timestamptz, text, date, public.gender, numeric, public.activity_level, integer, text),
  public.admin_delete_record(text, uuid, timestamptz, text),
  public.admin_set_user_active(uuid, boolean, text),
  public.admin_list_users(text, public.app_role, boolean, boolean, integer, integer),
  public.admin_user_account(uuid),
  public.admin_daily_nutrition(uuid, date, date),
  public.admin_audit_log(date, date, public.audit_action, text, text, text, uuid, integer, integer),
  public.admin_dashboard()
to authenticated;
-- PIN reset and create-user authorization run only in the admin-users Edge Function.
revoke execute on function public.admin_reset_pin(uuid, uuid, text, text), public.admin_can_create_role(uuid, public.app_role)
from authenticated;
grant execute on function public.admin_reset_pin(uuid, uuid, text, text), public.admin_can_create_role(uuid, public.app_role)
to service_role;
