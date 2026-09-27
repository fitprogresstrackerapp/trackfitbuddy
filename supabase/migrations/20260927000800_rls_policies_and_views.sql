-- =============================================================================
-- Grants, Row Level Security policies and read views.
--
-- Principles
--   * RLS is enabled on every table in `public`; no table is reachable by `anon`.
--   * Policies call SECURITY DEFINER helpers in `private` (no recursion) wrapped
--     in (select …) so they are evaluated once per statement.
--   * Access tiers: own data (active user) · assigned users (manager, read-only)
--     · operational data (admin) · everything incl. authority (super admin).
--   * Group members never read other members' tables directly; they use
--     public.get_group_member_day(), which returns only group-visible fields.
--   * Hard deletes are not granted to clients; soft deletion is an UPDATE.
--   * Tables written only by trusted server code (service role, which bypasses
--     RLS) have no client write policies at all.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke delete on all tables in schema public from authenticated;

-- The only client hard deletes: removing a role or a manager assignment
-- (both audited). Everything else is soft-deleted.
grant delete on public.user_roles, public.manager_user_assignments to authenticated;

-- Server-written tables are read-only for clients (defence in depth on top of
-- RLS): audit, AI processing, cycles and target snapshots, food versions.
revoke insert, update on
  public.audit_logs,
  public.recommendation_processing_runs, public.recommendation_processing_users, public.ai_usage_records,
  public.recommendation_cycles, public.daily_target_snapshots,
  public.food_item_versions
from authenticated;

-- Private helpers: never callable by anon. `authenticated` needs EXECUTE for
-- policy evaluation; the schema is not exposed through the Data API.
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- Future tables must opt in explicitly.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
alter table public.profiles                        enable row level security;
alter table public.user_roles                      enable row level security;
alter table public.manager_user_assignments        enable row level security;
alter table public.system_settings                 enable row level security;
alter table public.goals                           enable row level security;
alter table public.goal_focuses                    enable row level security;
alter table public.recommendation_processing_runs  enable row level security;
alter table public.recommendation_processing_users enable row level security;
alter table public.ai_usage_records                enable row level security;
alter table public.recommendation_cycles           enable row level security;
alter table public.recommendation_feedback         enable row level security;
alter table public.daily_target_snapshots          enable row level security;
alter table public.food_submissions                enable row level security;
alter table public.food_items                      enable row level security;
alter table public.food_item_versions              enable row level security;
alter table public.food_merges                     enable row level security;
alter table public.meals                           enable row level security;
alter table public.meal_items                      enable row level security;
alter table public.workouts                        enable row level security;
alter table public.activities                      enable row level security;
alter table public.steps_entries                   enable row level security;
alter table public.inbody_reports                  enable row level security;
alter table public.inbody_metrics                  enable row level security;
alter table public.weight_measurements             enable row level security;
alter table public.groups                          enable row level security;
alter table public.group_memberships               enable row level security;
alter table public.audit_logs                      enable row level security;

-- -----------------------------------------------------------------------------
-- Identity & access
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
using (
  (id = (select auth.uid()) and (select private.is_active_user()))
  or (select private.is_admin())
  or private.is_manager_of(id)
);

-- Column-level restrictions (status, phone, super-admin protection) are
-- enforced by the profiles_guard trigger.
create policy profiles_update on public.profiles for update to authenticated
using ((id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()))
with check ((id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

create policy user_roles_select on public.user_roles for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

-- Super admins manage every role; admins may only grant/revoke MANAGER and USER
-- and never on a super admin (spec §6).
create policy user_roles_insert on public.user_roles for insert to authenticated
with check (
  (select private.is_super_admin())
  or ((select private.is_admin()) and role in ('MANAGER', 'USER')
      and not private.user_has_role(user_id, 'SUPER_ADMIN'))
);

create policy user_roles_delete on public.user_roles for delete to authenticated
using (
  (select private.is_super_admin())
  or ((select private.is_admin()) and role in ('MANAGER', 'USER')
      and not private.user_has_role(user_id, 'SUPER_ADMIN'))
);

create policy manager_assignments_select on public.manager_user_assignments for select to authenticated
using (manager_id = (select auth.uid()) or user_id = (select auth.uid()) or (select private.is_admin()));

create policy manager_assignments_insert on public.manager_user_assignments for insert to authenticated
with check ((select private.is_admin()));

create policy manager_assignments_delete on public.manager_user_assignments for delete to authenticated
using ((select private.is_admin()));

create policy system_settings_select on public.system_settings for select to authenticated
using ((select private.is_admin()));

-- Super admins manage all settings; admins only the nutrition tolerance (spec §27).
create policy system_settings_update on public.system_settings for update to authenticated
using (
  (select private.is_super_admin())
  or ((select private.is_admin()) and key in ('nutrition_tolerance', 'calorie_lower_tolerance', 'calorie_upper_tolerance'))
)
with check (
  (select private.is_super_admin())
  or ((select private.is_admin()) and key in ('nutrition_tolerance', 'calorie_lower_tolerance', 'calorie_upper_tolerance'))
);

create policy system_settings_insert on public.system_settings for insert to authenticated
with check ((select private.is_super_admin()));

-- -----------------------------------------------------------------------------
-- Goals
-- -----------------------------------------------------------------------------
create policy goals_select on public.goals for select to authenticated
using (
  (user_id = (select auth.uid()) and (select private.is_active_user()))
  or (select private.is_admin())
  or private.is_manager_of(user_id)
);
create policy goals_insert on public.goals for insert to authenticated
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));
create policy goals_update on public.goals for update to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()))
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

create policy goal_focuses_select on public.goal_focuses for select to authenticated
using (
  (user_id = (select auth.uid()) and (select private.is_active_user()))
  or (select private.is_admin())
  or private.is_manager_of(user_id)
);
create policy goal_focuses_insert on public.goal_focuses for insert to authenticated
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));
create policy goal_focuses_update on public.goal_focuses for update to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()))
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));
-- Removing a focus from an unlocked goal is a real delete (no history needed
-- before the goal is used by a cycle; the cycle-lock trigger blocks it after).
grant delete on public.goal_focuses to authenticated;
create policy goal_focuses_delete on public.goal_focuses for delete to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

-- -----------------------------------------------------------------------------
-- Recommendation processing — admin read-only; written by server functions.
-- Raw AI input/output is not exposed to users or managers.
-- -----------------------------------------------------------------------------
create policy processing_runs_select on public.recommendation_processing_runs for select to authenticated
using ((select private.is_admin()));
create policy processing_users_select on public.recommendation_processing_users for select to authenticated
using ((select private.is_admin()));
create policy ai_usage_select on public.ai_usage_records for select to authenticated
using ((select private.is_admin()));

-- Cycles and targets: readable by owner / admin / assigned manager.
-- Review edits and acceptance go through server-side functions (later phase).
create policy cycles_select on public.recommendation_cycles for select to authenticated
using (
  (user_id = (select auth.uid()) and (select private.is_active_user()))
  or (select private.is_admin())
  or private.is_manager_of(user_id)
);
create policy targets_select on public.daily_target_snapshots for select to authenticated
using (
  (user_id = (select auth.uid()) and (select private.is_active_user()))
  or (select private.is_admin())
  or private.is_manager_of(user_id)
);

-- Feedback: own, only inside the feedback window, never once locked.
create policy feedback_select on public.recommendation_feedback for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));
create policy feedback_insert on public.recommendation_feedback for insert to authenticated
with check (
  user_id = (select auth.uid()) and (select private.is_active_user())
  and locked_at is null and recommendation_cycle_id is null
  and private.feedback_window_open(user_id, feedback_month)
);
create policy feedback_update on public.recommendation_feedback for update to authenticated
using (
  user_id = (select auth.uid()) and (select private.is_active_user())
  and locked_at is null and private.feedback_window_open(user_id, feedback_month)
)
with check (
  user_id = (select auth.uid()) and locked_at is null and recommendation_cycle_id is null
  and private.feedback_window_open(user_id, feedback_month)
);

-- -----------------------------------------------------------------------------
-- Food
-- -----------------------------------------------------------------------------
create policy food_items_select on public.food_items for select to authenticated
using ((not is_deleted and merged_into_food_id is null) or (select private.is_admin()));
create policy food_items_insert on public.food_items for insert to authenticated
with check ((select private.is_admin()));
create policy food_items_update on public.food_items for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

create policy food_item_versions_select on public.food_item_versions for select to authenticated
using ((select private.is_admin()));

create policy food_submissions_select on public.food_submissions for select to authenticated
using (submitted_by = (select auth.uid()) or (select private.is_admin()));
create policy food_submissions_insert on public.food_submissions for insert to authenticated
with check (submitted_by = (select auth.uid()) and (select private.is_active_user()) and status = 'PENDING_REVIEW');
create policy food_submissions_update on public.food_submissions for update to authenticated
using ((submitted_by = (select auth.uid()) and status = 'PENDING_REVIEW') or (select private.is_admin()))
with check ((submitted_by = (select auth.uid()) and status = 'PENDING_REVIEW') or (select private.is_admin()));

create policy food_merges_select on public.food_merges for select to authenticated
using ((select private.is_admin()));
create policy food_merges_insert on public.food_merges for insert to authenticated
with check ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- User-owned daily records: meals, meal items, workouts, activities, steps,
-- weight. Owner and admin write (lock rules in *_guard triggers); assigned
-- managers read.
-- -----------------------------------------------------------------------------
create policy meals_select on public.meals for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()) or private.is_manager_of(user_id));
create policy meals_insert on public.meals for insert to authenticated
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));
create policy meals_update on public.meals for update to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()))
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

create policy meal_items_select on public.meal_items for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()) or private.is_manager_of(user_id));
create policy meal_items_insert on public.meal_items for insert to authenticated
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));
create policy meal_items_update on public.meal_items for update to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()))
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

create policy workouts_select on public.workouts for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()) or private.is_manager_of(user_id));
create policy workouts_insert on public.workouts for insert to authenticated
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));
create policy workouts_update on public.workouts for update to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()))
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

create policy activities_select on public.activities for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()) or private.is_manager_of(user_id));
create policy activities_insert on public.activities for insert to authenticated
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));
create policy activities_update on public.activities for update to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()))
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

create policy steps_select on public.steps_entries for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()) or private.is_manager_of(user_id));
create policy steps_insert on public.steps_entries for insert to authenticated
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));
create policy steps_update on public.steps_entries for update to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()))
with check ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

create policy weight_select on public.weight_measurements for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()) or private.is_manager_of(user_id));
-- Users record MANUAL weights only; INBODY rows come from InBody metrics.
create policy weight_insert on public.weight_measurements for insert to authenticated
with check (
  (user_id = (select auth.uid()) and (select private.is_active_user()) and source = 'MANUAL')
  or (select private.is_admin())
);
create policy weight_update on public.weight_measurements for update to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user()) and source = 'MANUAL') or (select private.is_admin()))
with check ((user_id = (select auth.uid()) and (select private.is_active_user()) and source = 'MANUAL') or (select private.is_admin()));

-- InBody: users upload their own reports; extraction results are written by
-- the server (or corrected by admins).
create policy inbody_reports_select on public.inbody_reports for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()) or private.is_manager_of(user_id));
create policy inbody_reports_insert on public.inbody_reports for insert to authenticated
with check (
  (user_id = (select auth.uid()) and (select private.is_active_user())
   and extraction_status = 'PENDING' and raw_extracted_text is null)
  or (select private.is_admin())
);
create policy inbody_reports_update on public.inbody_reports for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

create policy inbody_metrics_select on public.inbody_metrics for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()) or private.is_manager_of(user_id));
create policy inbody_metrics_insert on public.inbody_metrics for insert to authenticated
with check ((select private.is_admin()));
create policy inbody_metrics_update on public.inbody_metrics for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- Groups — structure only. Member data is exposed exclusively through
-- public.get_group_member_day().
-- -----------------------------------------------------------------------------
-- The creator can always read the group row (needed for INSERT … RETURNING,
-- which is checked before the creator's membership row exists).
create policy groups_select on public.groups for select to authenticated
using (creator_id = (select auth.uid()) or private.is_group_member(id) or (select private.is_admin()));
create policy groups_insert on public.groups for insert to authenticated
with check (creator_id = (select auth.uid()) and (select private.is_active_user()) and is_active);
create policy groups_update on public.groups for update to authenticated
using (private.is_group_admin(id) or (select private.is_admin()))
with check (private.is_group_admin(id) or (select private.is_admin()));

-- Current members see the current roster of their groups; users see their own
-- membership history; group admins also see past memberships of their group
-- (roster only — member data is never exposed here). Joining is done by a
-- server-side function (join by code) in the groups phase.
create policy group_memberships_select on public.group_memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or (is_active and private.is_group_member(group_id))
  or private.is_group_admin(group_id)
  or (select private.is_admin())
);
create policy group_memberships_update on public.group_memberships for update to authenticated
using (
  (is_active and (user_id = (select auth.uid()) or private.is_group_admin(group_id)))
  or (select private.is_admin())
)
with check (
  user_id = (select auth.uid()) or private.is_group_admin(group_id) or (select private.is_admin())
);
create policy group_memberships_insert on public.group_memberships for insert to authenticated
with check ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- Audit log — admins read; nobody writes directly.
-- -----------------------------------------------------------------------------
create policy audit_logs_select on public.audit_logs for select to authenticated
using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- Read views — "normal" queries that exclude soft-deleted rows.
-- security_invoker: the caller's RLS applies to the underlying tables.
-- -----------------------------------------------------------------------------
create view public.active_meals with (security_invoker = true) as
select * from public.meals where not is_deleted;

create view public.active_meal_items with (security_invoker = true) as
select mi.*
from public.meal_items mi
join public.meals m on m.id = mi.meal_id
where not mi.is_deleted and not m.is_deleted;

create view public.active_workouts with (security_invoker = true) as
select * from public.workouts where not is_deleted;

create view public.active_activities with (security_invoker = true) as
select * from public.activities where not is_deleted;

create view public.active_weight_measurements with (security_invoker = true) as
select * from public.weight_measurements where not is_deleted;

-- The active step value per user and date (latest valid entry).
create view public.daily_steps with (security_invoker = true) as
select user_id, entry_date, steps, id as steps_entry_id, created_at
from public.steps_entries
where is_active and not is_deleted;

-- Latest valid weight per user; on the same date InBody wins over manual.
create view public.current_weights with (security_invoker = true) as
select distinct on (user_id)
  user_id, weight_kg, measurement_date, source, id as weight_measurement_id
from public.weight_measurements
where not is_deleted
order by user_id, measurement_date desc, (source = 'INBODY') desc, created_at desc;

-- Recommendation readiness (spec §71): name, age (date of birth), gender,
-- height and a current weight are mandatory.
create view public.profile_readiness with (security_invoker = true) as
select
  p.id as user_id,
  cardinality(missing.fields) = 0 as is_profile_complete,
  missing.fields as missing_fields
from public.profiles p
left join public.current_weights w on w.user_id = p.id
cross join lateral (
  select array_remove(array[
    case when p.name is null then 'name' end,
    case when p.date_of_birth is null then 'date_of_birth' end,
    case when p.gender is null then 'gender' end,
    case when p.height_cm is null then 'height_cm' end,
    case when w.weight_kg is null then 'current_weight' end
  ], null) as fields
) missing
where p.is_active;

revoke all on
  public.active_meals, public.active_meal_items, public.active_workouts, public.active_activities,
  public.active_weight_measurements, public.daily_steps, public.current_weights, public.profile_readiness
from anon, authenticated;
grant select on
  public.active_meals, public.active_meal_items, public.active_workouts, public.active_activities,
  public.active_weight_measurements, public.daily_steps, public.current_weights, public.profile_readiness
to authenticated;
