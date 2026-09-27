-- RLS, role, locking, soft-delete, snapshot, group-visibility and audit tests.
-- Each block impersonates a user the way Supabase does for API requests:
-- role `authenticated` + JWT claims (auth.uid() reads the `sub` claim).
begin;
create extension if not exists pgtap with schema extensions;

select plan(93);

-- ---------------------------------------------------------------------------
-- Test helpers (rolled back with the transaction)
-- ---------------------------------------------------------------------------
create schema tests;

create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create function tests.new_user(p_id uuid, p_phone text, p_name text) returns void language plpgsql
as $$
begin
  insert into auth.users (id, phone, aud, role) values (p_id, ltrim(p_phone, '+'), 'authenticated', 'authenticated');
  insert into public.profiles (id, phone, name) values (p_id, p_phone, p_name);
end;
$$;

create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;

-- Runs a statement as the current role and returns the number of rows it touched
-- (RLS silently filters rows it cannot see, so "0 rows" is the denial signal).
create function tests.affected(p_sql text) returns bigint language plpgsql
as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner — bypasses RLS and locks, like server code)
--   a1 Alice (user)      b2 Bob (user)        c3 Carol (user, group creator)
--   d4 Mike (manager of Alice)  e5 Ada (admin)  f6 Sam (super admin)
-- ---------------------------------------------------------------------------
select tests.new_user('00000000-0000-0000-0000-0000000000a1', '+919000000001', 'Alice');
select tests.new_user('00000000-0000-0000-0000-0000000000b2', '+919000000002', 'Bob');
select tests.new_user('00000000-0000-0000-0000-0000000000c3', '+919000000003', 'Carol');
select tests.new_user('00000000-0000-0000-0000-0000000000d4', '+919000000004', 'Mike');
select tests.new_user('00000000-0000-0000-0000-0000000000e5', '+919000000005', 'Ada');
select tests.new_user('00000000-0000-0000-0000-0000000000f6', '+919000000006', 'Sam');

insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000d4', 'MANAGER'),
  ('00000000-0000-0000-0000-0000000000e5', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000f6', 'SUPER_ADMIN');

insert into public.manager_user_assignments (manager_id, user_id)
values ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1');

insert into public.food_items (id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g)
values ('00000000-0000-0000-0004-000000000001', 'Test Food', 100, 'g', 200, 20, 10, 5, 2);

-- Alice: yesterday's (locked) meal and workout, weight history, an InBody report.
insert into public.meals (id, user_id, meal_date)
values ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000a1', tests.today() - 1);
insert into public.workouts (id, user_id, workout_date, workout_type, duration_minutes, estimated_calories)
values ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0000-0000000000a1', tests.today() - 1, 'LEGS', 45, 300);
insert into public.weight_measurements (user_id, measurement_date, weight_kg)
values ('00000000-0000-0000-0000-0000000000a1', tests.today() - 10, 80);
insert into public.inbody_reports (id, user_id, report_date, file_path, file_type)
values ('00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0000-0000000000a1', tests.today() - 5, 'a1/report-1.pdf', 'application/pdf');
insert into public.inbody_metrics (report_id, user_id, weight_kg, body_fat_percent, muscle_mass_kg)
values ('00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0000-0000000000a1', 79.5, 22.4, 32.1);

-- Bob and Carol private data.
insert into public.meals (id, user_id, meal_date)
values ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-0000000000b2', tests.today());
insert into public.weight_measurements (user_id, measurement_date, weight_kg) values
  ('00000000-0000-0000-0000-0000000000b2', tests.today(), 70),
  ('00000000-0000-0000-0000-0000000000c3', tests.today(), 65);

-- Alice: goal + current recommendation cycle using it + today's target snapshot.
insert into public.goals (id, user_id, long_term_goal)
values ('00000000-0000-0000-000a-000000000001', '00000000-0000-0000-0000-0000000000a1', 'FAT_LOSS');
insert into public.goal_focuses (goal_id, user_id, focus_type, priority)
values ('00000000-0000-0000-000a-000000000001', '00000000-0000-0000-0000-0000000000a1', 'MUSCLE_BUILDING', 1);
insert into public.recommendation_processing_runs (id, processing_month)
values ('00000000-0000-0000-0006-000000000001', date_trunc('month', tests.today())::date);
insert into public.recommendation_processing_users (
  id, processing_run_id, user_id, status, raw_input_json, parsed_recommendation_json, generated_at,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  provider, model, prompt_version
) values (
  '00000000-0000-0000-0007-000000000001', '00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0000-0000000000a1',
  'SUCCESS', '{"weight_kg": 79.5}', '{}', now(), 2000, 140, 250, 65, 30, 'test', 'test-model', 'v1'
);
insert into public.recommendation_cycles (
  id, user_id, processing_month, processing_user_id, goal_id, workout_days_per_week, period_start,
  generated_at, review_deadline, parsed_output_json, provider, model, prompt_version,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g, workout_plan_json
) values (
  '00000000-0000-0000-0008-000000000001', '00000000-0000-0000-0000-0000000000a1', date_trunc('month', tests.today())::date,
  '00000000-0000-0000-0007-000000000001', '00000000-0000-0000-000a-000000000001', 4, tests.today() - 3,
  now(), tests.today() - 2, '{}', 'test', 'test-model', 'v1',
  2000, 140, 250, 65, 30, 2000, 140, 250, 65, 30, '{}'
);
insert into public.daily_target_snapshots (
  user_id, recommendation_cycle_id, target_date, calories, protein_g, carbs_g, fat_g, fiber_g,
  workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance
) values (
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0008-000000000001', tests.today(),
  2000, 140, 250, 65, 30, 4, 0.85, 0.85, 1.10
);

-- Group: Carol creates it (becomes ADMIN member); Alice joins.
insert into public.groups (id, name, creator_id)
values ('00000000-0000-0000-0009-000000000001', 'Test Group', '00000000-0000-0000-0000-0000000000c3');
insert into public.group_memberships (group_id, user_id)
values ('00000000-0000-0000-0009-000000000001', '00000000-0000-0000-0000-0000000000a1');

-- ===========================================================================
-- 1. A user can access and write their own records
-- ===========================================================================
set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000a1');

select lives_ok(
  $$ insert into public.meals (id, user_id, meal_date, meal_category)
     values ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-0000000000a1', tests.today(), 'LUNCH') $$,
  '1: user can create a meal for today'
);
select lives_ok(
  $$ insert into public.meal_items (id, meal_id, user_id, food_item_id, quantity, snapshot_calories)
     values ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000002',
             '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0004-000000000001', 150, 1) $$,
  '1: user can log a food in the meal'
);
select results_eq(
  $$ select snapshot_calories, snapshot_protein_g, unit, food_name_snapshot
     from public.meal_items where id = '00000000-0000-0000-0002-000000000001' $$,
  $$ values (300.00::numeric, 30.00::numeric, 'g'::text, 'Test Food'::text) $$,
  'snapshot is computed from the food master (client-supplied values ignored)'
);
select lives_ok(
  $$ insert into public.workouts (user_id, workout_date, workout_type, duration_minutes, estimated_calories)
     values ('00000000-0000-0000-0000-0000000000a1', tests.today(), 'UPPER_BODY', 50, 320) $$,
  '1: user can log a workout for today'
);
select lives_ok(
  $$ insert into public.activities (user_id, activity_date, activity_type, duration_minutes, estimated_calories)
     values ('00000000-0000-0000-0000-0000000000a1', tests.today(), 'BADMINTON', 60, 400) $$,
  '1: user can log an activity for today'
);
select lives_ok(
  $$ insert into public.weight_measurements (user_id, measurement_date, weight_kg)
     values ('00000000-0000-0000-0000-0000000000a1', tests.today(), 79.0) $$,
  '1: user can record a manual weight'
);
select is((select count(*) from public.meals), 2::bigint, '1: user sees exactly their own meals');
select is((select count(*) from public.profiles), 1::bigint, '1: user sees only their own profile');
select is(
  (select count(*) from public.weight_measurements where source = 'INBODY'),
  1::bigint,
  'InBody weight is part of the same weight history'
);
select is((select count(*) from public.daily_target_snapshots), 1::bigint, '1: user reads own daily targets');
select is(
  (select weight_kg from public.current_weights where user_id = '00000000-0000-0000-0000-0000000000a1'),
  79.00::numeric,
  'current weight = latest valid measurement'
);
select is(
  (select missing_fields from public.profile_readiness),
  array['date_of_birth', 'gender', 'height_cm']::text[],
  'profile readiness lists the missing mandatory fields'
);

-- Quantity edits rescale the captured snapshot; direct snapshot edits are refused.
select lives_ok(
  $$ update public.meal_items set quantity = 300 where id = '00000000-0000-0000-0002-000000000001' $$,
  'user can change the quantity while editable'
);
select is(
  (select snapshot_calories from public.meal_items where id = '00000000-0000-0000-0002-000000000001'),
  600.00::numeric,
  'snapshot recalculated for the new quantity'
);
select throws_ok(
  $$ update public.meal_items set snapshot_calories = 1 where id = '00000000-0000-0000-0002-000000000001' $$,
  '42501', null, 'user cannot write nutrition snapshots directly'
);

-- Steps: multiple entries, latest valid is active.
select lives_ok(
  $$ insert into public.steps_entries (user_id, entry_date, steps) values ('00000000-0000-0000-0000-0000000000a1', tests.today(), 3000);
     insert into public.steps_entries (id, user_id, entry_date, steps) values ('00000000-0000-0000-000b-000000000001', '00000000-0000-0000-0000-0000000000a1', tests.today(), 7842) $$,
  'user can enter steps multiple times a day'
);
select is((select steps from public.daily_steps), 7842, 'latest step entry is the active value');
select is((select count(*) from public.steps_entries), 2::bigint, 'step entry history is kept');

-- ===========================================================================
-- 2. A user cannot access another user's private records
-- ===========================================================================
select is(
  (select count(*) from public.weight_measurements where user_id <> '00000000-0000-0000-0000-0000000000a1'),
  0::bigint,
  '2: user cannot read other users'' weight'
);
select is(
  (select count(*) from public.meals where user_id = '00000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  '2: user cannot read other users'' meals'
);
select is(
  tests.affected($$ update public.meals set meal_name = 'hacked' where user_id = '00000000-0000-0000-0000-0000000000b2' $$),
  0::bigint,
  '2: user cannot modify other users'' meals'
);
select throws_ok(
  $$ insert into public.meals (user_id, meal_date) values ('00000000-0000-0000-0000-0000000000b2', tests.today()) $$,
  '42501', null, '2: user cannot create records for another user'
);
select is((select count(*) from public.recommendation_processing_users), 0::bigint, 'user cannot read raw AI processing input/output');
select is((select count(*) from public.audit_logs), 0::bigint, 'user cannot read audit logs');
select is((select count(*) from public.system_settings), 0::bigint, 'user cannot read system settings');

-- Role / status escalation
select throws_ok(
  $$ insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'ADMIN') $$,
  '42501', null, 'user cannot grant themselves a role'
);
select throws_ok(
  $$ update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'user cannot change their account status'
);
select throws_ok(
  $$ update public.profiles set phone = '+919999999999' where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'phone (login identifier) cannot be changed by clients'
);
select lives_ok(
  $$ update public.profiles set height_cm = 175, gender = 'MALE' where id = '00000000-0000-0000-0000-0000000000a1' $$,
  'user can edit their own profile fields'
);

-- Goals locked by the current cycle
select throws_ok(
  $$ update public.goals set long_term_goal = 'MUSCLE_GAIN' where id = '00000000-0000-0000-000a-000000000001' $$,
  '42501', null, 'goal used by a cycle cannot be changed'
);
select throws_ok(
  $$ insert into public.goal_focuses (goal_id, user_id, focus_type, priority)
     values ('00000000-0000-0000-000a-000000000001', '00000000-0000-0000-0000-0000000000a1', 'ENDURANCE', 2) $$,
  '42501', null, 'short-term focus of a cycle goal cannot be changed'
);
select lives_ok(
  $$ update public.goals set is_active = false, effective_to = tests.today() where id = '00000000-0000-0000-000a-000000000001';
     insert into public.goals (user_id, long_term_goal) values ('00000000-0000-0000-0000-0000000000a1', 'MUSCLE_GAIN') $$,
  'a new goal version can be created for the next cycle'
);
select is(
  (select long_term_goal from public.goals g join public.recommendation_cycles c on c.goal_id = g.id),
  'FAT_LOSS',
  'the cycle keeps the goal it was generated with'
);
select throws_ok(
  $$ update public.recommendation_cycles set final_calories = 1 where user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'users cannot write cycles directly (review edits go through server functions)'
);

-- Feedback window: Alice's month is already processed.
select throws_ok(
  $$ insert into public.recommendation_feedback (user_id, feedback_month, feedback)
     values ('00000000-0000-0000-0000-0000000000a1', date_trunc('month', tests.today())::date, 'late') $$,
  '42501', null, 'feedback is locked once the month''s recommendation exists'
);

-- ===========================================================================
-- 10. Locked records cannot be changed by normal users
-- ===========================================================================
select throws_ok(
  $$ update public.meals set meal_name = 'edited' where id = '00000000-0000-0000-0001-000000000001' $$,
  '42501', 'Record is locked and can no longer be changed', '10: yesterday''s meal is locked'
);
select throws_ok(
  $$ update public.workouts set manual_calories = 900 where id = '00000000-0000-0000-0003-000000000001' $$,
  '42501', 'Record is locked and can no longer be changed', '10: yesterday''s workout is locked'
);
select throws_ok(
  $$ update public.workouts set is_deleted = true where id = '00000000-0000-0000-0003-000000000001' $$,
  '42501', 'Record is locked and can no longer be changed', '10: locked records cannot be deleted by the user'
);
select throws_ok(
  $$ insert into public.meal_items (meal_id, user_id, food_item_id, quantity)
     values ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0004-000000000001', 100) $$,
  '42501', null, '10: items cannot be added to a locked meal'
);
select throws_ok(
  $$ insert into public.workouts (user_id, workout_date, workout_type, duration_minutes, estimated_calories)
     values ('00000000-0000-0000-0000-0000000000a1', tests.today() - 1, 'LEGS', 30, 200) $$,
  '42501', null, '10: records cannot be back-dated'
);
select throws_ok(
  $$ update public.meals set meal_date = tests.today() - 1 where id = '00000000-0000-0000-0001-000000000002' $$,
  '42501', 'The record date cannot be changed', '10: record date cannot be moved'
);
select throws_ok(
  $$ update public.meals set is_locked = true where id = '00000000-0000-0000-0001-000000000002' $$,
  '42501', 'Lock state is managed by the system', '10: users cannot lock/unlock records'
);
select throws_ok(
  $$ delete from public.meals where id = '00000000-0000-0000-0001-000000000002' $$,
  '42501', null, 'hard delete is not permitted'
);

-- ===========================================================================
-- 6/7. Group members see only group-visible data
-- ===========================================================================
select is(
  (select count(*) from public.get_group_member_day('00000000-0000-0000-0009-000000000001', tests.today())),
  2::bigint,
  '6: member sees one row per current member'
);
select results_eq(
  $$ select calories, calories_target, protein_g, protein_target_g, steps, workout_logged
     from public.get_group_member_day('00000000-0000-0000-0009-000000000001', tests.today())
     where user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  $$ values (600.00::numeric, 2000, 60.00::numeric, 140.0::numeric, 7842, true) $$,
  '6: group data shows calories/protein vs target, steps and workout status'
);
select results_eq(
  $$ select calories, steps, workout_logged
     from public.get_group_member_day('00000000-0000-0000-0009-000000000001', tests.today())
     where user_id = '00000000-0000-0000-0000-0000000000c3' $$,
  $$ values (null::numeric, null::integer, false) $$,
  'missing data stays missing (null), never zero'
);
select is(
  (select count(*) from public.weight_measurements where user_id = '00000000-0000-0000-0000-0000000000c3'),
  0::bigint,
  '7: group member cannot read another member''s weight'
);
select is(
  (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'),
  0::bigint,
  '7: group member cannot read another member''s profile'
);
select ok(
  pg_get_function_result('public.get_group_member_day(uuid, date)'::regprocedure) !~* 'weight|fat|inbody|muscle|bmi|bmr|height|birth',
  '7: group data function exposes no body metrics'
);
select is(
  (select count(*) from public.group_memberships), 2::bigint,
  'member sees the current roster of their group'
);
select is(
  tests.affected($$ update public.group_memberships set is_active = false where user_id = '00000000-0000-0000-0000-0000000000c3' $$),
  0::bigint,
  'a regular member cannot remove other members'
);

-- ===========================================================================
-- 9. Deleted records are excluded from normal queries
-- ===========================================================================
select lives_ok(
  $$ update public.meals set is_deleted = true, delete_reason = 'duplicate' where id = '00000000-0000-0000-0001-000000000002' $$,
  'user can soft-delete an editable meal'
);
select is(
  (select count(*) from public.active_meals where id = '00000000-0000-0000-0001-000000000002'),
  0::bigint,
  '9: deleted meal excluded from active_meals'
);
select is(
  (select count(*) from public.active_meal_items where meal_id = '00000000-0000-0000-0001-000000000002'),
  0::bigint,
  '9: items of a deleted meal excluded from active_meal_items'
);
select results_eq(
  $$ select deleted_by, deleted_at is not null from public.meals where id = '00000000-0000-0000-0001-000000000002' $$,
  $$ values ('00000000-0000-0000-0000-0000000000a1'::uuid, true) $$,
  'soft deletion records who and when'
);
select throws_ok(
  $$ update public.meals set is_deleted = false where id = '00000000-0000-0000-0001-000000000002' $$,
  '42501', null, 'users cannot restore deleted records'
);
select lives_ok(
  $$ update public.steps_entries set is_deleted = true where id = '00000000-0000-0000-000b-000000000001' $$,
  'user can delete the latest step entry'
);
select is((select steps from public.daily_steps), 3000, '9: previous valid step entry becomes active again');

-- Group departure: a member who leaves loses access.
select lives_ok(
  $$ update public.group_memberships set is_active = false
     where user_id = '00000000-0000-0000-0000-0000000000a1' and group_id = '00000000-0000-0000-0009-000000000001' $$,
  'any member may leave'
);
select throws_ok(
  $$ select * from public.get_group_member_day('00000000-0000-0000-0009-000000000001', tests.today()) $$,
  '42501', null, 'former member can no longer read group data'
);

select tests.login('00000000-0000-0000-0000-0000000000c3');
select is(
  (select count(*) from public.get_group_member_day('00000000-0000-0000-0009-000000000001', tests.today())),
  1::bigint,
  'a departed member''s data is no longer visible to the group'
);

select tests.login('00000000-0000-0000-0000-0000000000b2');
select throws_ok(
  $$ select * from public.get_group_member_day('00000000-0000-0000-0009-000000000001', tests.today()) $$,
  '42501', null, '6: non-members cannot read group data'
);
select is((select count(*) from public.groups), 0::bigint, 'non-members cannot see the group');

-- Feedback window open for Bob (no cycle this month), only for the current month.
select lives_ok(
  $$ insert into public.recommendation_feedback (user_id, feedback_month, feedback)
     values ('00000000-0000-0000-0000-0000000000b2', date_trunc('month', tests.today())::date, 'More variety please') $$,
  'feedback can be entered during the feedback window'
);
select throws_ok(
  $$ insert into public.recommendation_feedback (user_id, feedback_month, feedback)
     values ('00000000-0000-0000-0000-0000000000b2', (date_trunc('month', tests.today()) - interval '1 month')::date, 'old') $$,
  '42501', null, 'feedback cannot be entered for another month'
);

-- ===========================================================================
-- 3/4. Managers see assigned users only, read-only
-- ===========================================================================
select tests.login('00000000-0000-0000-0000-0000000000d4');
select is(
  (select count(*) from public.meals where user_id = '00000000-0000-0000-0000-0000000000a1'),
  2::bigint,
  '3: manager can read an assigned user''s meals'
);
select is(
  (select count(*) from public.profiles), 2::bigint,
  '3: manager sees own and assigned profiles only'
);
select is(
  (select count(*) from public.weight_measurements where user_id = '00000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  '4: manager cannot read an unassigned user''s data'
);
select is(
  tests.affected($$ update public.workouts set manual_calories = 1 where user_id = '00000000-0000-0000-0000-0000000000a1' $$),
  0::bigint,
  'manager access is read-only'
);

-- ===========================================================================
-- 5. Admins access operational data; corrections are audited
-- ===========================================================================
select tests.login('00000000-0000-0000-0000-0000000000e5');
select is(
  (select count(*) from public.weight_measurements where user_id = '00000000-0000-0000-0000-0000000000b2'),
  1::bigint,
  '5: admin can read any user''s records'
);
select is((select count(*) from public.recommendation_processing_users), 1::bigint, '5: admin can inspect AI processing');

select set_config('app.audit_reason', 'Wrong calories entered', true);
select lives_ok(
  $$ update public.workouts set manual_calories = 500 where id = '00000000-0000-0000-0003-000000000001' $$,
  '5: admin can correct a locked record'
);
select results_eq(
  $$ select action::text, actor_user_id, target_user_id, reason, old_values_json ->> 'manual_calories', new_values_json ->> 'manual_calories'
     from public.audit_logs where entity_id = '00000000-0000-0000-0003-000000000001' $$,
  $$ values ('ADMIN_CORRECTION', '00000000-0000-0000-0000-0000000000e5'::uuid, '00000000-0000-0000-0000-0000000000a1'::uuid,
             'Wrong calories entered', null::text, '500.0') $$,
  'admin correction audited with original, new value, admin and reason'
);
select lives_ok(
  $$ update public.meals set is_deleted = true where id = '00000000-0000-0000-0001-000000000001' $$,
  'admin can delete a historical meal'
);
select is(
  (select action::text from public.audit_logs where entity_id = '00000000-0000-0000-0001-000000000001'),
  'DELETE',
  'admin deletion of a historical meal is audited'
);

-- Food master change does not alter historical snapshots.
update public.food_items set calories = 999 where id = '00000000-0000-0000-0004-000000000001';
select is(
  (select snapshot_calories from public.meal_items where id = '00000000-0000-0000-0002-000000000001'),
  600.00::numeric,
  'changing the food master never rewrites logged meal snapshots'
);

-- Authority boundaries of ADMIN
select throws_ok(
  $$ insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000b2', 'SUPER_ADMIN') $$,
  '42501', null, 'admin cannot grant super admin'
);
select lives_ok(
  $$ insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000b2', 'MANAGER') $$,
  'admin can grant the manager role'
);
select throws_ok(
  $$ update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000f6' $$,
  '42501', null, 'admin cannot deactivate a super admin'
);
select is(
  tests.affected($$ update public.system_settings set value_json = '20' where key = 'ai_batch_size' $$),
  0::bigint,
  'admin cannot change AI settings'
);
select lives_ok(
  $$ update public.system_settings set value_json = '0.90' where key = 'nutrition_tolerance' $$,
  'admin can configure nutrition tolerance'
);

-- Deactivated users lose access to their own data.
select lives_ok(
  $$ update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000b2' $$,
  'admin can deactivate a user'
);
select tests.login('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.meals), 0::bigint, 'a deactivated user cannot read their data');

-- ===========================================================================
-- 8. Audit records cannot be modified by users (or anyone)
-- ===========================================================================
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ insert into public.audit_logs (entity_type, action) values ('meals', 'DELETE') $$,
  '42501', null, '8: users cannot write audit logs'
);
select throws_ok(
  $$ delete from public.audit_logs $$,
  '42501', null, '8: users cannot delete audit logs'
);
select tests.login('00000000-0000-0000-0000-0000000000e5');
select throws_ok(
  $$ update public.audit_logs set reason = 'edited' $$,
  '42501', null, '8: even admins cannot edit audit logs'
);

-- Super admin
select tests.login('00000000-0000-0000-0000-0000000000f6');
select lives_ok(
  $$ insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'ADMIN') $$,
  'super admin can grant admin'
);
select throws_ok(
  $$ delete from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000f6' and role = 'SUPER_ADMIN' $$,
  '42501', 'Cannot remove the last active super admin', 'the last super admin cannot be removed'
);

-- Group creation through the API (INSERT … RETURNING) and group-admin removal.
select tests.login('00000000-0000-0000-0000-0000000000d4');
select lives_ok(
  $$ insert into public.groups (id, name) values ('00000000-0000-0000-0009-000000000002', 'Mike Group') returning id, code $$,
  'a user can create a group and read it back'
);
select is(
  (select role::text from public.group_memberships where group_id = '00000000-0000-0000-0009-000000000002'),
  'ADMIN',
  'the group creator becomes its admin'
);
reset role;
insert into public.group_memberships (group_id, user_id)
values ('00000000-0000-0000-0009-000000000002', '00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok(
  $$ update public.groups set code = 'ABCDEFGH' where id = '00000000-0000-0000-0009-000000000002' $$,
  '42501', null, 'the group code cannot be regenerated'
);
select is(
  tests.affected($$ update public.group_memberships set is_active = false
                    where group_id = '00000000-0000-0000-0009-000000000002' and user_id = '00000000-0000-0000-0000-0000000000a1' $$),
  1::bigint,
  'the group admin can remove a member'
);
select is(
  (select removed_by from public.group_memberships
   where group_id = '00000000-0000-0000-0009-000000000002' and user_id = '00000000-0000-0000-0000-0000000000a1'),
  '00000000-0000-0000-0000-0000000000d4'::uuid,
  'removal records who removed the member'
);

reset role;
select * from finish();
rollback;
