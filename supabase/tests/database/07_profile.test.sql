-- Profile, goals, steps, weight, InBody and recommendation review:
-- ownership, locking, late entry, history preservation and review enforcement.
begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create function tests.affected(p_sql text) returns integer language plpgsql
as $$ declare n integer; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', '919400000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', '919400000002', 'authenticated', 'authenticated');
insert into public.profiles (id, phone, name) values
  ('00000000-0000-0000-0000-0000000000a1', '+919400000001', 'Alice'),
  ('00000000-0000-0000-0000-0000000000b2', '+919400000002', 'Bob');

-- Alice's recommendation: generated yesterday, so the review window is
-- yesterday..today. A goal locked by the cycle. Snapshots for both days.
insert into public.goals (id, user_id, long_term_goal, description, effective_from)
values ('00000000-0000-0000-00a0-000000000001', '00000000-0000-0000-0000-0000000000a1', 'FAT_LOSS', 'Lean out', tests.today() - 30);
insert into public.goal_focuses (goal_id, user_id, focus_type, priority)
values ('00000000-0000-0000-00a0-000000000001', '00000000-0000-0000-0000-0000000000a1', 'MUSCLE_BUILDING', 1);
insert into public.recommendation_processing_runs (id, processing_month)
values ('00000000-0000-0000-0006-000000000071', date_trunc('month', tests.today())::date);
insert into public.recommendation_processing_users (
  id, processing_run_id, user_id, status, parsed_recommendation_json, generated_at,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  provider, model, prompt_version
) values (
  '00000000-0000-0000-0007-000000000071', '00000000-0000-0000-0006-000000000071', '00000000-0000-0000-0000-0000000000a1',
  'SUCCESS', '{}', now(), 2000, 140, 230, 65, 30, 'test', 'test-model', 'v1'
);
insert into public.recommendation_cycles (
  id, user_id, processing_month, processing_user_id, goal_id, workout_days_per_week, period_start,
  generated_at, review_deadline, parsed_output_json, provider, model, prompt_version,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g, workout_plan_json
) values (
  '00000000-0000-0000-0008-000000000071', '00000000-0000-0000-0000-0000000000a1', date_trunc('month', tests.today())::date,
  '00000000-0000-0000-0007-000000000071', '00000000-0000-0000-00a0-000000000001', 3, tests.today() - 1,
  now(), tests.today(), '{"workout_plan": {"sessions": ["Upper", "Lower", "Full"]}}', 'test', 'test-model', 'v1',
  2000, 140, 230, 65, 30, 2000, 140, 230, 65, 30,
  '{"sessions": [{"name": "Upper"}, {"name": "Lower"}, {"name": "Full"}]}'
);
insert into public.daily_target_snapshots (
  user_id, recommendation_cycle_id, target_date, calories, protein_g, carbs_g, fat_g, fiber_g,
  workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance
)
select '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0008-000000000071', d, 2000, 140, 230, 65, 30, 3, 0.85, 0.85, 1.10
from generate_series(tests.today() - 1, tests.today(), interval '1 day') as d;

create table tests.ids (key text primary key, id uuid);
grant all on tests.ids to authenticated;

set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000a1');

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------
select lives_ok($$
  update public.profiles
  set name = 'Alice P', activity_level = 'MODERATELY_ACTIVE', job = 'Software Engineer',
      hobbies = 'Cricket, badminton', workout_days_per_week = 5
  where id = '00000000-0000-0000-0000-0000000000a1'
$$, 'a user can edit their own profile context');
select is(
  (select workout_days_per_week from public.recommendation_cycles where id = '00000000-0000-0000-0008-000000000071'),
  3::smallint, 'a new capacity preference never changes the current cycle');
select is(
  tests.affected($$ update public.profiles set name = 'Hacked' where id = '00000000-0000-0000-0000-0000000000b2' $$),
  0, 'another user''s profile cannot be edited');
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint,
  'another user''s profile cannot be read');
select throws_ok(
  $$ update public.profiles set workout_days_per_week = 7 where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'capacity stays within 2–6');

-- ---------------------------------------------------------------------------
-- Weight
-- ---------------------------------------------------------------------------
select lives_ok($$ insert into tests.ids values ('w1', public.log_weight(tests.today(), 75.2)) $$,
  'a manual weight can be logged for today');
-- (Checked before the second entry: within one test transaction both rows share now().)
select is(
  (select weight_kg from public.current_weights where user_id = '00000000-0000-0000-0000-0000000000a1'),
  75.20::numeric, 'the latest measurement is the current weight');
select lives_ok($$ insert into tests.ids values ('w2', public.log_weight(tests.today(), 75.0)) $$,
  'a second same-day measurement is kept, not merged');
select is(
  (select count(*) from public.weight_measurements where user_id = '00000000-0000-0000-0000-0000000000a1' and measurement_date = tests.today()),
  2::bigint, 'both same-day measurements are in the history');
select lives_ok($$ insert into tests.ids values ('wlate', public.log_weight(tests.today() - 3, 76.1)) $$,
  'a missing past weight can be added (late entry)');
select throws_ok(
  $$ update public.weight_measurements set weight_kg = 70 where id = (select id from tests.ids where key = 'wlate') $$,
  '42501', 'Record is locked and can no longer be changed', 'a past weight is locked');
select throws_ok(
  $$ insert into public.weight_measurements (user_id, measurement_date, weight_kg) values ('00000000-0000-0000-0000-0000000000a1', tests.today() - 2, 70) $$,
  '42501', null, 'direct past-dated inserts are still rejected');
select throws_ok($$ select public.log_weight(tests.today() + 1, 75) $$, '22023', 'Entries cannot be dated in the future',
  'future weights are rejected');
select throws_ok($$ select public.log_weight(tests.today(), 5) $$, '23514', null, 'weights must be in range');
select lives_ok(
  $$ update public.weight_measurements set weight_kg = 74.9 where id = (select id from tests.ids where key = 'w2') $$,
  'today''s manual weight can be corrected');

-- ---------------------------------------------------------------------------
-- Steps: latest entry is active, earlier entries preserved, never summed
-- ---------------------------------------------------------------------------
select lives_ok($$ insert into tests.ids values ('s1', public.log_steps(tests.today(), 4000)) $$, 'steps logged');
select lives_ok($$ insert into tests.ids values ('s2', public.log_steps(tests.today(), 8420)) $$, 'steps re-entered');
select is(
  (select steps from public.daily_steps where user_id = '00000000-0000-0000-0000-0000000000a1' and entry_date = tests.today()),
  8420, 'the latest entry is the active value (not 12,420)');
select results_eq(
  $$ select steps, is_active, is_deleted from public.steps_entries
     where user_id = '00000000-0000-0000-0000-0000000000a1' and entry_date = tests.today() order by created_at, steps $$,
  $$ values (4000, false, false), (8420, true, false) $$,
  'the earlier entry stays in the history');
select lives_ok(
  $$ update public.steps_entries set is_deleted = true where id = (select id from tests.ids where key = 's2') $$,
  'today''s entry can be deleted');
select is(
  (select steps from public.daily_steps where user_id = '00000000-0000-0000-0000-0000000000a1' and entry_date = tests.today()),
  4000, 'deleting the active entry re-activates the previous one');
select lives_ok($$ select public.log_steps(tests.today() - 2, 6000) $$, 'a missing past day can be entered');
select throws_ok($$ select public.log_steps(tests.today() - 2, 9000) $$, '42501', null,
  'a past day with an entry is locked');
select throws_ok(
  $$ update public.steps_entries set steps = 1 where user_id = '00000000-0000-0000-0000-0000000000a1' and entry_date = tests.today() - 2 $$,
  '42501', 'Record is locked and can no longer be changed', 'past step entries cannot be edited');
select throws_ok($$ select public.log_steps(tests.today() + 1, 100) $$, '22023', null, 'future steps are rejected');
select throws_ok($$ select public.log_steps(tests.today(), -5) $$, '23514', null, 'steps cannot be negative');

-- ---------------------------------------------------------------------------
-- Goals: a goal used by a cycle is never rewritten; a new version starts
-- ---------------------------------------------------------------------------
select lives_ok($$
  insert into tests.ids values ('g2', public.set_goal('MUSCLE_GAIN', array['CRICKET_PERFORMANCE', 'ENDURANCE'], ' Stronger for cricket '))
$$, 'a goal change is accepted');
select results_eq(
  $$ select long_term_goal, description, is_active, effective_to is not null
     from public.goals where id = '00000000-0000-0000-00a0-000000000001' $$,
  $$ values ('FAT_LOSS'::text, 'Lean out'::text, false, true) $$,
  'the goal locked by the current cycle is kept as it was (closed, not rewritten)');
select is(
  (select goal_id from public.recommendation_cycles where id = '00000000-0000-0000-0008-000000000071'),
  '00000000-0000-0000-00a0-000000000001'::uuid, 'the current cycle still uses its original goal');
select results_eq(
  $$ select g.long_term_goal, g.description, array_agg(f.focus_type order by f.priority)
     from public.goals g join public.goal_focuses f on f.goal_id = g.id
     where g.id = (select id from tests.ids where key = 'g2') group by g.long_term_goal, g.description $$,
  $$ values ('MUSCLE_GAIN'::text, 'Stronger for cricket'::text, array['CRICKET_PERFORMANCE', 'ENDURANCE']) $$,
  'the new version holds the new goal, objective and ordered focuses');
select lives_ok($$ select public.set_goal('GENERAL_FITNESS', array['FLEXIBILITY'], null) $$,
  'an unused goal version is edited in place');
select is(
  (select count(*) from public.goals where user_id = '00000000-0000-0000-0000-0000000000a1'),
  2::bigint, 'no extra version while the new goal is unused by any cycle');
select throws_ok($$ select public.set_goal('GENERAL_FITNESS', array['YOGA'], null) $$, '23514', null,
  'unknown focus values are rejected');
select throws_ok($$ select public.set_goal('GENERAL_FITNESS', array['FLEXIBILITY', 'FLEXIBILITY'], null) $$, '22023', null,
  'a focus can only be chosen once');

-- ---------------------------------------------------------------------------
-- Recommendation review
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.review_recommendation('00000000-0000-0000-0008-000000000071', 1900, 150, 220, 60, 30, array['A', 'B']) $$,
  '22023', null, 'the template cannot change size (capacity is locked)');
select throws_ok(
  $$ select public.review_recommendation('00000000-0000-0000-0008-000000000071', 100, 150, 220, 60, 30) $$,
  '22023', null, 'targets must be in range');
select lives_ok(
  $$ select public.review_recommendation('00000000-0000-0000-0008-000000000071', 1900, 150, 220, 60, 32, array['Push', 'Pull', 'Legs']) $$,
  'final targets and session names can change during review');
select results_eq(
  $$ select recommended_calories, final_calories, final_protein_g::numeric, workout_plan_json -> 'sessions' -> 0 ->> 'name',
            parsed_output_json -> 'workout_plan' -> 'sessions' ->> 0
     from public.recommendation_cycles where id = '00000000-0000-0000-0008-000000000071' $$,
  $$ values (2000, 1900, 150.0::numeric, 'Push'::text, 'Upper'::text) $$,
  'the AI original is preserved; the final value is stored separately');
select results_eq(
  $$ select target_date, calories from public.daily_target_snapshots
     where recommendation_cycle_id = '00000000-0000-0000-0008-000000000071' order by target_date $$,
  $$ values (tests.today() - 1, 2000), (tests.today(), 1900) $$,
  'past snapshots keep their target; today onward follows the final target');
select lives_ok(
  $$ select public.accept_recommendation('00000000-0000-0000-0008-000000000071') $$,
  'the user can accept & lock during review');
select throws_ok(
  $$ select public.review_recommendation('00000000-0000-0000-0008-000000000071', 1800, 150, 220, 60, 30) $$,
  '42501', null, 'a locked recommendation cannot be edited');
select throws_ok(
  $$ update public.recommendation_cycles set final_calories = 1500 where id = '00000000-0000-0000-0008-000000000071' $$,
  '42501', null, 'direct edits are not possible for users');

select tests.login('00000000-0000-0000-0000-0000000000b2');
select throws_ok(
  $$ select public.accept_recommendation('00000000-0000-0000-0008-000000000071') $$,
  'P0002', null, 'another user cannot review this recommendation');
select is((select count(*) from public.weight_measurements where user_id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint,
  'another user cannot read weights');
select is((select count(*) from public.steps_entries where user_id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint,
  'another user cannot read steps');
select is((select count(*) from public.goals where user_id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint,
  'another user cannot read goals');
select throws_ok(
  $$ insert into public.inbody_reports (user_id, report_date, file_path, file_type)
     values ('00000000-0000-0000-0000-0000000000b2', tests.today(), '00000000-0000-0000-0000-0000000000a1/x.pdf', 'application/pdf') $$,
  '42501', null, 'a report must point into the uploader''s own folder');

reset role;
select results_eq(
  $$ select actor_user_id, old_values_json ->> 'final_calories', new_values_json ->> 'final_calories'
     from public.audit_logs where entity_id = '00000000-0000-0000-0008-000000000071'
       and new_values_json ? 'final_calories' order by created_at limit 1 $$,
  $$ values ('00000000-0000-0000-0000-0000000000a1'::uuid, '2000', '1900') $$,
  'the change is audited with old value, new value and actor');

select * from finish();
rollback;
