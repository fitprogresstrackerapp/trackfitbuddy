-- =============================================================================
-- Workout & activity logging (Phase 1 Workout feature):
--   * optional name for predefined workout/activity types (still required for
--     CUSTOM)
--   * calorie estimates computed by the database from configurable per-type
--     rates (system_settings.training_calorie_rates) and stored at log time
--   * log_workout() / log_activity() — create a record for today, or a missing
--     past day through the same narrowly-scoped late-entry grant as log_meal()
--   * training_calorie_rates() — read-only rates for the client-side preview
--
-- Locking is NOT weakened: existing past records stay non-editable and
-- non-deletable for users. See docs/workout.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Names: a predefined type may carry an optional name ("Push Strength");
-- CUSTOM still requires one.
-- -----------------------------------------------------------------------------
alter table public.workouts drop constraint workouts_custom_name_required;
alter table public.workouts add constraint workouts_custom_name_required
  check (workout_type <> 'CUSTOM' or custom_name is not null);

alter table public.activities drop constraint activities_custom_name_required;
alter table public.activities add constraint activities_custom_name_required
  check (activity_type <> 'CUSTOM' or custom_name is not null);

-- -----------------------------------------------------------------------------
-- Calorie rates (spec §15: "configurable estimation system"). kcal per minute,
-- per kind and type, with a "default" for types not listed. Deliberately
-- simple: duration × rate, no body-weight or physiology model.
-- -----------------------------------------------------------------------------
create function private.training_rates_valid(p_rates jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_rates) = 'object'
    and (
      select bool_and(
        jsonb_typeof(p_rates -> kind) = 'object'
        and jsonb_typeof(p_rates -> kind -> 'default') = 'number'
        and not exists (
          select 1 from jsonb_each(p_rates -> kind) r
          where jsonb_typeof(r.value) <> 'number'
             or (r.value::text)::numeric < 0
             or (r.value::text)::numeric > 30
        )
      )
      from unnest(array['workout', 'activity']) as kind
    );
$$;

-- Same as before, plus the training_calorie_rates case.
create or replace function private.validate_system_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := new.value_json;
begin
  case new.key
    when 'nutrition_tolerance' then
      -- spec §27: admin can configure 80 / 85 / 90 %
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not in (0.80, 0.85, 0.90) then
        raise exception 'nutrition_tolerance must be one of 0.80, 0.85, 0.90' using errcode = '22023';
      end if;
    when 'calorie_lower_tolerance' then
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0.50 and 1.00 then
        raise exception 'calorie_lower_tolerance must be a number between 0.50 and 1.00' using errcode = '22023';
      end if;
    when 'calorie_upper_tolerance' then
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 1.00 and 2.00 then
        raise exception 'calorie_upper_tolerance must be a number between 1.00 and 2.00' using errcode = '22023';
      end if;
    when 'ai_monthly_budget' then
      if jsonb_typeof(v) not in ('number', 'null') or (jsonb_typeof(v) = 'number' and (v::text)::numeric < 0) then
        raise exception 'ai_monthly_budget must be null or a non-negative number' using errcode = '22023';
      end if;
    when 'ai_batch_size' then
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric)
         or (v::text)::numeric not between 1 and 100 then
        raise exception 'ai_batch_size must be an integer between 1 and 100' using errcode = '22023';
      end if;
    when 'recommendation_processing_day' then
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric)
         or (v::text)::numeric not between 1 and 28 then
        raise exception 'recommendation_processing_day must be an integer between 1 and 28' using errcode = '22023';
      end if;
    when 'ai_provider', 'ai_model' then
      if jsonb_typeof(v) not in ('string', 'null') then
        raise exception '% must be a string or null', new.key using errcode = '22023';
      end if;
    when 'ai_budget_currency' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[A-Z]{3}$' then
        raise exception 'ai_budget_currency must be an ISO 4217 code' using errcode = '22023';
      end if;
    when 'training_calorie_rates' then
      if not coalesce(private.training_rates_valid(v), false) then
        raise exception 'training_calorie_rates needs workout and activity objects with a numeric default; rates are kcal/min between 0 and 30'
          using errcode = '22023';
      end if;
    else
      null; -- unknown keys are allowed but unvalidated
  end case;

  new.updated_at := now();
  new.updated_by := private.current_actor_id();
  return new;
end;
$$;

insert into public.system_settings (key, value_json, description) values (
  'training_calorie_rates',
  '{
    "workout":  { "default": 6, "HIIT": 10, "CARDIO": 8, "ATHLETIC_PERFORMANCE": 8 },
    "activity": { "default": 5, "WALKING": 4, "RUNNING": 10, "CYCLING": 7, "TREADMILL": 8,
                  "CRICKET": 5, "BADMINTON": 6, "SWIMMING": 8, "FOOTBALL": 8,
                  "BASKETBALL": 8, "HIKING_TREKKING": 6 }
  }',
  'Approximate kcal per minute used to estimate workout/activity calories (duration × rate). Stored per record at log time.'
);

-- The rate in force for a kind/type; built-in defaults if the setting is missing.
create function private.training_calorie_rate(p_kind text, p_type text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (s.value_json -> p_kind ->> p_type)::numeric,
    (s.value_json -> p_kind ->> 'default')::numeric,
    case p_kind when 'workout' then 6 else 5 end
  )
  from (select 1) as one
  left join public.system_settings s on s.key = 'training_calorie_rates';
$$;

revoke all on function private.training_calorie_rate(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Estimate maintenance (tg_argv[0] = 'workout' | 'activity').
--   INSERT by a user: estimated_calories = round(duration × rate, 1); any
--          client value is ignored.
--   UPDATE: recomputed only when duration or type changes; otherwise the stored
--          estimate is kept, so later rate changes never rewrite history.
--   Admins / trusted server code may set the estimate directly (corrections).
-- The displayed value is final_calories = coalesce(manual, estimated).
-- -----------------------------------------------------------------------------
create function private.estimate_training_calories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind     text := tg_argv[0];
  v_type     text;
  v_old_type text;
  v_admin    boolean := auth.uid() is null or private.is_admin();
begin
  if v_kind = 'workout' then
    v_type := new.workout_type;
    v_old_type := case when tg_op = 'UPDATE' then old.workout_type end;
  else
    v_type := new.activity_type;
    v_old_type := case when tg_op = 'UPDATE' then old.activity_type end;
  end if;

  if tg_op = 'INSERT' then
    if not v_admin or new.estimated_calories is null then
      new.estimated_calories := round(new.duration_minutes * private.training_calorie_rate(v_kind, v_type), 1);
    end if;
    return new;
  end if;

  if new.duration_minutes is distinct from old.duration_minutes or v_type is distinct from v_old_type then
    if not v_admin or new.estimated_calories is not distinct from old.estimated_calories then
      new.estimated_calories := round(new.duration_minutes * private.training_calorie_rate(v_kind, v_type), 1);
    end if;
  elsif not v_admin then
    new.estimated_calories := old.estimated_calories;
  end if;
  return new;
end;
$$;

revoke all on function private.training_rates_valid(jsonb) from public, anon, authenticated;
revoke all on function private.estimate_training_calories() from public, anon, authenticated;

create trigger workouts_estimate_calories before insert or update on public.workouts
  for each row execute function private.estimate_training_calories('workout');
create trigger activities_estimate_calories before insert or update on public.activities
  for each row execute function private.estimate_training_calories('activity');

-- Read-only rates for the client's live preview (not sensitive; the stored
-- value is always computed by the trigger above).
create function public.training_calorie_rates()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workout', coalesce(s.value_json -> 'workout', '{"default": 6}'::jsonb),
    'activity', coalesce(s.value_json -> 'activity', '{"default": 5}'::jsonb)
  )
  from (select 1) as one
  left join public.system_settings s on s.key = 'training_calorie_rates';
$$;

-- -----------------------------------------------------------------------------
-- Late entry for workouts and activities: the grant now names the table it is
-- for, so a grant written by log_workout() can only admit a workout (and one
-- written by log_meal() only a meal and that meal's items).
-- -----------------------------------------------------------------------------
alter table private.late_entry_grants
  add column record_table text not null default 'meals'
  constraint late_entry_grants_table_valid check (record_table in ('meals', 'workouts', 'activities'));

create or replace function private.late_entry_granted(
  p_user_id uuid,
  p_date date,
  p_meal_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.late_entry_grants g
    where g.txid = txid_current()
      and g.user_id = p_user_id
      and g.meal_date = p_date
      and g.record_table = 'meals'
      and g.meal_id is not distinct from p_meal_id
  );
$$;

create function private.training_late_entry_granted(
  p_table text,
  p_user_id uuid,
  p_date date
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.late_entry_grants g
    where g.txid = txid_current()
      and g.user_id = p_user_id
      and g.meal_date = p_date
      and g.record_table = p_table
  );
$$;

revoke all on function private.late_entry_granted(uuid, date, uuid) from public, anon, authenticated;
revoke all on function private.training_late_entry_granted(text, uuid, date) from public, anon, authenticated;

-- Record guard — identical to the previous version except that the INSERT rule
-- also admits a past-dated workout/activity created inside log_workout() /
-- log_activity().
create or replace function private.guard_user_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date_col   text := nullif(tg_argv[0], '');
  v_apply_lock boolean := tg_argv[1] = 'lock';
  v_actor      uuid := private.current_actor_id();
  v_old        jsonb;
  v_new        jsonb;
  v_patch      jsonb := '{}';
  v_date       date;
  v_old_date   date;
  v_locked     boolean := false;
  v_today      date;
  v_owner      uuid;
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null then
      raise exception 'Records cannot be hard-deleted; use soft deletion' using errcode = '42501';
    end if;
    return old;
  end if;

  v_new := to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    if (v_new -> 'user_id') is distinct from (v_old -> 'user_id')
       or (v_new -> 'created_at') is distinct from (v_old -> 'created_at')
       or (v_new -> 'created_by') is distinct from (v_old -> 'created_by')
       or (v_new -> 'meal_id') is distinct from (v_old -> 'meal_id') then
      raise exception 'Ownership and creation fields are immutable' using errcode = '42501';
    end if;
  elsif v_new ? 'created_by' then
    v_patch := v_patch || jsonb_build_object('created_by', v_actor);
  end if;

  -- Soft-delete bookkeeping.
  if v_new ? 'is_deleted' then
    if (v_new ->> 'is_deleted')::boolean
       and (tg_op = 'INSERT' or not (v_old ->> 'is_deleted')::boolean) then
      v_patch := v_patch || jsonb_build_object(
        'deleted_at', coalesce(v_new ->> 'deleted_at', now()::text),
        'deleted_by', coalesce(v_new ->> 'deleted_by', v_actor::text)
      );
      if v_new ? 'is_active' then
        v_patch := v_patch || jsonb_build_object('is_active', false); -- steps: a deleted entry is never active
      end if;
    elsif tg_op = 'UPDATE' and not (v_new ->> 'is_deleted')::boolean and (v_old ->> 'is_deleted')::boolean then
      v_patch := v_patch || jsonb_build_object('deleted_at', null, 'deleted_by', null, 'delete_reason', null);
    end if;
  end if;

  -- Lock bookkeeping.
  if v_new ? 'is_locked' then
    if (v_new ->> 'is_locked')::boolean and (tg_op = 'INSERT' or not (v_old ->> 'is_locked')::boolean) then
      v_patch := v_patch || jsonb_build_object('locked_at', coalesce(v_new ->> 'locked_at', now()::text));
    elsif not (v_new ->> 'is_locked')::boolean then
      v_patch := v_patch || jsonb_build_object('locked_at', null);
    end if;
  end if;

  -- Lock enforcement for normal users only.
  if v_apply_lock and pg_trigger_depth() = 1 and auth.uid() is not null and not private.is_admin() then
    if v_date_col is null then
      -- meal_items: the parent meal carries date and lock state.
      select m.meal_date, m.is_locked or m.is_deleted into v_date, v_locked
      from public.meals m where m.id = (v_new ->> 'meal_id')::uuid;
      v_old_date := v_date;
    else
      v_date := (v_new ->> v_date_col)::date;
      v_old_date := coalesce((v_old ->> v_date_col)::date, v_date);
    end if;

    v_owner := (v_new ->> 'user_id')::uuid;
    v_today := private.user_local_date(v_owner);

    if tg_op = 'INSERT' then
      if v_date is null or v_date > v_today or v_locked then
        raise exception 'Records can only be created for today (%)', v_today using errcode = '42501';
      end if;
      if v_date < v_today and not (
        (tg_table_name = 'meals' and private.late_entry_granted(v_owner, v_date, null))
        or (tg_table_name = 'meal_items'
            and private.late_entry_granted(v_owner, v_date, (v_new ->> 'meal_id')::uuid))
        or (tg_table_name in ('workouts', 'activities')
            and private.training_late_entry_granted(tg_table_name, v_owner, v_date))
      ) then
        raise exception 'Records can only be created for today (%)', v_today using errcode = '42501';
      end if;
      if coalesce((v_new ->> 'is_locked')::boolean, false) or coalesce((v_new ->> 'is_deleted')::boolean, false) then
        raise exception 'New records cannot be created locked or deleted' using errcode = '42501';
      end if;
    else
      if v_locked or coalesce((v_old ->> 'is_locked')::boolean, false) or v_old_date < v_today then
        raise exception 'Record is locked and can no longer be changed' using errcode = '42501';
      end if;
      if v_date is distinct from v_old_date then
        raise exception 'The record date cannot be changed' using errcode = '42501';
      end if;
      if (v_new -> 'is_locked') is distinct from (v_old -> 'is_locked') then
        raise exception 'Lock state is managed by the system' using errcode = '42501';
      end if;
      if (v_old ->> 'is_deleted')::boolean and not (v_new ->> 'is_deleted')::boolean then
        raise exception 'Deleted records can only be restored by an admin' using errcode = '42501';
      end if;
      if (v_new -> 'is_active') is distinct from (v_old -> 'is_active')
         and not (v_new ->> 'is_deleted')::boolean then
        raise exception 'The active step entry is managed by the system' using errcode = '42501';
      end if;
    end if;
  end if;

  if v_patch <> '{}' then
    new := jsonb_populate_record(new, v_patch);
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- log_workout / log_activity — create one record for today, or for a missing
-- past day (≤ 90 days, the same window as log_meal). The estimate is computed
-- by the trigger; the client sends only type, name, duration and an optional
-- manual calorie value. SECURITY DEFINER only to write the one-shot grant.
-- -----------------------------------------------------------------------------
create function private.check_training_date(p_user uuid, p_date date)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  c_late_entry_days constant integer := 90;
  v_today date := private.user_local_date(p_user);
begin
  if p_date is null then
    raise exception 'A date is required' using errcode = '22023';
  end if;
  if p_date > v_today then
    raise exception 'Training cannot be logged for a future date' using errcode = '22023';
  end if;
  if p_date < v_today - c_late_entry_days then
    raise exception 'Missing training can be added for the last % days only', c_late_entry_days
      using errcode = '22023';
  end if;
  return p_date < v_today; -- true = late entry
end;
$$;

revoke all on function private.check_training_date(uuid, date) from public, anon, authenticated;

create function public.log_workout(
  p_date date,
  p_type text,
  p_duration_minutes integer,
  p_name text default null,
  p_manual_calories numeric default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_late boolean;
  v_id   uuid;
begin
  if v_user is null or not private.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  v_late := private.check_training_date(v_user, p_date);

  if v_late then
    insert into private.late_entry_grants (txid, user_id, meal_date, record_table)
    values (txid_current(), v_user, p_date, 'workouts');
  end if;

  insert into public.workouts (user_id, workout_date, workout_type, custom_name, duration_minutes, estimated_calories, manual_calories)
  values (v_user, p_date, p_type, nullif(btrim(p_name), ''), p_duration_minutes, 0, p_manual_calories)
  returning id into v_id;

  if v_late then
    delete from private.late_entry_grants where txid = txid_current() and user_id = v_user;
  end if;
  return v_id;
end;
$$;

create function public.log_activity(
  p_date date,
  p_type text,
  p_duration_minutes integer,
  p_name text default null,
  p_manual_calories numeric default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_late boolean;
  v_id   uuid;
begin
  if v_user is null or not private.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  v_late := private.check_training_date(v_user, p_date);

  if v_late then
    insert into private.late_entry_grants (txid, user_id, meal_date, record_table)
    values (txid_current(), v_user, p_date, 'activities');
  end if;

  insert into public.activities (user_id, activity_date, activity_type, custom_name, duration_minutes, estimated_calories, manual_calories)
  values (v_user, p_date, p_type, nullif(btrim(p_name), ''), p_duration_minutes, 0, p_manual_calories)
  returning id into v_id;

  if v_late then
    delete from private.late_entry_grants where txid = txid_current() and user_id = v_user;
  end if;
  return v_id;
end;
$$;

revoke all on function
  public.log_workout(date, text, integer, text, numeric),
  public.log_activity(date, text, integer, text, numeric),
  public.training_calorie_rates()
from public, anon;

grant execute on function
  public.log_workout(date, text, integer, text, numeric),
  public.log_activity(date, text, integer, text, numeric),
  public.training_calorie_rates()
to authenticated;
