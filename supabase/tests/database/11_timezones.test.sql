-- Date rules follow the USER's timezone (profiles.timezone), never the
-- database's or one fixed zone. Two users in zones that are always on
-- different calendar days — Kiritimati (UTC+14) and Pago Pago (UTC−11) are 25
-- hours apart — so every assertion holds at any time of day:
--   east  "today" = west "today" + 1
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.east() returns date language sql stable
as $$ select (now() at time zone 'Pacific/Kiritimati')::date $$;
create function tests.west() returns date language sql stable
as $$ select (now() at time zone 'Pacific/Pago_Pago')::date $$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
create table tests.ids (key text primary key, id uuid);
grant all on tests.ids to authenticated;

-- e1 = east user, f1 = west user. Same data, same absolute dates.
insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', '919450000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f1', '919450000002', 'authenticated', 'authenticated');
insert into public.profiles (id, phone, name, timezone) values
  ('00000000-0000-0000-0000-0000000000e1', '+919450000001', 'East', 'Pacific/Kiritimati'),
  ('00000000-0000-0000-0000-0000000000f1', '+919450000002', 'West', 'Pacific/Pago_Pago');

-- A recommendation for each, with the SAME review window: it ends on the west
-- user's today, which is the east user's yesterday.
insert into public.recommendation_processing_runs (id, processing_month)
values ('00000000-0000-0000-0006-0000000000e1', date_trunc('month', tests.west())::date);
insert into public.goals (id, user_id, long_term_goal, effective_from)
select ('00000000-0000-0000-00a0-0000000000' || s)::uuid, ('00000000-0000-0000-0000-0000000000' || s)::uuid,
       'FAT_LOSS', tests.west() - 30
from (values ('e1'), ('f1')) v(s);
insert into public.recommendation_processing_users (
  id, processing_run_id, user_id, status, parsed_recommendation_json, generated_at,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  provider, model, prompt_version
)
select ('00000000-0000-0000-0007-0000000000' || s)::uuid, '00000000-0000-0000-0006-0000000000e1',
       ('00000000-0000-0000-0000-0000000000' || s)::uuid, 'SUCCESS', '{}', now(), 2000, 140, 230, 65, 30,
       'test', 'test-model', 'v1'
from (values ('e1'), ('f1')) v(s);
insert into public.recommendation_cycles (
  id, user_id, processing_month, processing_user_id, goal_id, workout_days_per_week, period_start,
  generated_at, review_deadline, parsed_output_json, provider, model, prompt_version,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g, workout_plan_json
)
select ('00000000-0000-0000-0008-0000000000' || s)::uuid, ('00000000-0000-0000-0000-0000000000' || s)::uuid,
       date_trunc('month', tests.west())::date, ('00000000-0000-0000-0007-0000000000' || s)::uuid,
       ('00000000-0000-0000-00a0-0000000000' || s)::uuid, 3, tests.west() - 1,
       now(), tests.west(), '{"workout_plan": {"sessions": ["Upper", "Lower", "Full"]}}', 'test', 'test-model', 'v1',
       2000, 140, 230, 65, 30, 2000, 140, 230, 65, 30,
       '{"sessions": [{"name": "Upper"}, {"name": "Lower"}, {"name": "Full"}]}'
from (values ('e1'), ('f1')) v(s);
insert into public.daily_target_snapshots (
  user_id, recommendation_cycle_id, target_date, calories, protein_g, carbs_g, fat_g, fiber_g,
  workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance
)
select ('00000000-0000-0000-0000-0000000000' || s)::uuid, ('00000000-0000-0000-0008-0000000000' || s)::uuid,
       d, 2000, 140, 230, 65, 30, 3, 0.85, 0.85, 1.10
from (values ('e1'), ('f1')) v(s), generate_series(tests.west() - 1, tests.east(), interval '1 day') as d;

select is(tests.east(), tests.west() + 1, 'the two users are on different calendar days right now');
select is(private.user_local_date('00000000-0000-0000-0000-0000000000e1'), tests.east(), 'east user: today is the east date');
select is(private.user_local_date('00000000-0000-0000-0000-0000000000f1'), tests.west(), 'west user: today is the west date');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- West user: their today is the earlier date
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$ insert into tests.ids values ('w_today', public.log_weight(tests.west(), 70.0)) $$,
  'west: a weight for their own today is accepted');
select throws_ok($$ select public.log_weight(tests.east(), 70.0) $$, '22023', 'Entries cannot be dated in the future',
  'west: the east user''s today is still the future for them');
select lives_ok(
  $$ update public.weight_measurements set weight_kg = 70.4 where id = (select id from tests.ids where key = 'w_today') $$,
  'west: today''s entry stays editable');
select lives_ok($$ select public.log_steps(tests.west() - 90, 5000) $$, 'west: a late entry 90 days back (their calendar) is allowed');
select throws_ok($$ select public.log_steps(tests.west() - 91, 5000) $$, '22023', null,
  'west: 91 days back is beyond the late-entry limit');
select lives_ok(
  $$ select public.review_recommendation('00000000-0000-0000-0008-0000000000f1', 1900, 150, 220, 60, 30) $$,
  'west: the review window (ending on their today) is still open');
select throws_ok(
  $$ insert into public.recommendation_feedback (user_id, feedback_month, feedback)
     values ('00000000-0000-0000-0000-0000000000f1', (date_trunc('month', tests.west()) - interval '1 month')::date, 'old') $$,
  '42501', null, 'west: feedback is only for the month of their own local date');

-- ---------------------------------------------------------------------------
-- East user: the same absolute dates are a day later in their calendar
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000e1');
select lives_ok($$ insert into tests.ids values ('e_today', public.log_weight(tests.east(), 80.0)) $$,
  'east: a weight for their own today is accepted');
select lives_ok($$ insert into tests.ids values ('e_late', public.log_weight(tests.west(), 80.5)) $$,
  'east: the west user''s today is already yesterday — a late entry');
select throws_ok(
  $$ update public.weight_measurements set weight_kg = 79 where id = (select id from tests.ids where key = 'e_late') $$,
  '42501', 'Record is locked and can no longer be changed', 'east: that entry is locked (past day in their calendar)');
select lives_ok(
  $$ update public.weight_measurements set weight_kg = 79.8 where id = (select id from tests.ids where key = 'e_today') $$,
  'east: today''s entry stays editable');
select throws_ok($$ select public.log_weight(tests.east() + 1, 80.0) $$, '22023', 'Entries cannot be dated in the future',
  'east: tomorrow is rejected');
select lives_ok($$ select public.log_steps(tests.east() - 90, 5000) $$, 'east: a late entry 90 days back (their calendar) is allowed');
select throws_ok($$ select public.log_steps(tests.west() - 90, 5000) $$, '22023', null,
  'east: the west user''s 90-day limit is day 91 for them — rejected');
select throws_ok(
  $$ select public.review_recommendation('00000000-0000-0000-0008-0000000000e1', 1900, 150, 220, 60, 30) $$,
  '42501', 'The review window has closed; this recommendation is locked',
  'east: the same review window has already closed in their calendar');
select throws_ok(
  $$ select public.accept_recommendation('00000000-0000-0000-0008-0000000000e1') $$,
  '42501', null, 'east: nor can it be accepted after the window');

-- Each user sees only their own entries, dated in their own calendar.
select results_eq(
  $$ select measurement_date from public.weight_measurements order by measurement_date $$,
  $$ values (tests.west()), (tests.east()) $$,
  'east: own entries only, under their local dates');

reset role;
select * from finish();
rollback;
