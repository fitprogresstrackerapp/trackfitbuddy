-- =============================================================================
-- Audit log (append-only), record locking, soft-delete bookkeeping and the
-- audit triggers attached to every audit-sensitive table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- audit_logs (spec §63). Written only by trigger functions.
-- For updates, old/new contain only the changed columns.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid references public.profiles (id), -- null = system/automated job
  target_user_id  uuid references public.profiles (id),
  entity_type     text not null,
  entity_id       uuid,
  action          public.audit_action not null,
  old_values_json jsonb,
  new_values_json jsonb,
  reason          text,
  created_at      timestamptz not null default now()
);

create index audit_logs_target_idx on public.audit_logs (target_user_id, created_at);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at);

create function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_append_only
before update or delete on public.audit_logs
for each row execute function private.prevent_audit_mutation();

create trigger audit_logs_no_truncate
before truncate on public.audit_logs
for each statement execute function private.prevent_audit_mutation();

-- -----------------------------------------------------------------------------
-- Generic audit trigger.
--   tg_argv[0] owner column ('' when the entity has no owning user)
--   tg_argv[1] 'always'  → log every change (roles, settings, cycles, food DB…)
--              'foreign' → log only changes made by someone other than the owner
--                          (admin corrections, deactivation, group removals)
--   tg_argv[2] date column used to detect corrections of locked records
-- A reason can be supplied by the caller via set_config('app.audit_reason', …, true).
-- -----------------------------------------------------------------------------
create function private.audit_row_change()
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
-- Record guard for user-owned records (spec §13, §66, §70).
--   tg_argv[0] record date column ('' for meal_items → parent meal's date)
--   tg_argv[1] 'lock'   → apply the edit-lock rule to normal users
--              'nolock' → bookkeeping only
--
-- Lock rule for a normal user (evaluated in the user's timezone):
--   * records can only be created for today;
--   * a record is editable only while its date is today and it is not
--     explicitly locked (record_date < today ⇒ locked);
--   * the record date cannot be moved; lock flags cannot be touched;
--   * soft-deleted records cannot be restored; hard deletes are rejected.
-- Admins, trusted server code (no JWT user) and cascades from our own
-- triggers bypass the lock; their changes are audited.
-- -----------------------------------------------------------------------------
create function private.guard_user_record()
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

    v_today := private.user_local_date((v_new ->> 'user_id')::uuid);

    if tg_op = 'INSERT' then
      if v_date is distinct from v_today or v_locked then
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

-- Record guards (named *_guard so they run before other BEFORE triggers).
create trigger meals_guard before insert or update or delete on public.meals
  for each row execute function private.guard_user_record('meal_date', 'lock');
create trigger meal_items_guard before insert or update or delete on public.meal_items
  for each row execute function private.guard_user_record('', 'lock');
create trigger workouts_guard before insert or update or delete on public.workouts
  for each row execute function private.guard_user_record('workout_date', 'lock');
create trigger activities_guard before insert or update or delete on public.activities
  for each row execute function private.guard_user_record('activity_date', 'lock');
create trigger steps_guard before insert or update or delete on public.steps_entries
  for each row execute function private.guard_user_record('entry_date', 'lock');
create trigger weight_guard before insert or update or delete on public.weight_measurements
  for each row execute function private.guard_user_record('measurement_date', 'lock');
create trigger inbody_reports_guard before insert or update or delete on public.inbody_reports
  for each row execute function private.guard_user_record('report_date', 'nolock');
create trigger food_items_guard before insert or update or delete on public.food_items
  for each row execute function private.guard_user_record('', 'nolock');

-- Audit triggers.
create trigger profiles_audit after insert or update on public.profiles
  for each row execute function private.audit_row_change('id', 'foreign', '');
create trigger user_roles_audit after insert or delete on public.user_roles
  for each row execute function private.audit_row_change('user_id', 'always', '');
create trigger manager_user_assignments_audit after insert or update or delete on public.manager_user_assignments
  for each row execute function private.audit_row_change('user_id', 'always', '');
create trigger system_settings_audit after insert or update or delete on public.system_settings
  for each row execute function private.audit_row_change('', 'always', '');
create trigger goals_audit after insert or update on public.goals
  for each row execute function private.audit_row_change('user_id', 'foreign', '');
create trigger goal_focuses_audit after insert or update or delete on public.goal_focuses
  for each row execute function private.audit_row_change('user_id', 'foreign', '');
-- User edits of recommended targets must record old/new/who/when (spec §33).
create trigger recommendation_cycles_audit after update on public.recommendation_cycles
  for each row execute function private.audit_row_change('user_id', 'always', '');
create trigger recommendation_feedback_audit after insert or update on public.recommendation_feedback
  for each row execute function private.audit_row_change('user_id', 'foreign', '');
create trigger daily_target_snapshots_audit after update or delete on public.daily_target_snapshots
  for each row execute function private.audit_row_change('user_id', 'foreign', 'target_date');
create trigger food_items_audit after insert or update on public.food_items
  for each row execute function private.audit_row_change('', 'always', '');
create trigger food_submissions_audit after update on public.food_submissions
  for each row execute function private.audit_row_change('submitted_by', 'foreign', '');
create trigger food_merges_audit after insert on public.food_merges
  for each row execute function private.audit_row_change('', 'always', '');
create trigger meals_audit after insert or update or delete on public.meals
  for each row execute function private.audit_row_change('user_id', 'foreign', 'meal_date');
create trigger meal_items_audit after insert or update or delete on public.meal_items
  for each row execute function private.audit_row_change('user_id', 'foreign', '');
create trigger workouts_audit after insert or update or delete on public.workouts
  for each row execute function private.audit_row_change('user_id', 'foreign', 'workout_date');
create trigger activities_audit after insert or update or delete on public.activities
  for each row execute function private.audit_row_change('user_id', 'foreign', 'activity_date');
create trigger steps_audit after insert or update or delete on public.steps_entries
  for each row execute function private.audit_row_change('user_id', 'foreign', 'entry_date');
create trigger weight_audit after insert or update or delete on public.weight_measurements
  for each row execute function private.audit_row_change('user_id', 'foreign', 'measurement_date');
create trigger inbody_reports_audit after insert or update or delete on public.inbody_reports
  for each row execute function private.audit_row_change('user_id', 'foreign', '');
create trigger inbody_metrics_audit after insert or update or delete on public.inbody_metrics
  for each row execute function private.audit_row_change('user_id', 'foreign', '');
create trigger groups_audit after update on public.groups
  for each row execute function private.audit_row_change('creator_id', 'foreign', '');
create trigger group_memberships_audit after update on public.group_memberships
  for each row execute function private.audit_row_change('user_id', 'foreign', '');
