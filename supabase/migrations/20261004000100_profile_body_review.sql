-- =============================================================================
-- Profile, goals, steps, body and recommendation review (Phase 1 Profile):
--   * log_weight() / log_steps()  — manual measurements for today, or a missing
--                                    past day through the existing late-entry
--                                    grant (never by editing locked records)
--   * set_goal()                  — edits the active goal, or creates a new
--                                    goal version when a cycle already uses it
--                                    (the current cycle's goal is never rewritten)
--   * review_recommendation() /   — the user's review window (spec §32–33):
--     accept_recommendation()       final targets and the session template may
--                                    change while IN_REVIEW; originals stay
--   * InBody report storage       — private bucket, own folder only
--
-- Nothing here weakens locking: past or locked records stay read-only.
-- See docs/profile.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Late entry for weight and steps (same mechanism as meals and training).
-- -----------------------------------------------------------------------------
alter table private.late_entry_grants drop constraint late_entry_grants_table_valid;
alter table private.late_entry_grants add constraint late_entry_grants_table_valid
  check (record_table in ('meals', 'workouts', 'activities', 'weight_measurements', 'steps_entries'));

-- Record guard — identical to the previous version except that the INSERT rule
-- also admits a past-dated weight or step entry created inside log_weight() /
-- log_steps().
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
        or (tg_table_name in ('workouts', 'activities', 'weight_measurements', 'steps_entries')
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

-- Date rule shared by the entry functions: no future dates; past days up to
-- 90 days back are late entries. Returns true for a late entry.
create function private.entry_date_is_late(p_user uuid, p_date date)
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
    raise exception 'Entries cannot be dated in the future' using errcode = '22023';
  end if;
  if p_date < v_today - c_late_entry_days then
    raise exception 'Missing entries can be added for the last % days only', c_late_entry_days
      using errcode = '22023';
  end if;
  return p_date < v_today;
end;
$$;

revoke all on function private.entry_date_is_late(uuid, date) from public, anon, authenticated;

-- A new MANUAL weight measurement. History is kept: same-day entries add up
-- to several measurements; the display value follows the current_weights rule.
create function public.log_weight(p_date date, p_weight_kg numeric)
returns uuid
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
  v_late := private.entry_date_is_late(v_user, p_date);

  if v_late then
    insert into private.late_entry_grants (txid, user_id, meal_date, record_table)
    values (txid_current(), v_user, p_date, 'weight_measurements');
  end if;

  insert into public.weight_measurements (user_id, measurement_date, weight_kg, source)
  values (v_user, p_date, p_weight_kg, 'MANUAL')
  returning id into v_id;

  if v_late then
    delete from private.late_entry_grants where txid = txid_current() and user_id = v_user;
  end if;
  return v_id;
end;
$$;

-- A new step entry. It becomes the day's active value (existing trigger); the
-- earlier entries stay as history — entries are never summed. A past day that
-- already has an entry is locked: a new entry would change the locked one.
create function public.log_steps(p_date date, p_steps integer)
returns uuid
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
  v_late := private.entry_date_is_late(v_user, p_date);

  if v_late then
    if exists (
      select 1 from public.steps_entries s
      where s.user_id = v_user and s.entry_date = p_date and not s.is_deleted
    ) then
      raise exception 'Record is locked and can no longer be changed' using errcode = '42501';
    end if;
    insert into private.late_entry_grants (txid, user_id, meal_date, record_table)
    values (txid_current(), v_user, p_date, 'steps_entries');
  end if;

  insert into public.steps_entries (user_id, entry_date, steps)
  values (v_user, p_date, p_steps)
  returning id into v_id;

  if v_late then
    delete from private.late_entry_grants where txid = txid_current() and user_id = v_user;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Goals (spec §22): the goal used by a recommendation cycle is locked for that
-- cycle. set_goal() edits the active goal in place while no cycle uses it;
-- otherwise it closes that version (effective_to = today) and starts a new one
-- from today, which the NEXT cycle picks up. Runs as the caller (RLS applies).
-- -----------------------------------------------------------------------------
create function public.set_goal(
  p_long_term_goal text,
  p_focuses text[],
  p_description text default null
) returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_today    date;
  v_goal     public.goals%rowtype;
  v_goal_id  uuid;
  v_focuses  text[] := coalesce(p_focuses, '{}');
  v_desc     text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if v_user is null or not private.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if cardinality(v_focuses) > 7 or cardinality(v_focuses) <> (select count(distinct f) from unnest(v_focuses) f) then
    raise exception 'Choose each focus at most once' using errcode = '22023';
  end if;

  v_today := private.user_local_date(v_user);
  perform pg_advisory_xact_lock(hashtext('goal:' || v_user::text));

  select * into v_goal from public.goals g where g.user_id = v_user and g.is_active;

  if found and not exists (select 1 from public.recommendation_cycles c where c.goal_id = v_goal.id) then
    update public.goals
    set long_term_goal = p_long_term_goal, description = v_desc
    where id = v_goal.id;
    delete from public.goal_focuses where goal_id = v_goal.id;
    v_goal_id := v_goal.id;
  else
    if found then
      update public.goals
      set is_active = false, effective_to = greatest(v_today, v_goal.effective_from)
      where id = v_goal.id;
    end if;
    insert into public.goals (user_id, long_term_goal, description, effective_from)
    values (v_user, p_long_term_goal, v_desc, v_today)
    returning id into v_goal_id;
  end if;

  insert into public.goal_focuses (goal_id, user_id, focus_type, priority)
  select v_goal_id, v_user, f.focus, f.priority::smallint
  from unnest(v_focuses) with ordinality as f(focus, priority);

  return v_goal_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Recommendation review (spec §32–33). The review window is the generation day
-- and the next calendar day (period_start .. review_deadline, in the user's
-- timezone). Inside it the owner may change the FINAL targets and the session
-- names of the workout template, or accept & lock. The AI originals
-- (recommended_*, parsed_output_json), goals and capacity are protected by the
-- existing trigger; every change is written to the audit log (old/new/actor/
-- time) by the existing recommendation_cycles audit trigger.
-- -----------------------------------------------------------------------------
create function private.reviewable_cycle(p_cycle_id uuid)
returns public.recommendation_cycles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cycle public.recommendation_cycles%rowtype;
begin
  select * into v_cycle from public.recommendation_cycles c
  where c.id = p_cycle_id and c.user_id = auth.uid();
  if not found or not private.is_active_user() then
    raise exception 'Recommendation not found' using errcode = 'P0002';
  end if;
  if v_cycle.status <> 'IN_REVIEW' or private.user_local_date(v_cycle.user_id) > v_cycle.review_deadline then
    raise exception 'The review window has closed; this recommendation is locked' using errcode = '42501';
  end if;
  return v_cycle;
end;
$$;

revoke all on function private.reviewable_cycle(uuid) from public, anon, authenticated;

create function public.review_recommendation(
  p_cycle_id uuid,
  p_calories integer,
  p_protein_g numeric,
  p_carbs_g numeric,
  p_fat_g numeric,
  p_fiber_g numeric,
  p_sessions text[] default null
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cycle    public.recommendation_cycles%rowtype;
  v_plan     jsonb;
  v_session  text;
  v_today    date;
begin
  v_cycle := private.reviewable_cycle(p_cycle_id);

  if p_calories is null or p_calories not between 800 and 6000
     or p_protein_g is null or p_protein_g not between 0 and 500
     or p_carbs_g is null or p_carbs_g not between 0 and 1000
     or p_fat_g is null or p_fat_g not between 0 and 400
     or p_fiber_g is null or p_fiber_g not between 0 and 150 then
    raise exception 'Targets are outside the allowed ranges' using errcode = '22023';
  end if;

  v_plan := v_cycle.workout_plan_json;
  if p_sessions is not null then
    -- The template may be renamed, never resized: capacity is locked per cycle.
    if cardinality(p_sessions) <> v_cycle.workout_days_per_week then
      raise exception 'The workout template must have % sessions', v_cycle.workout_days_per_week
        using errcode = '22023';
    end if;
    foreach v_session in array p_sessions loop
      if v_session is null or char_length(btrim(v_session)) not between 1 and 60 then
        raise exception 'Each session needs a name of 1–60 characters' using errcode = '22023';
      end if;
    end loop;
    v_plan := case when jsonb_typeof(v_plan) = 'object' then v_plan else '{}'::jsonb end
      || jsonb_build_object(
           'sessions',
           (select jsonb_agg(jsonb_build_object('name', btrim(s)) order by n)
            from unnest(p_sessions) with ordinality as t(s, n))
         );
  end if;

  update public.recommendation_cycles
  set final_calories = p_calories,
      final_protein_g = p_protein_g,
      final_carbs_g = p_carbs_g,
      final_fat_g = p_fat_g,
      final_fiber_g = p_fiber_g,
      workout_plan_json = v_plan
  where id = v_cycle.id;

  -- Snapshots already written for today and later follow the final targets;
  -- earlier days keep the targets they were measured against.
  v_today := private.user_local_date(v_cycle.user_id);
  update public.daily_target_snapshots
  set calories = p_calories,
      protein_g = p_protein_g,
      carbs_g = p_carbs_g,
      fat_g = p_fat_g,
      fiber_g = p_fiber_g
  where recommendation_cycle_id = v_cycle.id and target_date >= v_today;
end;
$$;

create function public.accept_recommendation(p_cycle_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cycle public.recommendation_cycles%rowtype;
begin
  v_cycle := private.reviewable_cycle(p_cycle_id);
  update public.recommendation_cycles
  set status = 'LOCKED', locked_at = now(), locked_by = auth.uid()
  where id = v_cycle.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- InBody reports (spec §21): the original file is kept in a private bucket,
-- one folder per user. Users upload and read their own files; nothing is
-- extracted here (structured metrics are written by server/admin later).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inbody-reports', 'inbody-reports', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

create policy inbody_files_select on storage.objects for select to authenticated
using (
  bucket_id = 'inbody-reports'
  and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin()))
);
create policy inbody_files_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'inbody-reports'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.is_active_user())
);

-- A user's report row must point into their own folder and cannot be dated in
-- the future. Admins and trusted server code are not restricted.
create function private.guard_inbody_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.is_admin() then
    if new.file_path not like new.user_id::text || '/%' then
      raise exception 'The report file must be in your own folder' using errcode = '42501';
    end if;
    if new.report_date > private.user_local_date(new.user_id) then
      raise exception 'Entries cannot be dated in the future' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_inbody_report() from public, anon, authenticated;

create trigger inbody_reports_owner_guard before insert on public.inbody_reports
  for each row execute function private.guard_inbody_report();

revoke all on function
  public.log_weight(date, numeric),
  public.log_steps(date, integer),
  public.set_goal(text, text[], text),
  public.review_recommendation(uuid, integer, numeric, numeric, numeric, numeric, text[]),
  public.accept_recommendation(uuid)
from public, anon;

grant execute on function
  public.log_weight(date, numeric),
  public.log_steps(date, integer),
  public.set_goal(text, text[], text),
  public.review_recommendation(uuid, integer, numeric, numeric, numeric, numeric, text[]),
  public.accept_recommendation(uuid)
to authenticated;
