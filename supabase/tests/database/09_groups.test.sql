-- Groups & shared progress: creation, joining, isolation between groups,
-- group-visible fields only, target selection by date, the history rule,
-- removal/leave permissions, admin continuity, former-member denial,
-- soft-deleted groups and audit.
begin;
create extension if not exists pgtap with schema extensions;

select plan(66);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create function tests.affected(p_sql text) returns integer language plpgsql
as $$ declare n integer; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
create table tests.vals (key text primary key, n numeric, t text);
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
grant all on tests.vals to authenticated;

-- a1 Alice (G1 admin) · b2 Bob (G1 member, data) · c3 Carol (outsider, later G2)
-- d4 Dave (G1 leader, joined 2 days ago) · e5 Eve (creates G2) · f6 Frank (G1 member, joined 2 days ago)
insert into auth.users (id, phone, aud, role)
select ('00000000-0000-0000-0000-0000000000' || s)::uuid, '91942000000' || n, 'authenticated', 'authenticated'
from (values ('a1', 1), ('b2', 2), ('c3', 3), ('d4', 4), ('e5', 5), ('f6', 6)) v(s, n);
insert into public.profiles (id, phone, name, date_of_birth, gender, height_cm)
select ('00000000-0000-0000-0000-0000000000' || s)::uuid, '+91942000000' || n, nm, '1990-01-01', 'OTHER', 170
from (values ('a1', 1, 'Alice'), ('b2', 2, 'Bob'), ('c3', 3, 'Carol'), ('d4', 4, 'Dave'), ('e5', 5, 'Eve'), ('f6', 6, 'Frank')) v(s, n, nm);

-- G1, created 60 days ago. Alice and Bob joined then; Dave (leader) and Frank 2 days ago.
insert into public.groups (id, name, description, creator_id, created_at)
values ('00000000-0000-0000-0009-000000000091', 'Morning crew', 'Accountability', '00000000-0000-0000-0000-0000000000a1', now() - interval '60 days');
-- Fixture only: join times are immutable, so the guard is paused to backdate.
alter table public.group_memberships disable trigger group_memberships_guard;
update public.group_memberships set joined_at = now() - interval '60 days'
where group_id = '00000000-0000-0000-0009-000000000091';
alter table public.group_memberships enable trigger group_memberships_guard;
insert into public.group_memberships (group_id, user_id, role, joined_at) values
  ('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000b2', 'MEMBER', now() - interval '60 days'),
  ('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000d4', 'LEADER', now() - interval '2 days'),
  ('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000f6', 'MEMBER', now() - interval '2 days');

-- Bob's history: cycle A [today-40, today-11] 2,000 kcal with a 2,050 snapshot on
-- today-15; cycle B from today-10 at 1,900 kcal (no snapshots).
insert into public.food_items (id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g)
values ('00000000-0000-0000-0004-000000000091', 'Group Test Food', 100, 'g', 200, 20, 10, 5, 2);
insert into public.recommendation_processing_runs (id, processing_month)
values ('00000000-0000-0000-0006-000000000091', date_trunc('month', tests.today())::date);
insert into public.recommendation_processing_users (
  id, processing_run_id, user_id, attempt_number, status, parsed_recommendation_json, generated_at,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  provider, model, prompt_version
)
select ('00000000-0000-0000-0007-00000000009' || n)::uuid, '00000000-0000-0000-0006-000000000091',
       '00000000-0000-0000-0000-0000000000b2', n, 'SUCCESS', '{}', now(), 2000, 140, 230, 65, 30, 't', 't', 'v1'
from generate_series(1, 2) n;
insert into public.recommendation_cycles (
  id, user_id, processing_month, processing_user_id, workout_days_per_week, period_start, period_end,
  generated_at, review_deadline, status, locked_at, parsed_output_json, provider, model, prompt_version,
  recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g,
  final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g, workout_plan_json
) values
  ('00000000-0000-0000-0008-000000000091', '00000000-0000-0000-0000-0000000000b2', date_trunc('month', tests.today() - 40)::date,
   '00000000-0000-0000-0007-000000000091', 4, tests.today() - 40, tests.today() - 11, now(), tests.today() - 39, 'LOCKED', now(),
   '{}', 't', 't', 'v1', 2000, 140, 230, 65, 30, 2000, 140, 230, 65, 30, '{}'),
  ('00000000-0000-0000-0008-000000000092', '00000000-0000-0000-0000-0000000000b2', date_trunc('month', tests.today() - 10)::date,
   '00000000-0000-0000-0007-000000000092', 4, tests.today() - 10, null, now(), tests.today() - 9, 'LOCKED', now(),
   '{}', 't', 't', 'v1', 1900, 130, 220, 60, 30, 1900, 130, 220, 60, 30, '{}');
insert into public.daily_target_snapshots (
  user_id, recommendation_cycle_id, target_date, calories, protein_g, carbs_g, fat_g, fiber_g,
  workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance
) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0008-000000000091', tests.today() - 15,
          2050, 145, 230, 65, 30, 4, 0.85, 0.85, 1.10);

-- Meals (one soft-deleted item on today-5), steps, two workouts on one day, a
-- deleted workout, and private body data.
insert into public.meals (id, user_id, meal_date) values
  ('00000000-0000-0000-0001-000000000091', '00000000-0000-0000-0000-0000000000b2', tests.today() - 15),
  ('00000000-0000-0000-0001-000000000092', '00000000-0000-0000-0000-0000000000b2', tests.today() - 5);
insert into public.meal_items (id, meal_id, user_id, food_item_id, quantity, unit, food_name_snapshot,
  snapshot_calories, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g, snapshot_fiber_g)
values
  ('00000000-0000-0000-0002-000000000091', '00000000-0000-0000-0001-000000000091', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0004-000000000091', 300, 'g', '', 0, 0, 0, 0, 0),
  ('00000000-0000-0000-0002-000000000092', '00000000-0000-0000-0001-000000000092', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0004-000000000091', 100, 'g', '', 0, 0, 0, 0, 0),
  ('00000000-0000-0000-0002-000000000093', '00000000-0000-0000-0001-000000000092', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0004-000000000091', 500, 'g', '', 0, 0, 0, 0, 0);
update public.meal_items set is_deleted = true, delete_reason = 'test' where id = '00000000-0000-0000-0002-000000000093';
insert into public.steps_entries (user_id, entry_date, steps) values
  ('00000000-0000-0000-0000-0000000000b2', tests.today() - 15, 5000);
insert into public.steps_entries (user_id, entry_date, steps) values
  ('00000000-0000-0000-0000-0000000000b2', tests.today() - 15, 8000);
insert into public.workouts (user_id, workout_date, workout_type, duration_minutes, estimated_calories) values
  ('00000000-0000-0000-0000-0000000000b2', tests.today() - 15, 'LEGS', 40, 240),
  ('00000000-0000-0000-0000-0000000000b2', tests.today() - 15, 'CARDIO', 20, 150),
  ('00000000-0000-0000-0000-0000000000b2', tests.today() - 12, 'LEGS', 40, 240);
update public.workouts set is_deleted = true, delete_reason = 'test'
where user_id = '00000000-0000-0000-0000-0000000000b2' and workout_date = tests.today() - 12;
insert into public.weight_measurements (user_id, measurement_date, weight_kg) values
  ('00000000-0000-0000-0000-0000000000b2', tests.today() - 15, 81.5),
  ('00000000-0000-0000-0000-0000000000f6', tests.today() - 1, 70);
insert into public.inbody_reports (id, user_id, report_date, file_path, file_type)
values ('00000000-0000-0000-0005-000000000091', '00000000-0000-0000-0000-0000000000b2', tests.today() - 15, 'b2/r.pdf', 'application/pdf');
insert into public.inbody_metrics (report_id, user_id, weight_kg, body_fat_percent, muscle_mass_kg)
values ('00000000-0000-0000-0005-000000000091', '00000000-0000-0000-0000-0000000000b2', 81, 24, 33);

-- Expected nutrition = the shared aggregation Progress and recommendations use.
insert into tests.vals (key, n)
select 'cal15', calories from public.recommendation_daily_nutrition('00000000-0000-0000-0000-0000000000b2', tests.today() - 15, tests.today() - 15);
insert into tests.vals (key, n)
select 'cal5', calories from public.recommendation_daily_nutrition('00000000-0000-0000-0000-0000000000b2', tests.today() - 5, tests.today() - 5);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Creation (server-side, atomic)
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.create_group(text, text)', 'EXECUTE'), 'anon cannot create groups');
select tests.login('00000000-0000-0000-0000-0000000000e5');
insert into tests.vals (key, t) select 'g2', id::text from public.create_group('  Evening walkers  ', '');
insert into tests.vals (key, t) select 'g2code', code from public.groups where id = (select t::uuid from tests.vals where key = 'g2');
select matches((select t from tests.vals where key = 'g2code'), '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$',
  'the join code is generated server-side from an unambiguous alphabet');
select is(
  (select array[g.name, coalesce(g.description, 'null'), m.role::text]
   from public.groups g join public.group_memberships m on m.group_id = g.id
   where g.id = (select t::uuid from tests.vals where key = 'g2')),
  array['Evening walkers', 'null', 'ADMIN'], 'the name is trimmed and the creator becomes the group admin');
select throws_ok($$ select * from public.create_group('   ') $$, '22023', null, 'a group needs a name');
select throws_ok(
  $$ insert into public.groups (name, creator_id) values ('Forged', '00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'nobody can create a group on behalf of another user');

-- ---------------------------------------------------------------------------
-- Joining by code
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000c3');
select is((select count(*) from public.preview_group('ZZZZZZZZ')), 0::bigint, 'an unknown code reveals nothing');
select throws_ok($$ select public.join_group('ZZZZZZZZ') $$, 'P0002', 'Invalid group code', 'an invalid code is rejected generically');
select throws_ok($$ select public.join_group(null) $$, 'P0002', null, 'an empty code is rejected');
select is(
  (select name from public.preview_group(lower(substr((select t from tests.vals where key = 'g2code'), 1, 4)) || '-'
                                         || lower(substr((select t from tests.vals where key = 'g2code'), 5)))),
  'Evening walkers', 'the confirm step shows the group (case and dashes ignored)');
select is(public.join_group(lower((select t from tests.vals where key = 'g2code')))::text,
  (select t from tests.vals where key = 'g2'), 'a valid code joins immediately');
select lives_ok($$ select public.join_group((select t from tests.vals where key = 'g2code')) $$, 'joining again is harmless');
select is(
  (select count(*) from public.group_memberships
   where group_id = (select t::uuid from tests.vals where key = 'g2') and user_id = '00000000-0000-0000-0000-0000000000c3' and is_active),
  1::bigint, 'no duplicate active membership');
select ok((select already_member from public.preview_group((select t from tests.vals where key = 'g2code'))),
  'the confirm step knows the user is already a member');

-- ---------------------------------------------------------------------------
-- Isolation: membership in one group grants nothing in another
-- ---------------------------------------------------------------------------
select throws_ok($$ select * from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today()) $$,
  '42501', null, 'a member of G2 cannot read G1 data by changing group_id');
select throws_ok($$ select * from public.get_group_members('00000000-0000-0000-0009-000000000091') $$,
  '42501', null, 'nor G1''s member list');
select is((select count(*) from public.groups where id = '00000000-0000-0000-0009-000000000091'), 0::bigint, 'nor the G1 row');
select is((select count(*) from public.group_memberships where group_id = '00000000-0000-0000-0009-000000000091'),
  0::bigint, 'nor G1 memberships');
select is((select count(*) from public.get_my_groups()), 1::bigint, 'my groups lists only my own groups');

-- ---------------------------------------------------------------------------
-- Shared day: group-visible fields, the target of that date, missing = null
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today() - 15)),
  2::bigint, 'a member''s data appears only from the day they joined (Dave and Frank are absent 15 days ago)');
select results_eq(
  $$ select calories, calories_target, protein_target_g, steps, steps_target, workout_logged
     from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today() - 15)
     where user_id = '00000000-0000-0000-0000-0000000000b2' $$,
  $$ select (select n from tests.vals where key = 'cal15'), 2050, 145.0::numeric, 8000, null::integer, true $$,
  'that date''s snapshot target; Progress''s nutrition sum; the active step entry; two workouts = one workout day');
select results_eq(
  $$ select calories, calories_target, protein_g, steps, workout_logged
     from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today() - 12)
     where user_id = '00000000-0000-0000-0000-0000000000b2' $$,
  $$ values (null::numeric, 2000, null::numeric, null::integer, false) $$,
  'no snapshot → the covering cycle''s target; nothing logged stays null; a deleted workout does not count');
select results_eq(
  $$ select calories, calories_target from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today() - 5)
     where user_id = '00000000-0000-0000-0000-0000000000b2' $$,
  $$ select (select n from tests.vals where key = 'cal5'), 1900 $$,
  'a later cycle''s target applies to its dates; deleted meal items are excluded');
select ok((select n from tests.vals where key = 'cal5') < (select n from tests.vals where key = 'cal15'),
  'the deleted 500 g item is not in the total');
select throws_ok($$ select * from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today() + 1) $$,
  '22023', null, 'future dates are refused');
select ok(
  pg_get_function_result('public.get_group_member_day(uuid, date)'::regprocedure)
    !~* 'weight|fat|inbody|muscle|bmi|bmr|height|birth|gender|phone|meal|goal|objective',
  'the shared-day function has no private columns');
select ok(
  pg_get_function_result('public.get_group_members(uuid)'::regprocedure) !~* 'weight|birth|gender|phone|height|email',
  'the member list has no private columns');

-- The history rule: MEMBER from their own join day; LEADER/ADMIN earlier.
select tests.login('00000000-0000-0000-0000-0000000000f6');
select is((select count(*) from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today() - 15)),
  0::bigint, 'a member sees nothing from before they joined');
select is((select count(*) from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today())),
  4::bigint, 'today they see every current member');
select is((select history_from from public.get_my_groups()), tests.today() - 2, 'their history starts on their join day');
select tests.login('00000000-0000-0000-0000-0000000000d4');
select is((select count(*) from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today() - 15)),
  2::bigint, 'a leader has limited earlier history (from each member''s join day)');
select is((select history_from from public.get_my_groups()), tests.today() - 60, 'a leader''s history starts at group creation');

-- ---------------------------------------------------------------------------
-- Private data stays private (direct table access)
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.weight_measurements where user_id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint, 'no member weight');
select is((select count(*) from public.inbody_reports where user_id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint, 'no member InBody reports');
select is((select count(*) from public.inbody_metrics where user_id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint, 'no member body composition');
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint, 'no member profile (height, birth date, gender, phone)');
select is((select count(*) from public.meals where user_id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint, 'no member meals');
select is((select count(*) from public.meal_items where user_id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint, 'no member meal items');
select is((select count(*) from public.workouts where user_id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint, 'no member workout details');
select is((select count(*) from public.recommendation_cycles where user_id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint, 'no member recommendations');
select is((select count(*) from public.daily_target_snapshots where user_id = '00000000-0000-0000-0000-0000000000b2'), 0::bigint, 'no member target rows');
select throws_ok($$ select * from public.recommendation_daily_nutrition('00000000-0000-0000-0000-0000000000b2', tests.today() - 15, tests.today()) $$,
  '42501', null, 'the nutrition aggregate cannot be called for another user');

-- ---------------------------------------------------------------------------
-- Removal: group admin only
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.remove_group_member('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000f6') $$,
  '42501', null, 'a member cannot remove others');
select is(tests.affected($$ update public.group_memberships set is_active = false where user_id = '00000000-0000-0000-0000-0000000000f6' $$),
  0, 'nor by updating the table');
select is(private.is_group_admin((select t::uuid from tests.vals where key = 'g2')), false,
  'for a non-member, is_group_admin is false (never NULL, which an IF NOT check would let through)');
select throws_ok($$ select public.remove_group_member((select t::uuid from tests.vals where key = 'g2'), '00000000-0000-0000-0000-0000000000c3') $$,
  '42501', null, 'nor in a group they are not an admin of');
select tests.login('00000000-0000-0000-0000-0000000000d4');
select throws_ok($$ select public.remove_group_member('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000f6') $$,
  '42501', null, 'a group leader cannot remove members');
select throws_ok($$ select public.set_group_member_role('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000d4', 'ADMIN') $$,
  '42501', null, 'a leader cannot promote themselves');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.remove_group_member('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000f6') $$,
  'the group admin removes a member');
select tests.login('00000000-0000-0000-0000-0000000000f6');
select throws_ok($$ select * from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today()) $$,
  '42501', null, 'a removed member immediately loses shared data, today and historical');
select is((select count(*) from public.get_my_groups()), 0::bigint, 'and the group disappears from their groups');
select is((select count(*) from public.weight_measurements where user_id = '00000000-0000-0000-0000-0000000000f6'), 1::bigint,
  'their own records are untouched');

-- Rejoining is a new membership: history restarts at the new join day.
reset role;
insert into tests.vals (key, t) select 'g1code', code from public.groups where id = '00000000-0000-0000-0009-000000000091';
set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000f6');
select lives_ok($$ select public.join_group((select t from tests.vals where key = 'g1code')) $$, 'a removed member can rejoin with the code');
select is((select count(*) || '/' || count(*) filter (where is_active) from public.group_memberships
           where group_id = '00000000-0000-0000-0009-000000000091' and user_id = '00000000-0000-0000-0000-0000000000f6'),
  '2/1', 'rejoining keeps the old membership as history and adds a new one');

-- ---------------------------------------------------------------------------
-- Admin continuity and leaving
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.leave_group('00000000-0000-0000-0009-000000000091') $$,
  'P0001', 'Make another member a group admin first', 'the only group admin cannot leave while others remain');
select throws_ok($$ select public.set_group_member_role('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000a1', 'MEMBER') $$,
  'P0001', null, 'nor step down');
select lives_ok($$ select public.set_group_member_role('00000000-0000-0000-0009-000000000091', '00000000-0000-0000-0000-0000000000b2', 'ADMIN') $$,
  'the group admin appoints another admin');
select lives_ok($$ select public.leave_group('00000000-0000-0000-0009-000000000091') $$, 'then may leave');
select throws_ok($$ select * from public.get_group_members('00000000-0000-0000-0009-000000000091') $$,
  '42501', null, 'a member who left loses access immediately');
select is((select count(*) from public.groups where id = '00000000-0000-0000-0009-000000000091'), 0::bigint,
  'the creator who left can no longer read the group row either');

-- The last member leaving closes the group; a closed group cannot be joined.
select tests.login('00000000-0000-0000-0000-0000000000c3');
select lives_ok($$ select public.leave_group((select t::uuid from tests.vals where key = 'g2')) $$, 'Carol leaves G2');
select tests.login('00000000-0000-0000-0000-0000000000e5');
select lives_ok($$ select public.leave_group((select t::uuid from tests.vals where key = 'g2')) $$, 'the last member leaves');
select tests.login('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select public.join_group((select t from tests.vals where key = 'g2code')) $$,
  'P0002', null, 'a deactivated group cannot be joined');
select is((select count(*) from public.preview_group((select t from tests.vals where key = 'g2code'))), 0::bigint,
  'and is not found by its code');

-- ---------------------------------------------------------------------------
-- Inactive accounts and audit
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
update public.profiles set is_active = false, deleted_at = now() where id = '00000000-0000-0000-0000-0000000000d4';
set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.get_group_member_day('00000000-0000-0000-0009-000000000091', tests.today())
           where user_id = '00000000-0000-0000-0000-0000000000d4'), 0::bigint, 'a deactivated account is not shown');
reset role;
select is(
  (select array_agg(distinct reason order by reason) from public.audit_logs
   where entity_type in ('groups', 'group_memberships')
     and (entity_id = (select t::uuid from tests.vals where key = 'g2')
          or entity_id in (select id from public.group_memberships
                           where group_id in ((select t::uuid from tests.vals where key = 'g2'), '00000000-0000-0000-0009-000000000091')))),
  array['Created group (group admin)', 'Group created', 'Group deactivated', 'Group role changed', 'Joined group', 'Left group', 'Removed by group admin'],
  'creation, joins, leaves, removal, role changes and deactivation are audited');
select ok(
  (select bool_and(actor_user_id is not null and coalesce(new_values_json::text, '') !~* 'weight|calorie|protein')
   from public.audit_logs
   where entity_type = 'group_memberships'
     -- user actions only (the fixture's direct inserts have no actor by design)
     and (reason in ('Removed by group admin', 'Group role changed', 'Left group')
          -- joins through join_group (Carol, Frank's rejoin); fixture rows are backdated
          or entity_id in (select id from public.group_memberships
                           where user_id in ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000f6')
                             and joined_at > now() - interval '1 minute'))),
  'audit rows of user actions name the actor and contain no member data');

select * from finish();
rollback;
