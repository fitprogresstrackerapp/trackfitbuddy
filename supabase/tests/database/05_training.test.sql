-- Workouts & activities: log_workout / log_activity, calorie estimates and
-- overrides, locking, late entry, soft deletion and cross-user isolation.
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
-- Rows changed by a statement (RLS silently filters rows it can't see).
create function tests.affected(p_sql text) returns integer language plpgsql
as $$ declare n integer; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', '919200000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', '919200000002', 'authenticated', 'authenticated');
insert into public.profiles (id, phone, name) values
  ('00000000-0000-0000-0000-0000000000a1', '+919200000001', 'Alice'),
  ('00000000-0000-0000-0000-0000000000b2', '+919200000002', 'Bob');

-- A locked workout from last week (as created before the day ended).
insert into public.workouts (id, user_id, workout_date, workout_type, duration_minutes, estimated_calories, is_locked)
values ('00000000-0000-0000-0e00-0000000000a1', '00000000-0000-0000-0000-0000000000a1', tests.today() - 5, 'LEGS', 40, 240, true);

create table tests.ids (key text primary key, id uuid);
grant all on tests.ids to authenticated;

set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000a1');

-- ---------------------------------------------------------------------------
-- Workouts: logging and calorie estimates
-- ---------------------------------------------------------------------------
select lives_ok($$
  insert into tests.ids values ('push', public.log_workout(tests.today(), 'UPPER_BODY', 45, '  Push Strength  '))
$$, 'log_workout creates a workout for today');
select results_eq(
  $$ select workout_type, custom_name, duration_minutes, estimated_calories, manual_calories, final_calories, is_locked
     from public.workouts where id = (select id from tests.ids where key = 'push') $$,
  $$ values ('UPPER_BODY'::text, 'Push Strength'::text, 45, 270.0::numeric, null::numeric, 270.0::numeric, false) $$,
  'estimate = duration × configured rate (45 × 6); optional name kept for a predefined type'
);
select lives_ok($$
  insert into tests.ids values ('hiit', public.log_workout(tests.today(), 'HIIT', 30, null, 400))
$$, 'a manual calorie value can be given');
select results_eq(
  $$ select estimated_calories, manual_calories, final_calories from public.workouts
     where id = (select id from tests.ids where key = 'hiit') $$,
  $$ values (300.0::numeric, 400.0::numeric, 400.0::numeric) $$,
  'the manual value overrides the estimate; the estimate is still stored'
);

select lives_ok($$
  insert into public.workouts (id, user_id, workout_date, workout_type, duration_minutes, estimated_calories)
  values ('00000000-0000-0000-0e00-0000000000a2', '00000000-0000-0000-0000-0000000000a1', tests.today(), 'LEGS', 50, 9999)
$$, 'a direct insert for today is allowed');
select is(
  (select estimated_calories from public.workouts where id = '00000000-0000-0000-0e00-0000000000a2'),
  300.0::numeric, 'a client-supplied estimate is ignored');

select lives_ok(
  $$ update public.workouts set duration_minutes = 60 where id = (select id from tests.ids where key = 'push') $$,
  'today''s workout is editable');
select is(
  (select estimated_calories from public.workouts where id = (select id from tests.ids where key = 'push')),
  360.0::numeric, 'changing the duration recomputes the estimate');
select lives_ok(
  $$ update public.workouts set estimated_calories = 1 where id = (select id from tests.ids where key = 'push') $$,
  'an update touching only the estimate runs…');
select is(
  (select estimated_calories from public.workouts where id = (select id from tests.ids where key = 'push')),
  360.0::numeric, '…but a user cannot set the estimate directly');
select lives_ok(
  $$ update public.workouts set manual_calories = null where id = (select id from tests.ids where key = 'hiit') $$,
  'the manual value can be removed while editable');
select is(
  (select final_calories from public.workouts where id = (select id from tests.ids where key = 'hiit')),
  300.0::numeric, 'without a manual value the estimate is used');

select throws_ok(
  $$ select public.log_workout(tests.today(), 'CUSTOM', 30) $$,
  '23514', null, 'a CUSTOM workout needs a name');
select lives_ok(
  $$ insert into tests.ids values ('custom', public.log_workout(tests.today(), 'CUSTOM', 30, 'Mobility')) $$,
  'a named CUSTOM workout is accepted');
select throws_ok(
  $$ select public.log_workout(tests.today(), 'YOGA', 30) $$,
  '23514', null, 'unknown workout types are rejected');
select throws_ok(
  $$ select public.log_workout(tests.today(), 'LEGS', 0) $$,
  '23514', null, 'duration must be positive');
select throws_ok(
  $$ select public.log_workout(tests.today(), 'LEGS', 30, null, -5) $$,
  '23514', null, 'a manual calorie value cannot be negative');
select throws_ok(
  $$ select public.log_workout(tests.today() + 1, 'LEGS', 30) $$,
  '22023', 'Training cannot be logged for a future date', 'future workouts are rejected');

-- ---------------------------------------------------------------------------
-- Locking and late entry
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.workouts set duration_minutes = 10 where id = '00000000-0000-0000-0e00-0000000000a1' $$,
  '42501', 'Record is locked and can no longer be changed', 'a locked workout cannot be edited');
select throws_ok(
  $$ update public.workouts set is_deleted = true where id = '00000000-0000-0000-0e00-0000000000a1' $$,
  '42501', 'Record is locked and can no longer be changed', 'a locked workout cannot be deleted');
select throws_ok(
  $$ insert into public.workouts (user_id, workout_date, workout_type, duration_minutes, estimated_calories)
     values ('00000000-0000-0000-0000-0000000000a1', tests.today() - 2, 'LEGS', 30, 0) $$,
  '42501', null, 'direct past-date inserts are still rejected');
select lives_ok($$
  insert into tests.ids values ('late', public.log_workout(tests.today() - 2, 'BACK_BICEPS', 50))
$$, 'a missing past workout can be added through log_workout');
select throws_ok(
  $$ update public.workouts set manual_calories = 10 where id = (select id from tests.ids where key = 'late') $$,
  '42501', 'Record is locked and can no longer be changed', 'a late workout is locked once created');
select throws_ok(
  $$ select public.log_workout(tests.today() - 91, 'LEGS', 30) $$,
  '22023', null, 'late entry is limited to the last 90 days');

-- ---------------------------------------------------------------------------
-- Soft deletion and weekly counting inputs
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.workouts set is_deleted = true where id = (select id from tests.ids where key = 'custom') $$,
  'today''s workout can be soft-deleted');
select is(
  (select count(*) from public.active_workouts
   where user_id = '00000000-0000-0000-0000-0000000000a1' and workout_date = tests.today()),
  3::bigint, 'deleted workouts are excluded from active_workouts');
select is(
  (select count(distinct workout_date) from public.active_workouts
   where user_id = '00000000-0000-0000-0000-0000000000a1'
     and workout_date in (tests.today(), tests.today() - 2)),
  2::bigint, 'several workouts on one day are one workout day');

-- ---------------------------------------------------------------------------
-- Activities
-- ---------------------------------------------------------------------------
select lives_ok($$
  insert into tests.ids values ('cricket', public.log_activity(tests.today(), 'CRICKET', 90))
$$, 'log_activity creates an activity for today');
select results_eq(
  $$ select activity_type, estimated_calories, final_calories from public.activities
     where id = (select id from tests.ids where key = 'cricket') $$,
  $$ values ('CRICKET'::text, 450.0::numeric, 450.0::numeric) $$,
  'activity estimate uses the activity rate (90 × 5)');
select lives_ok(
  $$ update public.activities set manual_calories = 620 where id = (select id from tests.ids where key = 'cricket') $$,
  'an activity can be given a manual value while editable');
select is(
  (select final_calories from public.activities where id = (select id from tests.ids where key = 'cricket')),
  620.0::numeric, 'manual activity calories override the estimate');
select throws_ok(
  $$ select public.log_activity(tests.today(), 'CUSTOM', 30) $$,
  '23514', null, 'a CUSTOM activity needs a name');
select lives_ok(
  $$ select public.log_activity(tests.today() - 1, 'WALKING', 40) $$,
  'a missing past activity can be added through log_activity');
select throws_ok(
  $$ update public.activities set is_deleted = true
     where user_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = tests.today() - 1 $$,
  '42501', 'Record is locked and can no longer be changed', 'a late activity is locked once created');
select is(
  (public.training_calorie_rates() -> 'activity' ->> 'WALKING')::numeric,
  4::numeric, 'users can read the configured rates for previews');

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000b2');
select is(
  (select count(*) from public.workouts where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'another user cannot read the owner''s workouts');
select is(
  (select count(*) from public.activities where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'another user cannot read the owner''s activities');
select is(
  tests.affected($$ update public.workouts set manual_calories = 1 where user_id = '00000000-0000-0000-0000-0000000000a1' $$),
  0, 'another user cannot change the owner''s workouts');
select throws_ok(
  $$ insert into public.activities (user_id, activity_date, activity_type, duration_minutes, estimated_calories)
     values ('00000000-0000-0000-0000-0000000000a1', tests.today(), 'WALKING', 10, 0) $$,
  '42501', null, 'another user cannot create records for the owner');

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------
reset role;
select throws_ok(
  $$ update public.system_settings set value_json = '{"workout": {"default": -1}, "activity": {"default": 5}}'
     where key = 'training_calorie_rates' $$,
  '22023', null, 'invalid rates are rejected');
update public.system_settings
set value_json = jsonb_set(value_json, '{workout,default}', '9')
where key = 'training_calorie_rates';
select is(
  (select estimated_calories from public.workouts where id = '00000000-0000-0000-0e00-0000000000a2'),
  300.0::numeric, 'changing the rates never rewrites stored estimates');

select * from finish();
rollback;
