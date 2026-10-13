-- Groups weekly view: get_group_member_week(). Membership and group scope,
-- former members, Monday weeks, no future days, each member counted from the
-- day they joined, the viewer's history rule, the same values as the daily
-- view, the tolerance / capacity in force, and the returned columns
-- (group-visible only; no score or rank).
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
-- Monday of last week (Postgres weeks start on Monday).
create function tests.last_monday() returns date language sql stable
as $$ select date_trunc('week', tests.today())::date - 7 $$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- a1 Alice (admin) · b2 Bob (member, data) · w3 Wes (joined Wednesday last week)
-- m4 Mia (member, joined today) · x5 Xan (outsider: another group) · f6 Fay (left)
insert into auth.users (id, phone, aud, role)
select ('00000000-0000-0000-0000-0000000000' || s)::uuid, '91943000000' || n, 'authenticated', 'authenticated'
from (values ('a1', 1), ('b2', 2), ('c3', 3), ('d4', 4), ('e5', 5), ('f6', 6)) v(s, n);
insert into public.profiles (id, phone, name)
select ('00000000-0000-0000-0000-0000000000' || s)::uuid, '+91943000000' || n, nm
from (values ('a1', 1, 'Alice'), ('b2', 2, 'Bob'), ('c3', 3, 'Wes'), ('d4', 4, 'Mia'), ('e5', 5, 'Xan'), ('f6', 6, 'Fay')) v(s, n, nm);

insert into public.groups (id, name, creator_id, created_at)
values ('00000000-0000-0000-0009-000000000091', 'Week crew', '00000000-0000-0000-0000-0000000000a1', now() - interval '60 days');
insert into public.groups (id, name, creator_id)
values ('00000000-0000-0000-0009-000000000092', 'Other crew', '00000000-0000-0000-0000-0000000000e5');
-- Fixture only: join times are immutable, so the guard is paused to backdate.
alter table public.group_memberships disable trigger group_memberships_guard;
update public.group_memberships set joined_at = now() - interval '60 days'
where group_id = '00000000-0000-0000-0009-000000000091';
insert into public.group_memberships (group_id, user_id, role, joined_at) values
  ('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000b2', 'MEMBER', now() - interval '60 days'),
  ('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000c3', 'MEMBER',
   ((tests.last_monday() + 2)::timestamp + interval '9 hours') at time zone 'Asia/Kolkata'),
  ('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000d4', 'MEMBER', now()),
  ('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000f6', 'MEMBER', now() - interval '30 days');
alter table public.group_memberships enable trigger group_memberships_guard;

-- Bob: a cycle from ten days before last Monday (4 workout days), a target
-- snapshot with tolerance on last Monday only, food and steps that Monday,
-- two workouts last Tuesday.
insert into public.food_items (id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g)
values ('00000000-0000-0000-0004-000000000091', 'Week Test Food', 100, 'g', 200, 20, 10, 5, 2);
insert into public.recommendation_processing_runs (id, processing_month)
values ('00000000-0000-0000-0006-000000000091', date_trunc('month', tests.last_monday() - 10)::date);
insert into public.recommendation_processing_users (
  id, processing_run_id, user_id, status, parsed_recommendation_json, generated_at,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  provider, model, prompt_version
) values ('00000000-0000-0000-0007-000000000091', '00000000-0000-0000-0006-000000000091', '00000000-0000-0000-0000-0000000000b2',
          'SUCCESS', '{}', now(), 2000, 140, 230, 65, 30, 't', 't', 'v1');
insert into public.recommendation_cycles (
  id, user_id, processing_month, processing_user_id, workout_days_per_week, period_start, period_end,
  generated_at, review_deadline, status, locked_at, parsed_output_json, provider, model, prompt_version,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g, workout_plan_json
) values ('00000000-0000-0000-0008-000000000091', '00000000-0000-0000-0000-0000000000b2', date_trunc('month', tests.last_monday() - 10)::date,
          '00000000-0000-0000-0007-000000000091', 4, tests.last_monday() - 10, null, now(), tests.last_monday() - 9, 'LOCKED', now(),
          '{}', 't', 't', 'v1', 2000, 140, 230, 65, 30, 2000, 140, 230, 65, 30, '{}');
insert into public.daily_target_snapshots (
  user_id, recommendation_cycle_id, target_date, calories, protein_g, carbs_g, fat_g, fiber_g,
  workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance
) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0008-000000000091', tests.last_monday(),
          2050, 145, 230, 65, 30, 4, 0.85, 0.85, 1.10);
insert into public.meals (id, user_id, meal_date)
values ('00000000-0000-0000-0001-000000000091', '00000000-0000-0000-0000-0000000000b2', tests.last_monday());
insert into public.meal_items (meal_id, user_id, food_item_id, quantity, unit, food_name_snapshot,
  snapshot_calories, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g, snapshot_fiber_g)
values ('00000000-0000-0000-0001-000000000091', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0004-000000000091', 300, 'g', '', 0, 0, 0, 0, 0);
insert into public.steps_entries (user_id, entry_date, steps) values
  ('00000000-0000-0000-0000-0000000000b2', tests.last_monday(), 5000);
insert into public.steps_entries (user_id, entry_date, steps) values
  ('00000000-0000-0000-0000-0000000000b2', tests.last_monday(), 8000);
insert into public.workouts (user_id, workout_date, workout_type, duration_minutes, estimated_calories) values
  ('00000000-0000-0000-0000-0000000000b2', tests.last_monday() + 1, 'LEGS', 40, 240),
  ('00000000-0000-0000-0000-0000000000b2', tests.last_monday() + 1, 'CARDIO', 20, 150);
insert into public.activities (user_id, activity_date, activity_type, duration_minutes, estimated_calories)
values ('00000000-0000-0000-0000-0000000000b2', tests.last_monday() + 3, 'WALKING', 30, 120);

-- Expected nutrition: the shared aggregation Progress and the daily view use.
create table tests.expected as
select calories, protein_g
from public.recommendation_daily_nutrition('00000000-0000-0000-0000-0000000000b2', tests.last_monday(), tests.last_monday());
grant select on tests.expected to authenticated;

select ok(not has_function_privilege('anon', 'public.get_group_member_week(uuid, date)', 'EXECUTE'),
  'anon cannot call the weekly view');
select unalike(
  pg_get_function_result('public.get_group_member_week(uuid, date)'::regprocedure),
  '%(weight|fat|inbody|muscle|bmi|bmr|height|birth|gender|phone|meal|goal|objective|score|rank|points|position)%',
  'the weekly view returns no private health data, and no score or rank');

set local role authenticated;

-- Fay leaves; from then on she sees nothing, past weeks included.
select tests.login('00000000-0000-0000-0000-0000000000f6');
select public.leave_group('00000000-0000-0000-0009-000000000091');
select throws_ok($$ select * from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday()) $$,
  '42501', null, 'a former member loses access at once');

select tests.login('00000000-0000-0000-0000-0000000000e5');
select throws_ok($$ select * from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday()) $$,
  '42501', null, 'a member of another group cannot read this group');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select * from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday() + 1) $$,
  '22023', 'A week starts on a Monday', 'a week must start on a Monday');
select throws_ok($$ select * from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday() + 14) $$,
  '22023', null, 'a future week is refused');

select is(
  (select count(distinct day)::integer from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday())),
  7, 'a completed week has Monday to Sunday');
select is(
  (select max(day) from public.get_group_member_week('00000000-0000-0000-0009-000000000091', date_trunc('week', tests.today())::date)),
  tests.today(), 'the current week ends today: no future day is returned');
select is(
  (select min(day) from public.get_group_member_week('00000000-0000-0000-0009-000000000091', date_trunc('week', tests.today())::date)),
  date_trunc('week', tests.today())::date, 'the current week starts on Monday');
select is(
  (select min(day) from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday())
   where user_id = '00000000-0000-0000-0000-0000000000c3'),
  tests.last_monday() + 2, 'a member who joined on Wednesday counts from Wednesday');
select is(
  (select count(*)::integer from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday())
   where user_id in ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000e5')),
  0, 'former members and people outside the group never appear');
select is(
  (select count(*)::integer from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday())
   where user_id = '00000000-0000-0000-0000-0000000000d4'),
  0, 'a member who joined this week has no rows in last week');

-- Bob's last Monday: the snapshot with its tolerance; Tuesday: the cycle's
-- capacity, no tolerance; two workouts are one workout day; activities are not workouts.
select results_eq(
  $$ select calories, protein_g, calories_target, steps, nutrition_tolerance, calorie_lower_tolerance,
            calorie_upper_tolerance, workouts_per_week, cycle_start, workout_logged
     from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday())
     where user_id = '00000000-0000-0000-0000-0000000000b2' and day = tests.last_monday() $$,
  $$ select d.calories, d.protein_g, 2050, 8000, 0.85::numeric, 0.85::numeric, 1.10::numeric, 4,
            tests.last_monday() - 10, false
     from tests.expected d $$,
  'a day carries the shared nutrition aggregation, the latest steps entry and the tolerance in force');
select results_eq(
  $$ select nutrition_tolerance, workouts_per_week, workout_logged, calories
     from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday())
     where user_id = '00000000-0000-0000-0000-0000000000b2' and day = tests.last_monday() + 1 $$,
  $$ values (null::numeric, 4, true, null::numeric) $$,
  'without a snapshot there is no tolerance; capacity comes from the cycle; nothing logged stays null');
select is(
  (select workout_logged from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday())
   where user_id = '00000000-0000-0000-0000-0000000000b2' and day = tests.last_monday() + 3),
  false, 'an activity is not a workout');

-- Every row is exactly what the daily view returns for that day.
select is(
  (select count(*)::integer
   from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday()) w
   left join lateral public.get_group_member_day('00000000-0000-0000-0009-000000000091', w.day) d on d.user_id = w.user_id
   where d.user_id is null
      or (w.name, w.group_role, w.calories, w.calories_target, w.protein_g, w.protein_target_g, w.steps, w.workout_logged)
         is distinct from
         (d.name, d.group_role, d.calories, d.calories_target, d.protein_g, d.protein_target_g, d.steps, d.workout_logged)),
  0, 'the weekly view agrees with the daily view on every member and day');

-- History rule: a MEMBER sees from their own join day; the admin from creation.
select tests.login('00000000-0000-0000-0000-0000000000c3');
select is(
  (select min(day) from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday())),
  tests.last_monday() + 2, 'a member sees the group from the day they joined');
select tests.login('00000000-0000-0000-0000-0000000000d4');
select is(
  (select count(*)::integer from public.get_group_member_week('00000000-0000-0000-0009-000000000091', tests.last_monday())),
  0, 'a member who joined today sees nothing of last week');
select ok(
  (select bool_and(day = tests.today()) from public.get_group_member_week('00000000-0000-0000-0009-000000000091', date_trunc('week', tests.today())::date)),
  'and this week only from today');

-- Nobody can change group data through this function: it only reads.
select is(
  (select provolatile::text from pg_proc where oid = 'public.get_group_member_week(uuid, date)'::regprocedure),
  's', 'the weekly view is read-only (stable)');

select * from finish();
rollback;
