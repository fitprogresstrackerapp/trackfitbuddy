-- Monthly AI recommendation engine: processing authorization, duplicate
-- prevention, budget reservation, feedback ownership and locking, cycle and
-- snapshot transitions, history preservation and usage records.
begin;
create extension if not exists pgtap with schema extensions;

select plan(64);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.as_service() returns void language sql
as $$ select set_config('request.jwt.claims', '{"role": "service_role"}', true) $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create function tests.month() returns date language sql stable
as $$ select date_trunc('month', tests.today())::date $$;
create function tests.affected(p_sql text) returns integer language plpgsql
as $$ declare n integer; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
-- A valid AI output for a capacity (4×140 + 4×230 + 9×65 = 2,065 ≈ 2,100 kcal).
create function tests.output(p_capacity integer, p_calories integer default 2100) returns jsonb language sql
as $$
  select jsonb_build_object(
    'assessment', 'Based on your recent data.',
    'targets', jsonb_build_object('calories', p_calories, 'protein_g', 140, 'carbs_g', 230, 'fat_g', 65, 'fiber_g', 30),
    'long_term_goal', 'Fat loss.',
    'short_term_focus', '["GENERAL_FITNESS"]'::jsonb,
    'workout_plan', jsonb_build_object(
      'days_per_week', p_capacity,
      'sessions', (select jsonb_agg(jsonb_build_object('name', 'Session ' || n, 'type', 'FULL_BODY', 'focus', null))
                   from generate_series(1, p_capacity) n)),
    'activity_recommendation', null,
    'nutrition_suggestions', '[]'::jsonb, 'improve', '[]'::jsonb, 'watch', '[]'::jsonb,
    'summary', 'Suggested plan.')
$$;
create function tests.attempt(p_user uuid, p_status public.processing_user_status) returns uuid language sql stable
as $$ select id from public.recommendation_processing_users where user_id = p_user and status = p_status order by created_at desc limit 1 $$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;
create table tests.ids (key text primary key, id uuid);
grant all on tests.ids to authenticated, service_role;

-- Users: Alice (ready, previous cycle last month), Bob (ready, first
-- recommendation), Carol (no height), an admin and Alice's manager.
insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', '919410000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', '919410000002', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', '919410000003', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d4', '919410000004', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e5', '919410000005', 'authenticated', 'authenticated');
insert into public.profiles (id, phone, name, date_of_birth, gender, height_cm, workout_days_per_week) values
  ('00000000-0000-0000-0000-0000000000a1', '+919410000001', 'Alice', '1992-01-01', 'FEMALE', 165, 4),
  ('00000000-0000-0000-0000-0000000000b2', '+919410000002', 'Bob', '1990-01-01', 'MALE', 178, 3),
  ('00000000-0000-0000-0000-0000000000c3', '+919410000003', 'Carol', '1995-01-01', 'FEMALE', null, 3),
  ('00000000-0000-0000-0000-0000000000d4', '+919410000004', 'Admin', null, null, null, null),
  ('00000000-0000-0000-0000-0000000000e5', '+919410000005', 'Manager', null, null, null, null);
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000d4', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000e5', 'MANAGER');
insert into public.manager_user_assignments (manager_id, user_id)
values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a1');
insert into public.weight_measurements (user_id, measurement_date, weight_kg) values
  ('00000000-0000-0000-0000-0000000000a1', tests.today() - 3, 62),
  ('00000000-0000-0000-0000-0000000000b2', tests.today() - 3, 80),
  ('00000000-0000-0000-0000-0000000000c3', tests.today() - 3, 58);
insert into public.goals (id, user_id, long_term_goal, effective_from) values
  ('00000000-0000-0000-00a0-000000000081', '00000000-0000-0000-0000-0000000000a1', 'FAT_LOSS', tests.month() - 60),
  ('00000000-0000-0000-00a0-000000000082', '00000000-0000-0000-0000-0000000000b2', 'MUSCLE_GAIN', tests.today()),
  ('00000000-0000-0000-00a0-000000000083', '00000000-0000-0000-0000-0000000000c3', 'GENERAL_FITNESS', tests.today());

-- Alice's previous cycle: from the 4th of last month, still open, 1,800 kcal.
insert into public.recommendation_processing_runs (id, processing_month)
values ('00000000-0000-0000-0006-000000000081', (tests.month() - interval '1 month')::date);
insert into public.recommendation_processing_users (
  id, processing_run_id, user_id, status, processing_month, parsed_recommendation_json, generated_at,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  provider, model, prompt_version
) values (
  '00000000-0000-0000-0007-000000000081', '00000000-0000-0000-0006-000000000081', '00000000-0000-0000-0000-0000000000a1',
  'SUCCESS', (tests.month() - interval '1 month')::date, '{}', now(), 1800, 120, 200, 60, 30, 'test', 'test-model', 'recommendation-v1'
);
insert into public.recommendation_cycles (
  id, user_id, processing_month, processing_user_id, goal_id, workout_days_per_week, period_start,
  generated_at, review_deadline, status, locked_at, parsed_output_json, provider, model, prompt_version,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g, workout_plan_json
) values (
  '00000000-0000-0000-0008-000000000081', '00000000-0000-0000-0000-0000000000a1', (tests.month() - interval '1 month')::date,
  '00000000-0000-0000-0007-000000000081', '00000000-0000-0000-00a0-000000000081', 3, (tests.month() - interval '1 month')::date + 3,
  now(), (tests.month() - interval '1 month')::date + 4, 'LOCKED', now(), '{}', 'test', 'test-model', 'recommendation-v1',
  1800, 120, 200, 60, 30, 1800, 120, 200, 60, 30, '{"sessions": [{"name": "A"}, {"name": "B"}, {"name": "C"}]}'
);
insert into public.daily_target_snapshots (
  user_id, recommendation_cycle_id, target_date, calories, protein_g, carbs_g, fat_g, fiber_g,
  workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance
)
select '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0008-000000000081', d, 1800, 120, 200, 60, 30, 3, 0.85, 0.85, 1.10
from generate_series((tests.month() - interval '1 month')::date + 3, tests.today() - 1, interval '1 day') d;

-- The budget is global per month: other data may already have spent some of
-- it, so this test's budget is relative to what is already used.
create table tests.baseline as select spent + reserved as used from private.ai_month_spend(tests.month());
create function tests.set_budget(p_extra numeric) returns void language sql
as $$
  insert into public.system_settings (key, value_json)
  values ('ai_monthly_budget', to_jsonb((select used from tests.baseline) + p_extra))
  on conflict (key) do update set value_json = excluded.value_json
$$;
grant select on tests.baseline to authenticated, service_role;
grant execute on function tests.set_budget(numeric) to service_role;
select tests.set_budget(100);

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
select has_column('public', 'recommendation_processing_users', 'reserved_cost', 'attempts hold a budget reservation');
select has_column('public', 'recommendation_processing_users', 'pricing_version', 'attempts record the pricing version');
select has_column('public', 'ai_usage_records', 'pricing_version', 'usage records the pricing version');
select has_column('public', 'recommendation_processing_runs', 'mode', 'runs record the admin action');
select throws_ok(
  $$ update public.system_settings set value_json = '{"version": "x"}' where key = 'ai_pricing' $$,
  '22023', null, 'invalid pricing configuration is rejected');
select throws_ok(
  $$ update public.system_settings set value_json = '9' where key = 'ai_max_retries' $$,
  '22023', null, 'the retry count is bounded');

-- ---------------------------------------------------------------------------
-- Authorization: processing functions are service-role only
-- ---------------------------------------------------------------------------
set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000d4');
select throws_ok(
  $$ select public.enqueue_recommendation_run('PROCESS', null, true, '00000000-0000-0000-0000-0000000000d4',
       'mock', 'm', 'recommendation-v1', 12, 100, 'INR') $$,
  '42501', null, 'even an admin session cannot queue processing directly');
select throws_ok(
  $$ select public.complete_recommendation_attempt('00000000-0000-0000-0007-000000000081', '{}', '{}', '[]') $$,
  '42501', null, 'recommendations cannot be written from a client session');
select throws_ok(
  $$ select public.claim_recommendation_attempt('00000000-0000-0000-0007-000000000081', '{}', 0, 'm', 'm', 'v', 'p', 'i', null, 3::smallint) $$,
  '42501', null, 'the budget cannot be claimed from a client session');
select ok(
  (select state = 'READY' from public.recommendation_overview() where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'admins see readiness in the overview');
select is(
  (select array[state] || missing_fields from public.recommendation_overview() where user_id = '00000000-0000-0000-0000-0000000000c3'),
  array['INCOMPLETE', 'height_cm'], 'an incomplete user is listed with what is missing');
select ok((select budget = (select used from tests.baseline) + 100 from public.ai_usage_summary(tests.month())),
  'admins see usage against the budget');

select tests.login('00000000-0000-0000-0000-0000000000e5');
select throws_ok($$ select * from public.recommendation_overview() $$, '42501', null, 'managers cannot see processing');
select throws_ok($$ select * from public.ai_usage_summary(tests.month()) $$, '42501', null, 'managers cannot see AI usage');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select * from public.recommendation_overview() $$, '42501', null, 'users cannot see processing');

-- ---------------------------------------------------------------------------
-- Feedback ownership (spec §31)
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000b2');
select lives_ok(
  $$ insert into public.recommendation_feedback (user_id, feedback_month, feedback)
     values ('00000000-0000-0000-0000-0000000000b2', tests.month(), 'The split felt hard.') $$,
  'a user writes this month''s check-in');
select is(
  tests.affected($$ update public.recommendation_feedback set feedback = 'Prefer more variety.'
                    where user_id = '00000000-0000-0000-0000-0000000000b2' $$),
  1, 'and can update it before processing');
select throws_ok(
  $$ insert into public.recommendation_feedback (user_id, feedback_month, feedback)
     values ('00000000-0000-0000-0000-0000000000b2', (tests.month() - interval '1 month')::date, 'Late') $$,
  '42501', null, 'a past month''s check-in cannot be written');
select throws_ok(
  $$ insert into public.recommendation_feedback (user_id, feedback_month, feedback, locked_at)
     values ('00000000-0000-0000-0000-0000000000b2', (tests.month() + interval '1 month')::date, 'x', now()) $$,
  '42501', null, 'users cannot set the lock themselves');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.recommendation_feedback where user_id = '00000000-0000-0000-0000-0000000000b2'),
  0::bigint, 'another user''s check-in is invisible');
select is(
  tests.affected($$ update public.recommendation_feedback set feedback = 'hijack' where user_id = '00000000-0000-0000-0000-0000000000b2' $$),
  0, 'and cannot be changed');

-- ---------------------------------------------------------------------------
-- Queueing and duplicate prevention
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;
select tests.as_service();
insert into tests.ids
select 'run1', (public.enqueue_recommendation_run('PROCESS',
  array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c3']::uuid[],
  false, '00000000-0000-0000-0000-0000000000d4', 'mock', 'mock-recommender-1', 'recommendation-v1', 12, 100, 'INR') ->> 'run_id')::uuid;
select is(
  (select array_agg(status::text || coalesce(':' || skip_reason, '') order by user_id)
   from public.recommendation_processing_users where processing_run_id = (select id from tests.ids where key = 'run1')),
  array['PENDING', 'PENDING', 'SKIPPED:Profile incomplete'], 'ready users are queued; an incomplete one is skipped with a reason');
select is(
  public.enqueue_recommendation_run('PROCESS', array['00000000-0000-0000-0000-0000000000a1']::uuid[], false,
    '00000000-0000-0000-0000-0000000000d4', 'mock', 'mock-recommender-1', 'recommendation-v1', 12, 100, 'INR') ->> 'ignored',
  '1', 'a user already queued is not queued twice');
select throws_ok(
  $$ insert into public.recommendation_processing_users (processing_run_id, user_id, status)
     values ((select id from tests.ids where key = 'run1'), '00000000-0000-0000-0000-0000000000a1', 'PENDING') $$,
  '23505', null, 'one open attempt per user is a database constraint');
select throws_ok(
  $$ select public.enqueue_recommendation_run('RETRY', null, true, null, 'mock', 'm', 'recommendation-v1', 12, 100, 'INR') $$,
  '22023', null, 'process_all_ready only queues ready users');

-- ---------------------------------------------------------------------------
-- Budget reservation (spec §39): spent + reserved + estimate ≤ budget
-- ---------------------------------------------------------------------------
select is(
  public.claim_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000b2', 'PENDING'),
    '{"feedback": null, "workout": {"days_per_week": 3}}', 60, 'mock', 'mock-recommender-1', 'recommendation-v1',
    'pv1', 'recommendation-input-v1', '00000000-0000-0000-00a0-000000000082', 3::smallint) -> 'input' ->> 'feedback',
  'Prefer more variety.', 'a claim freezes the user''s current check-in into the stored input');
select is(
  (select array[status::text, reserved_cost::text, pricing_version] from public.recommendation_processing_users
   where id = tests.attempt('00000000-0000-0000-0000-0000000000b2', 'PROCESSING')),
  array['PROCESSING', '60.000000', 'pv1'], 'the claimed attempt holds its reservation');
select is(
  public.claim_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000a1', 'PENDING'),
    '{}', 60, 'mock', 'mock-recommender-1', 'recommendation-v1', 'pv1', 'recommendation-input-v1',
    '00000000-0000-0000-00a0-000000000081', 4::smallint) ->> 'result',
  'BUDGET_EXCEEDED', 'over budget (60 reserved + 60 > 100): not claimed');
select is((select status::text from public.recommendation_processing_users
           where id = tests.attempt('00000000-0000-0000-0000-0000000000a1', 'PENDING')),
  'PENDING', 'the refused user stays PENDING');
select is(
  public.claim_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000a1', 'PENDING'),
    '{}', 40, 'mock', 'mock-recommender-1', 'recommendation-v1', 'pv1', 'recommendation-input-v1',
    '00000000-0000-0000-00a0-000000000081', 4::smallint) ->> 'result',
  'CLAIMED', 'exactly at the budget (60 + 40 = 100) is allowed');

-- Bob's check-in is closed while his recommendation is generated.
reset role;
set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000b2');
select is(
  tests.affected($$ update public.recommendation_feedback set feedback = 'Changed' where user_id = '00000000-0000-0000-0000-0000000000b2' $$),
  0, 'feedback cannot change while processing runs');

-- ---------------------------------------------------------------------------
-- Success: new cycle, snapshots, feedback lock, usage
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;
select tests.as_service();
insert into tests.ids
select 'bob_cycle', public.complete_recommendation_attempt(
  tests.attempt('00000000-0000-0000-0000-0000000000b2', 'PROCESSING'),
  '{"text": "raw"}', tests.output(3),
  '[{"provider": "mock", "model": "mock-recommender-1", "input_tokens": 900, "output_tokens": 300, "estimated_cost": 10, "succeeded": true}]');
select is(
  (select array[status::text, period_start::text, review_deadline::text, final_calories::text, recommended_calories::text,
                goal_id::text, workout_days_per_week::text, jsonb_array_length(workout_plan_json -> 'sessions')::text]
   from public.recommendation_cycles where id = (select id from tests.ids where key = 'bob_cycle')),
  array['IN_REVIEW', tests.today()::text, (tests.today() + 1)::text, '2100', '2100',
        '00000000-0000-0000-00a0-000000000082', '3', '3'],
  'the new cycle starts today in review, final = recommended, with the goal and capacity used');
select is(
  (select array[count(*)::text, min(target_date)::text, max(target_date)::text]
   from public.daily_target_snapshots where recommendation_cycle_id = (select id from tests.ids where key = 'bob_cycle')),
  array['62', tests.today()::text, (tests.today() + 61)::text], 'snapshots are written from the new start date');
select ok(
  (select locked_at is not null and recommendation_cycle_id = (select id from tests.ids where key = 'bob_cycle')
   from public.recommendation_feedback where user_id = '00000000-0000-0000-0000-0000000000b2'),
  'the check-in used is locked and linked to the cycle');
select is(
  (select array[status::text, coalesce(reserved_cost::text, 'null'), input_tokens::text, estimated_cost::text]
   from public.recommendation_processing_users where processing_run_id = (select id from tests.ids where key = 'run1')
     and user_id = '00000000-0000-0000-0000-0000000000b2'),
  array['SUCCESS', 'null', '900', '10.000000'], 'the attempt succeeds and releases its reservation');
select is(
  (select count(*) from public.ai_usage_records u join public.recommendation_processing_users a on a.id = u.processing_user_id
   where a.user_id = '00000000-0000-0000-0000-0000000000b2'),
  1::bigint, 'every provider request is recorded');
select is(
  (select array[(spent - (select used from tests.baseline))::text, reserved::text] from private.ai_month_spend(tests.month())),
  array['10.000000', '40.000000'], 'month spend and running reservations are tracked');

-- Invalid output never becomes a recommendation.
select throws_ok(
  $$ select public.complete_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000a1', 'PROCESSING'),
       '{}', tests.output(4, 12000), '[]') $$,
  '22023', null, 'out-of-range targets are rejected by the database too');
select throws_ok(
  $$ select public.complete_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000a1', 'PROCESSING'),
       '{}', tests.output(3), '[]') $$,
  '22023', null, 'a template that does not match the capacity is rejected');
select lives_ok(
  $$ select public.fail_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000a1', 'PROCESSING'),
       'Target out of range: calories', '{"text": "{\"targets\": {\"calories\": 12000}}"}',
       '[{"provider": "mock", "model": "mock-recommender-1", "input_tokens": 800, "output_tokens": 200, "estimated_cost": 5, "succeeded": false, "error_message": "Target out of range: calories"}]') $$,
  'a failed generation is recorded');
select is(
  (select array[status::text, failure_reason, coalesce(reserved_cost::text, 'null'), raw_output_json ->> 'text']
   from public.recommendation_processing_users where id = tests.attempt('00000000-0000-0000-0000-0000000000a1', 'FAILED')),
  array['FAILED', 'Target out of range: calories', 'null', '{"targets": {"calories": 12000}}'],
  'the failure keeps its reason and raw output and releases the reservation');
select is(
  (select count(*) from public.recommendation_cycles where user_id = '00000000-0000-0000-0000-0000000000a1'),
  1::bigint, 'a failure creates no recommendation: the previous one stays in force');
select ok(private.feedback_window_open('00000000-0000-0000-0000-0000000000a1', tests.month()),
  'after a failure the check-in window is open again');

-- ---------------------------------------------------------------------------
-- Retry → second recommendation: previous cycle closes, history unchanged
-- ---------------------------------------------------------------------------
select is(
  public.enqueue_recommendation_run('PROCESS', array['00000000-0000-0000-0000-0000000000b2']::uuid[], false,
    '00000000-0000-0000-0000-0000000000d4', 'mock', 'mock-recommender-1', 'recommendation-v1', 12, 100, 'INR') ->> 'skipped',
  '1', 'a successfully processed user is not processed again');
insert into tests.ids
select 'run_retry', (public.enqueue_recommendation_run('RETRY', array['00000000-0000-0000-0000-0000000000a1']::uuid[], false,
  '00000000-0000-0000-0000-0000000000d4', 'mock', 'mock-recommender-1', 'recommendation-v1', 12, 100, 'INR') ->> 'run_id')::uuid;
select is(
  (select attempt_number from public.recommendation_processing_users
   where processing_run_id = (select id from tests.ids where key = 'run_retry')),
  2::smallint, 'a retry is a new attempt');
select is(
  public.claim_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000a1', 'PENDING'),
    '{}', 90, 'mock', 'mock-recommender-1', 'recommendation-v1', 'pv1', 'recommendation-input-v1',
    '00000000-0000-0000-00a0-000000000081', 4::smallint) ->> 'result',
  'BUDGET_EXCEEDED', 'recorded spend counts against the budget (15 spent + 90 > 100)');
select tests.set_budget(1000);
select is(
  public.claim_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000a1', 'PENDING'),
    '{}', 40, 'mock', 'mock-recommender-1', 'recommendation-v1', 'pv1', 'recommendation-input-v1',
    '00000000-0000-0000-00a0-000000000081', 4::smallint) ->> 'result',
  'CLAIMED', 'processing resumes once the budget is raised');
insert into tests.ids
select 'alice_cycle', public.complete_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000a1', 'PROCESSING'),
  '{}', tests.output(4), '[]');
select is(
  (select array[status::text, period_end::text, workout_days_per_week::text, final_calories::text]
   from public.recommendation_cycles where id = '00000000-0000-0000-0008-000000000081'),
  array['LOCKED', (tests.today() - 1)::text, '3', '1800'],
  'the previous cycle ends yesterday with its own capacity and targets');
select is(
  (select array[previous_cycle_id::text, workout_days_per_week::text]
   from public.recommendation_cycles where id = (select id from tests.ids where key = 'alice_cycle')),
  array['00000000-0000-0000-0008-000000000081', '4'], 'the new cycle follows it with the new capacity');
select is(
  (select array_agg(calories::text || '/' || workouts_per_week order by target_date)
   from public.daily_target_snapshots
   where user_id = '00000000-0000-0000-0000-0000000000a1' and target_date in (tests.today() - 1, tests.today())),
  array['1800/3', '2100/4'], 'yesterday keeps its snapshot; today uses the new targets');
select is(
  (select array_agg(status::text order by attempt_number) from public.recommendation_processing_users
   where user_id = '00000000-0000-0000-0000-0000000000a1' and processing_month = tests.month()),
  array['FAILED', 'SUCCESS'], 'failed and successful attempts are both kept');

-- ---------------------------------------------------------------------------
-- Reprocess: explicit, replaces this month's cycle, keeps it
-- ---------------------------------------------------------------------------
select is(
  public.enqueue_recommendation_run('REPROCESS', array['00000000-0000-0000-0000-0000000000b2']::uuid[], false,
    '00000000-0000-0000-0000-0000000000d4', 'mock', 'mock-recommender-1', 'recommendation-v1', 12, 1000, 'INR') ->> 'queued',
  '1', 'reprocess queues a user who already has a recommendation');
select is(
  public.claim_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000b2', 'PENDING'),
    '{}', 10, 'mock', 'mock-recommender-1', 'recommendation-v1', 'pv1', 'recommendation-input-v1',
    '00000000-0000-0000-00a0-000000000082', 3::smallint) ->> 'result',
  'CLAIMED', 'the reprocess attempt is claimed');
insert into tests.ids
select 'bob_cycle2', public.complete_recommendation_attempt(tests.attempt('00000000-0000-0000-0000-0000000000b2', 'PROCESSING'),
  '{}', tests.output(3, 2200), '[]');
select is(
  (select array_agg(status::text || ':' || final_calories order by status = 'REPLACED' desc)
   from public.recommendation_cycles where user_id = '00000000-0000-0000-0000-0000000000b2'),
  array['REPLACED:2100', 'IN_REVIEW:2200'], 'the previous recommendation is kept (replaced), the new one is current');
select is(
  (select recommendation_cycle_id from public.recommendation_feedback where user_id = '00000000-0000-0000-0000-0000000000b2'),
  (select id from tests.ids where key = 'bob_cycle2'), 'the check-in is linked to the current recommendation');
select throws_ok(
  $$ insert into public.recommendation_cycles (
       user_id, processing_month, processing_user_id, workout_days_per_week, period_start, generated_at, review_deadline,
       parsed_output_json, provider, model, prompt_version,
       recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
       final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g, workout_plan_json)
     select user_id, processing_month, processing_user_id, 3, period_start, now(), review_deadline, '{}', 'x', 'x', 'x',
            2000, 1, 1, 1, 1, 2000, 1, 1, 1, 1, '{}'
     from public.recommendation_cycles where id = (select id from tests.ids where key = 'bob_cycle') $$,
  '23505', null, 'two current recommendations for one user and month are impossible');

-- Run status and stale recovery.
select is(public.refresh_recommendation_run((select id from tests.ids where key = 'run1'), false)::text,
  'PARTIAL', 'a run with a failure and a success is PARTIAL');
insert into public.recommendation_processing_users (processing_run_id, user_id, attempt_number, status, processing_month, reserved_cost, started_at)
values ((select id from tests.ids where key = 'run1'), '00000000-0000-0000-0000-0000000000c3', 2, 'PROCESSING', tests.month(), 5, now() - interval '1 hour');
select is(public.recover_stale_recommendation_attempts(15), 1, 'a stuck PROCESSING attempt is recovered');
select is(
  (select array[status::text, failure_reason, coalesce(reserved_cost::text, 'null')] from public.recommendation_processing_users
   where user_id = '00000000-0000-0000-0000-0000000000c3' and started_at is not null),
  array['FAILED', 'Processing interrupted', 'null'], 'as FAILED with its reservation released (never retried automatically)');

-- ---------------------------------------------------------------------------
-- Users and managers: results only, never processing internals
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.recommendation_processing_users), 0::bigint, 'users never read AI input or output');
select is((select count(*) from public.ai_usage_records), 0::bigint, 'users never read AI usage');
select throws_ok($$ delete from public.recommendation_cycles where user_id = '00000000-0000-0000-0000-0000000000b2' $$,
  '42501', null, 'users cannot delete recommendations');
select tests.login('00000000-0000-0000-0000-0000000000e5');
select ok((select count(*) > 0 from public.recommendation_cycles where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'an assigned manager sees the recommendation');
select is((select count(*) from public.recommendation_cycles where user_id = '00000000-0000-0000-0000-0000000000b2'),
  0::bigint, 'but not an unrelated user''s');
reset role;

select * from finish();
rollback;
