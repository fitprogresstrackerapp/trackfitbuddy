-- Admin management, corrections & audit: reader authorization, manager scope,
-- user denial, authority rules, corrections (original preserved, corrected
-- value active, user lock unchanged, analytics follow, targets untouched),
-- concurrency, soft deletion, (de)activation, PIN reset and audit integrity.
begin;
create extension if not exists pgtap with schema extensions;

select plan(77);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create function tests.affected(p_sql text) returns integer language plpgsql
as $$ declare n integer; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
create function tests.ver(p_table text, p_id uuid) returns timestamptz language plpgsql
as $$ declare v timestamptz; begin execute format('select updated_at from public.%I where id = $1', p_table) into v using p_id; return v; end $$;
create table tests.vals (key text primary key, n numeric, t text);
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;
grant all on tests.vals to authenticated, service_role;

-- sa super admin · ad, a2 admins · mg manager (of u1) · u1 user with history · u2 unrelated user
insert into auth.users (id, phone, aud, role)
select ('00000000-0000-0000-0000-0000000000' || s)::uuid, '91943000000' || n, 'authenticated', 'authenticated'
from (values ('a1', 1), ('a2', 2), ('b1', 3), ('c1', 4), ('d1', 5), ('d2', 6)) v(s, n);
insert into public.profiles (id, phone, name, date_of_birth, gender, height_cm) values
  ('00000000-0000-0000-0000-0000000000a1', '+919430000001', 'Sam Super', '1985-01-01', 'OTHER', 170),
  ('00000000-0000-0000-0000-0000000000a2', '+919430000002', 'Ada Admin', '1986-01-01', 'OTHER', 170),
  ('00000000-0000-0000-0000-0000000000b1', '+919430000003', 'Abe Admin', '1987-01-01', 'OTHER', 170),
  ('00000000-0000-0000-0000-0000000000c1', '+919430000004', 'Meg Manager', '1988-01-01', 'OTHER', 170),
  ('00000000-0000-0000-0000-0000000000d1', '+919430000005', 'Uma User', '1990-06-15', 'FEMALE', 162),
  ('00000000-0000-0000-0000-0000000000d2', '+919430000006', null, null, null, null);
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'SUPER_ADMIN'),
  ('00000000-0000-0000-0000-0000000000a2', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000b1', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000c1', 'MANAGER');
insert into public.manager_user_assignments (manager_id, user_id)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1');

-- Accounts left by other suites (e.g. integration runs) must not count as another
-- active super admin in the "last super admin" checks: deactivate them in this
-- rolled-back transaction.
alter table public.profiles disable trigger user;
update public.profiles set is_active = false, deleted_at = now()
where id in (select user_id from public.user_roles where role = 'SUPER_ADMIN')
  and id <> '00000000-0000-0000-0000-0000000000a1' and is_active;
alter table public.profiles enable trigger user;

-- Uma's locked history from yesterday, a target snapshot, a PIN.
insert into public.food_items (id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) values
  ('00000000-0000-0000-0004-0000000000a1', 'Admin Test Rice', 100, 'g', 130, 3, 28, 0.5, 1),
  ('00000000-0000-0000-0004-0000000000a2', 'Admin Test Dal', 100, 'g', 110, 7, 18, 1, 5);
insert into public.meals (id, user_id, meal_date, meal_category, is_locked)
values ('00000000-0000-0000-0001-0000000000a1', '00000000-0000-0000-0000-0000000000d1', tests.today() - 1, 'LUNCH', true);
insert into public.meal_items (id, meal_id, user_id, food_item_id, quantity, unit, food_name_snapshot,
  snapshot_calories, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g, snapshot_fiber_g)
values ('00000000-0000-0000-0002-0000000000a1', '00000000-0000-0000-0001-0000000000a1', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0004-0000000000a1', 200, 'g', '', 0, 0, 0, 0, 0);
insert into public.workouts (id, user_id, workout_date, workout_type, duration_minutes, estimated_calories, is_locked)
values ('00000000-0000-0000-0003-0000000000a1', '00000000-0000-0000-0000-0000000000d1', tests.today() - 1, 'LEGS', 45, 270, true);
insert into public.steps_entries (id, user_id, entry_date, steps)
values ('00000000-0000-0000-000b-0000000000a1', '00000000-0000-0000-0000-0000000000d1', tests.today() - 1, 800);
insert into public.weight_measurements (id, user_id, measurement_date, weight_kg) values
  ('00000000-0000-0000-000c-0000000000a1', '00000000-0000-0000-0000-0000000000d1', tests.today() - 1, 72.4);
insert into public.inbody_reports (id, user_id, report_date, file_path, file_type)
values ('00000000-0000-0000-0005-0000000000a1', '00000000-0000-0000-0000-0000000000d1', tests.today() - 2, 'd1/r.pdf', 'application/pdf');
insert into public.inbody_metrics (report_id, user_id, weight_kg, body_fat_percent, muscle_mass_kg)
values ('00000000-0000-0000-0005-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 73, 28, 26);
select public.auth_set_pin('00000000-0000-0000-0000-0000000000d1', '1111');

insert into tests.vals (key, n) select 'targets', count(*) from public.daily_target_snapshots where user_id = '00000000-0000-0000-0000-0000000000d1';

set local role authenticated;

-- ---------------------------------------------------------------------------
-- A normal user can use none of it
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.admin_list_users(text, public.app_role, boolean, boolean, integer, integer)', 'EXECUTE'),
  'anon cannot call admin readers');
select ok(not has_function_privilege('authenticated', 'public.admin_reset_pin(uuid, uuid, text, text)', 'EXECUTE'),
  'PIN reset is not callable from any client session');
select tests.login('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$ select * from public.admin_list_users() $$, '42501', null, 'a user cannot list users');
select throws_ok($$ select * from public.admin_user_account('00000000-0000-0000-0000-0000000000d1') $$, '42501', null, 'nor open a user');
select throws_ok($$ select * from public.admin_audit_log() $$, '42501', null, 'nor read the audit log');
select throws_ok($$ select * from public.admin_dashboard() $$, '42501', null, 'nor the admin dashboard');
select throws_ok($$ select public.admin_correct_steps('00000000-0000-0000-000b-0000000000a1', now(), 9000) $$, '42501', null, 'nor correct records');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-0000-0000-0000000000d1', false) $$, '42501', null, 'nor deactivate users');
select throws_ok($$ insert into public.audit_logs (actor_user_id, entity_type, action) values ('00000000-0000-0000-0000-0000000000a1', 'x', 'UPDATE') $$,
  '42501', null, 'nor write audit records (forging an actor)');

-- ---------------------------------------------------------------------------
-- A manager sees only assigned users, read-only
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000c1');
select is((select array_agg(user_id) from public.admin_list_users()), array['00000000-0000-0000-0000-0000000000d1'::uuid],
  'a manager lists only assigned users');
select is((select count(*) from public.admin_list_users('943000000')), 1::bigint, 'search never widens the scope');
select throws_ok($$ select * from public.admin_user_account('00000000-0000-0000-0000-0000000000d2') $$, '42501', null,
  'an unrelated user cannot be opened by changing the id');
select is((select can_administer from public.admin_user_account('00000000-0000-0000-0000-0000000000d1')), false,
  'an assigned user is visible but not administrable');
select throws_ok($$ select * from public.admin_daily_nutrition('00000000-0000-0000-0000-0000000000d2', tests.today() - 7, tests.today()) $$,
  '42501', null, 'nor an unrelated user''s nutrition');
select is((select count(*) from public.admin_daily_nutrition('00000000-0000-0000-0000-0000000000d1', tests.today() - 7, tests.today())),
  1::bigint, 'an assigned user''s daily nutrition is readable');
select throws_ok($$ select public.admin_correct_steps('00000000-0000-0000-000b-0000000000a1', tests.ver('steps_entries', '00000000-0000-0000-000b-0000000000a1'), 9000) $$,
  '42501', null, 'a manager cannot correct records');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-0000-0000-0000000000d1', false) $$, '42501', null, 'nor deactivate');
select throws_ok($$ select * from public.admin_audit_log() $$, '42501', null, 'nor read the audit log');

-- ---------------------------------------------------------------------------
-- Admin readers: server-side search, filters, pagination
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a2');
select is((select name from public.admin_list_users('94300 00005')), 'Uma User', 'search by phone digits');
select is((select name from public.admin_list_users('uMa')), 'Uma User', 'case-insensitive name search');
select ok((select bool_and('MANAGER' = any(roles)) and bool_or(name = 'Meg Manager') and not bool_or(name = 'Uma User')
           from public.admin_list_users(null, 'MANAGER', null, null, 100)), 'role filter');
select ok((select bool_and(not is_profile_complete) from public.admin_list_users(null, null, null, false)), 'incomplete filter');
select ok((select bool_or(user_id = '00000000-0000-0000-0000-0000000000d2') from public.admin_list_users('9430000006', null, null, false)),
  'an incomplete profile is listed as incomplete');
select is((select count(*) from public.admin_list_users(null, null, null, null, 2, 0)), 2::bigint, 'pages have the requested size');
select ok((select bool_and(total_count >= 6) from public.admin_list_users(null, null, null, null, 2, 0)), 'with the total count');
select is(
  (select array[phone, recommendation_status, can_administer::text, cardinality(missing_fields)::text]
   from public.admin_user_account('00000000-0000-0000-0000-0000000000d1')),
  array['+919430000005', 'NONE', 'true', '0'], 'account overview for an admin');
select ok(
  pg_get_function_result('public.admin_list_users(text, public.app_role, boolean, boolean, integer, integer)'::regprocedure) !~* 'pin|hash|password|token|weight|fat',
  'the user list exposes no secrets or body data');

-- ---------------------------------------------------------------------------
-- Authority: ADMIN never administers ADMIN / SUPER_ADMIN accounts or itself
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.admin_set_user_active('00000000-0000-0000-0000-0000000000b1', false) $$, '42501', null,
  'an admin cannot deactivate another admin');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-0000-0000-0000000000a1', false) $$, '42501', null,
  'nor a super admin');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-0000-0000-0000000000a2', false) $$, '42501', null,
  'nor themselves');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is((select can_administer from public.admin_user_account('00000000-0000-0000-0000-0000000000a2')), true,
  'a super admin administers admins');
select throws_ok($$ select public.admin_set_user_active('00000000-0000-0000-0000-0000000000a1', false) $$, '42501', null,
  'the (last) super admin cannot deactivate themselves');
select throws_ok($$ delete from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000a1' and role = 'SUPER_ADMIN' $$,
  '42501', null, 'nor lose the last super admin role');

-- ---------------------------------------------------------------------------
-- Corrections
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.admin_correct_steps('00000000-0000-0000-000b-0000000000a1', now() - interval '1 year', 9000) $$,
  '40001', null, 'a stale version is rejected (another admin changed it)');
select lives_ok(
  $$ select public.admin_correct_steps('00000000-0000-0000-000b-0000000000a1',
       tests.ver('steps_entries', '00000000-0000-0000-000b-0000000000a1'), 8000, 'Missing a zero') $$,
  'an admin corrects a locked step entry');
select is((select steps from public.daily_steps where user_id = '00000000-0000-0000-0000-0000000000d1'), 8000,
  'the corrected value is the active value');
select is(
  (select array[action::text, actor_user_id::text, old_values_json ->> 'steps', new_values_json ->> 'steps', reason]
   from public.audit_logs where entity_id = '00000000-0000-0000-000b-0000000000a1' order by created_at desc limit 1),
  array['ADMIN_CORRECTION', '00000000-0000-0000-0000-0000000000a2', '800', '8000', 'Missing a zero'],
  'the original, corrected value, admin, reason are preserved in the audit log');
select throws_ok($$ select public.admin_correct_steps('00000000-0000-0000-000b-0000000000a1',
       tests.ver('steps_entries', '00000000-0000-0000-000b-0000000000a1'), 8000) $$, '22023', 'Nothing to correct', 'no-op corrections are refused');

-- Actor forging: the session wins over any app.actor_id the caller sets.
select set_config('app.actor_id', '00000000-0000-0000-0000-0000000000a1', true);
select lives_ok($$ select public.admin_correct_weight('00000000-0000-0000-000c-0000000000a1',
       tests.ver('weight_measurements', '00000000-0000-0000-000c-0000000000a1'), 71.4, 'Scale typo') $$, 'an admin corrects a manual weight');
select is((select actor_user_id from public.audit_logs where entity_id = '00000000-0000-0000-000c-0000000000a1' order by created_at desc limit 1),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'the audit actor is the authenticated admin, not a forged setting');
select throws_ok($$ select public.admin_correct_weight((select id from public.weight_measurements where user_id = '00000000-0000-0000-0000-0000000000d1' and source = 'INBODY'),
       tests.ver('weight_measurements', (select id from public.weight_measurements where user_id = '00000000-0000-0000-0000-0000000000d1' and source = 'INBODY')), 70) $$,
  '22023', null, 'InBody weights are not corrected as manual weights');
select lives_ok($$ select public.admin_correct_inbody_metrics('00000000-0000-0000-0005-0000000000a1',
       (select updated_at from public.inbody_metrics where report_id = '00000000-0000-0000-0005-0000000000a1'), 72.5, 27.5, 26.2, null, null, 'Transcription') $$,
  'an admin corrects InBody metrics');
select is((select weight_kg from public.weight_measurements where inbody_report_id = '00000000-0000-0000-0005-0000000000a1'), 72.50::numeric,
  'the InBody weight in weight history follows the corrected metrics');

-- Meal item: quantity rescales the snapshot; analytics follow; targets untouched.
insert into tests.vals (key, n) select 'cal_before', calories from public.admin_daily_nutrition('00000000-0000-0000-0000-0000000000d1', tests.today() - 1, tests.today() - 1);
select lives_ok($$ select public.admin_correct_meal_item('00000000-0000-0000-0002-0000000000a1',
       tests.ver('meal_items', '00000000-0000-0000-0002-0000000000a1'), 300, null, 'Portion was larger') $$, 'an admin corrects a locked meal quantity');
select is((select calories from public.admin_daily_nutrition('00000000-0000-0000-0000-0000000000d1', tests.today() - 1, tests.today() - 1)),
  (select n * 1.5 from tests.vals where key = 'cal_before'), 'daily nutrition (Progress''s aggregation) uses the corrected value');
select results_eq(
  $$ select action::text, (old_values_json ->> 'quantity')::numeric, (new_values_json ->> 'quantity')::numeric
     from public.audit_logs where entity_id = '00000000-0000-0000-0002-0000000000a1' order by created_at desc limit 1 $$,
  $$ values ('ADMIN_CORRECTION', 200::numeric, 300::numeric) $$, 'the original quantity is preserved');
-- Food change: original item soft-deleted, replacement active.
insert into tests.vals (key, t) select 'new_item', public.admin_correct_meal_item('00000000-0000-0000-0002-0000000000a1',
  tests.ver('meal_items', '00000000-0000-0000-0002-0000000000a1'), 150, '00000000-0000-0000-0004-0000000000a2', 'Was dal, not rice')::text;
select is((select array[is_deleted::text, delete_reason] from public.meal_items where id = '00000000-0000-0000-0002-0000000000a1'),
  array['true', 'Was dal, not rice'], 'a food correction keeps the original item (soft-deleted)');
select is((select array[food_name_snapshot, snapshot_calories::text, is_deleted::text] from public.meal_items where id = (select t::uuid from tests.vals where key = 'new_item')),
  array['Admin Test Dal', '165.00', 'false'], 'and adds the corrected item with its own snapshot');
select lives_ok($$ select public.admin_correct_meal('00000000-0000-0000-0001-0000000000a1', tests.ver('meals', '00000000-0000-0000-0001-0000000000a1'), 'DINNER') $$,
  'meal metadata can be corrected');

-- Workout: duration correction re-estimates stored calories.
select lives_ok($$ select public.admin_correct_training('workout', '00000000-0000-0000-0003-0000000000a1',
       tests.ver('workouts', '00000000-0000-0000-0003-0000000000a1'), 'CHEST_TRICEPS', null, 60, null, 'Wrong type') $$, 'a workout is corrected');
select results_eq($$ select workout_type, duration_minutes, final_calories > 270 from public.workouts where id = '00000000-0000-0000-0003-0000000000a1' $$,
  $$ values ('CHEST_TRICEPS'::text, 60, true) $$, 'with calories re-estimated by the existing rule');
select throws_ok($$ select public.admin_correct_training('workout', '00000000-0000-0000-0003-0000000000a1',
       tests.ver('workouts', '00000000-0000-0000-0003-0000000000a1'), 'CHEST_TRICEPS', null, 0, null) $$, '22023', null, 'values are validated');
select throws_ok($$ select public.admin_correct_training('workout', '00000000-0000-0000-0003-0000000000a1',
       tests.ver('workouts', '00000000-0000-0000-0003-0000000000a1'), 'NOT_A_TYPE', null, 60, null) $$, '23514', null, 'types follow the table rules');

-- Profile correction with onboarding rules.
select throws_ok($$ select public.admin_correct_profile('00000000-0000-0000-0000-0000000000d1', tests.ver('profiles', '00000000-0000-0000-0000-0000000000d1'),
       'Uma User', '1990-06-15', 'FEMALE', 30, null, null) $$, '22023', null, 'profile values are validated');
select lives_ok($$ select public.admin_correct_profile('00000000-0000-0000-0000-0000000000d1', tests.ver('profiles', '00000000-0000-0000-0000-0000000000d1'),
       'Uma User', '1990-06-15', 'FEMALE', 163, 'LIGHTLY_ACTIVE', 3, 'Height remeasured') $$, 'a profile is corrected');

-- Soft deletion.
select lives_ok($$ select public.admin_delete_record('workout', '00000000-0000-0000-0003-0000000000a1',
       tests.ver('workouts', '00000000-0000-0000-0003-0000000000a1'), 'Duplicate entry') $$, 'an admin soft-deletes a record');
select is((select array[is_deleted::text, deleted_by::text, delete_reason] from public.workouts where id = '00000000-0000-0000-0003-0000000000a1'),
  array['true', '00000000-0000-0000-0000-0000000000a2', 'Duplicate entry'], 'the record is kept, flagged, with who and why');
select is((select count(*) from public.active_workouts where id = '00000000-0000-0000-0003-0000000000a1'), 0::bigint,
  'and excluded from normal queries');
select is((select count(*) from public.daily_target_snapshots where user_id = '00000000-0000-0000-0000-0000000000d1'),
  (select n::bigint from tests.vals where key = 'targets'), 'corrections never change target snapshots');

-- The user's lock is unchanged after a correction.
select tests.login('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$ update public.steps_entries set steps = 1 where id = '00000000-0000-0000-000b-0000000000a1' $$,
  '42501', null, 'the user still cannot edit the corrected (locked) record');

-- ---------------------------------------------------------------------------
-- Deactivation / activation
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.admin_set_user_active('00000000-0000-0000-0000-0000000000d1', false, 'Left the programme') $$, 'an admin deactivates a user');
select is((select array[is_active::text, deactivated_by::text] from public.profiles where id = '00000000-0000-0000-0000-0000000000d1'),
  array['false', '00000000-0000-0000-0000-0000000000a2'], 'soft deactivation records who');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select is((select count(*) from public.meals), 0::bigint, 'a deactivated user loses access immediately');
select is(tests.affected($$ update public.profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000d1' $$), 0,
  'and cannot reactivate themselves');
select tests.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.admin_set_user_active('00000000-0000-0000-0000-0000000000d1', true, 'Back') $$, 'an admin reactivates');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select is((select count(*) from public.meals), 1::bigint, 'access and all data return');

-- ---------------------------------------------------------------------------
-- PIN reset (service role, as the admin-users Edge Function) and create rules
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select throws_ok($$ select public.admin_reset_pin('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', '2222') $$,
  '42501', null, 'an admin cannot reset a super admin''s PIN');
select lives_ok($$ select public.admin_reset_pin('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d1', '4321', 'Forgot PIN') $$,
  'an admin resets a user''s PIN');
select is((select status from public.auth_verify_pin('+919430000005', '4321')), 'OK', 'the new PIN works');
select results_eq(
  $$ select action::text, actor_user_id, reason, old_values_json, new_values_json from public.audit_logs
     where entity_type = 'user_pins' and target_user_id = '00000000-0000-0000-0000-0000000000d1' order by created_at desc limit 1 $$,
  $$ values ('PIN_RESET', '00000000-0000-0000-0000-0000000000a2'::uuid, 'Forgot PIN', null::jsonb, null::jsonb) $$,
  'PIN_RESET is audited with the admin and reason, without any PIN material');
select is(
  array[public.admin_can_create_role('00000000-0000-0000-0000-0000000000a2', 'MANAGER'),
        public.admin_can_create_role('00000000-0000-0000-0000-0000000000a2', 'ADMIN'),
        public.admin_can_create_role('00000000-0000-0000-0000-0000000000a1', 'ADMIN'),
        public.admin_can_create_role('00000000-0000-0000-0000-0000000000a1', 'SUPER_ADMIN'),
        public.admin_can_create_role('00000000-0000-0000-0000-0000000000c1', 'USER')],
  array[true, false, true, false, false], 'who may create which role (never SUPER_ADMIN)');

-- ---------------------------------------------------------------------------
-- Audit log reader and integrity
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000a2');
select ok((select count(*) >= 6 from public.admin_audit_log(null, null, 'ADMIN_CORRECTION', null, null, null, '00000000-0000-0000-0000-0000000000d1')),
  'the audit log filters by action and target');
select is((select count(*) from public.admin_audit_log(null, null, null, 'steps_entries', 'ada', 'uma')), 1::bigint,
  'and by domain, actor and target names');
select is((select count(*) from public.admin_audit_log(tests.today() + 1, null)), 0::bigint, 'and by date range');
select throws_ok($$ update public.audit_logs set reason = 'tampered' $$, '42501', null, 'audit records cannot be modified');
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'nor deleted');
select is((select count(*) from public.admin_dashboard()), 1::bigint, 'the dashboard summarises existing data');

reset role;
select * from finish();
rollback;
