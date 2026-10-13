-- Admin Food Database: authorization, create / edit / activate / deactivate,
-- review of user-created foods, duplicates, audit, and historical snapshots.
begin;
create extension if not exists pgtap with schema extensions;

select plan(59);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create function tests.affected(p_sql text) returns integer language plpgsql
as $$ declare n integer; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
create function tests.ver(p_food uuid) returns timestamptz language sql stable security definer
as $$ select updated_at from public.food_items where id = p_food $$;
create function tests.sub_ver(p_sub uuid) returns timestamptz language sql stable security definer
as $$ select updated_at from public.food_submissions where id = p_sub $$;
create table tests.ids (key text primary key, id uuid);
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
grant all on tests.ids to authenticated;

insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', '919600000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', '919600000002', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', '919600000003', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d4', '919600000004', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e5', '919600000005', 'authenticated', 'authenticated');
insert into public.profiles (id, phone, name) values
  ('00000000-0000-0000-0000-0000000000a1', '+919600000001', 'Ada Admin'),
  ('00000000-0000-0000-0000-0000000000b2', '+919600000002', 'Sam Super'),
  ('00000000-0000-0000-0000-0000000000c3', '+919600000003', 'Uma User'),
  ('00000000-0000-0000-0000-0000000000d4', '+919600000004', 'Max Manager'),
  ('00000000-0000-0000-0000-0000000000e5', '+919600000005', 'Ola Other');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000b2', 'SUPER_ADMIN'),
  ('00000000-0000-0000-0000-0000000000d4', 'MANAGER');

insert into public.food_items (id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) values
  ('00000000-0000-0000-0f00-0000000000f1', 'Zqx paneer tikka', 100, 'g', 300, 18, 6, 22, 1),
  ('00000000-0000-0000-0f00-0000000000f2', 'Zqx dal', 1, 'bowl', 180, 9, 24, 5, 6);

insert into public.food_submissions (id, submitted_by, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) values
  ('00000000-0000-0000-05b0-0000000000c1', '00000000-0000-0000-0000-0000000000c3', 'zqx chicken biryani', 1, 'plate', 600, 25, 80, 18, 3),
  ('00000000-0000-0000-05b0-0000000000c2', '00000000-0000-0000-0000-0000000000e5', 'Zqx mystery curry', 1, 'bowl', 400, 20, 30, 20, 4),
  ('00000000-0000-0000-05b0-0000000000c3', '00000000-0000-0000-0000-0000000000c3', 'ZQX  Dal!', 1, 'bowl', 170, 9, 22, 5, 6);

-- ---------------------------------------------------------------------------
-- Nobody but an admin can use the admin functions.
-- ---------------------------------------------------------------------------
select ok(
  bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')),
  'anon cannot execute any admin food function')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'admin_list_foods', 'admin_food_duplicates', 'admin_create_food', 'admin_update_food',
  'admin_set_food_active', 'admin_approve_food_submission', 'admin_reject_food_submission');

set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000c3');
-- Uma logs her own pending food and a shared food before anything changes.
select lives_ok($$
  insert into tests.ids values ('meal_before', public.log_meal(tests.today(),
    '[{"food_item_id": "00000000-0000-0000-0f00-0000000000f1", "quantity": 100},
      {"food_submission_id": "00000000-0000-0000-05b0-0000000000c1", "quantity": 1}]'))
$$, 'a user logs a shared food and their own pending food');

select throws_ok($$ select * from public.admin_list_foods() $$, '42501', null, 'a user cannot list the admin catalogue');
select throws_ok($$ select * from public.admin_food_duplicates('zqx dal') $$, '42501', null, 'a user cannot ask for duplicates');
select throws_ok($$ select public.admin_create_food('Zqx hack', 1, 'g', 1, 0, 0, 0, 0) $$,
  '42501', null, 'a user cannot create a shared food');
select throws_ok($$ select public.admin_update_food('00000000-0000-0000-0f00-0000000000f1',
    tests.ver('00000000-0000-0000-0f00-0000000000f1'), 'Zqx paneer tikka', 100, 'g', 1, 0, 0, 0, 0, true) $$,
  '42501', null, 'a user cannot edit a shared food');
select throws_ok($$ select public.admin_set_food_active('00000000-0000-0000-0f00-0000000000f1',
    tests.ver('00000000-0000-0000-0f00-0000000000f1'), false) $$,
  '42501', null, 'a user cannot deactivate a shared food');
select throws_ok($$ select public.admin_approve_food_submission('00000000-0000-0000-05b0-0000000000c1',
    tests.sub_ver('00000000-0000-0000-05b0-0000000000c1'), 'zqx chicken biryani', 1, 'plate', 600, 25, 80, 18, 3) $$,
  '42501', null, 'a user cannot approve their own food');
select throws_ok($$ select public.admin_reject_food_submission('00000000-0000-0000-05b0-0000000000c2',
    tests.sub_ver('00000000-0000-0000-05b0-0000000000c2')) $$,
  '42501', null, 'a user cannot reject another user''s food');
select is(tests.affected($$ update public.food_items set calories = 1 where id = '00000000-0000-0000-0f00-0000000000f1' $$),
  0, 'a user cannot edit a shared food directly');
select throws_ok($$ update public.food_submissions set status = 'APPROVED', reviewed_at = now(),
    approved_food_item_id = '00000000-0000-0000-0f00-0000000000f1' where id = '00000000-0000-0000-05b0-0000000000c1' $$,
  '42501', null, 'a user cannot approve their own food directly');
select is(tests.affected($$ update public.food_submissions set calories = 1 where id = '00000000-0000-0000-05b0-0000000000c2' $$),
  0, 'a user cannot change another user''s submission');

select tests.login('00000000-0000-0000-0000-0000000000d4');
select throws_ok($$ select public.admin_create_food('Zqx manager food', 1, 'g', 1, 0, 0, 0, 0) $$,
  '42501', null, 'a manager cannot manage the food database');

-- ---------------------------------------------------------------------------
-- Create, validation and duplicate names.
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into tests.ids values ('admin_food',
  public.admin_create_food('Zqx sprouts salad', 1, 'bowl', 150, 10, 20, 2, 6, false)) $$,
  'an admin creates a shared food');
select results_eq(
  $$ select name, calories, protein_g, is_approximate, created_by, version, is_deleted
     from public.food_items where id = (select id from tests.ids where key = 'admin_food') $$,
  $$ values ('Zqx sprouts salad'::text, 150.00::numeric, 10.00::numeric, false, '00000000-0000-0000-0000-0000000000a1'::uuid, 1, false) $$,
  'the food is stored exactly as entered, by the admin, version 1');
select is(
  (select source || '/' || status from public.admin_list_foods('zqx sprouts') where name = 'Zqx sprouts salad'),
  'ADMIN/ACTIVE', 'the list shows it as an active food added by an admin');
select throws_ok($$ select public.admin_create_food('ZQX  Paneer-Tikka', 100, 'g', 300, 18, 6, 22, 1) $$,
  '22023', 'An active food with this name already exists. Use a more specific name.',
  'a second active food with the same normalized name is refused');
select throws_ok($$ select public.admin_create_food('Zqx bad', 100, 'g', 300, -1, 6, 22, 1) $$,
  '22023', null, 'negative nutrition is refused');
select throws_ok($$ select public.admin_create_food('Zqx bad', 100, 'Grams!', 300, 1, 6, 22, 1) $$,
  '22023', null, 'an invalid unit is refused');
select throws_ok($$ select public.admin_create_food('Zqx bad', 0, 'g', 300, 1, 6, 22, 1) $$,
  '22023', null, 'a zero serving is refused');
select lives_ok($$ insert into tests.ids values ('inactive_twin',
  public.admin_create_food('ZQX  Paneer-Tikka', 1, 'piece', 90, 5, 2, 7, 0, true, false)) $$,
  'an inactive food may share a name with an active one');
select is((select count(*)::integer from public.admin_list_foods('zqx paneer') where name ilike 'zqx%paneer%'), 2, 'search finds active and inactive foods');
select is((select count(*)::integer from public.admin_list_foods('zqx paneer', 'ACTIVE') where name ilike 'zqx%paneer%'), 1, 'the status filter applies');
select is((select count(*)::integer from public.admin_list_foods('zqx', 'PENDING_REVIEW') where name ilike 'zqx%'), 3, 'the review queue lists pending foods');
select is((select submitted_by_name from public.admin_list_foods('zqx mystery') where name = 'Zqx mystery curry'), 'Ola Other',
  'the queue names the submitting user');

-- ---------------------------------------------------------------------------
-- Edit: version check, history, and meals already logged.
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.admin_update_food('00000000-0000-0000-0f00-0000000000f1',
    now() - interval '1 day', 'Zqx paneer tikka', 100, 'g', 280, 18, 6, 20, 1, true) $$,
  'PT409', null, 'a stale edit is refused, not overwritten');
select lives_ok($$ select public.admin_update_food('00000000-0000-0000-0f00-0000000000f1',
    tests.ver('00000000-0000-0000-0f00-0000000000f1'), 'Zqx paneer tikka', 100, 'g', 280, 18, 6, 20, 1, true, 'Lab value') $$,
  'an admin corrects the nutrition');
select results_eq(
  $$ select version, calories from public.food_items where id = '00000000-0000-0000-0f00-0000000000f1' $$,
  $$ values (2, 280.00::numeric) $$, 'the food has the new values as version 2');
select is((select count(*)::integer from public.food_item_versions where food_item_id = '00000000-0000-0000-0f00-0000000000f1'),
  2, 'the previous values stay in the version history');
select throws_ok($$ select public.admin_update_food('00000000-0000-0000-0f00-0000000000f1',
    tests.ver('00000000-0000-0000-0f00-0000000000f1'), 'Zqx paneer tikka', 100, 'g', 280, 18, 6, 20, 1, true) $$,
  '22023', 'Nothing to correct', 'saving unchanged values is refused');
select throws_ok($$ select public.admin_update_food('00000000-0000-0000-0f00-0000000000f2',
    tests.ver('00000000-0000-0000-0f00-0000000000f2'), 'Zqx paneer tikka', 1, 'bowl', 180, 9, 24, 5, 6, true) $$,
  '22023', null, 'renaming onto another active food''s name is refused');

select tests.login('00000000-0000-0000-0000-0000000000c3');
select is(
  (select snapshot_calories from public.meal_items
   where meal_id = (select id from tests.ids where key = 'meal_before') and food_item_id = '00000000-0000-0000-0f00-0000000000f1'),
  300.00::numeric, 'a meal logged before the edit keeps its snapshot');
select lives_ok($$
  insert into tests.ids values ('meal_after', public.log_meal(tests.today(),
    '[{"food_item_id": "00000000-0000-0000-0f00-0000000000f1", "quantity": 100}]'))
$$, 'the user logs the food again');
select is(
  (select snapshot_calories from public.meal_items where meal_id = (select id from tests.ids where key = 'meal_after')),
  280.00::numeric, 'a new log uses the corrected values');

-- ---------------------------------------------------------------------------
-- Deactivate / activate.
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.admin_set_food_active('00000000-0000-0000-0f00-0000000000f1', now() - interval '1 day', false) $$,
  'PT409', null, 'a stale deactivation is refused');
select lives_ok($$ select public.admin_set_food_active('00000000-0000-0000-0f00-0000000000f1',
    tests.ver('00000000-0000-0000-0f00-0000000000f1'), false, 'Duplicate of a better entry') $$,
  'an admin deactivates a food');
select tests.login('00000000-0000-0000-0000-0000000000c3');
select is((select count(*)::integer from public.search_foods('zqx paneer') where source = 'FOOD'), 0,
  'an inactive food is not in user search');
select throws_ok($$ select public.log_meal(tests.today(), '[{"food_item_id": "00000000-0000-0000-0f00-0000000000f1", "quantity": 1}]') $$,
  '23503', null, 'an inactive food cannot be logged');
select is((select count(*)::integer from public.meal_items where food_item_id = '00000000-0000-0000-0f00-0000000000f1' and not is_deleted),
  2, 'meals that used the food are kept');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select results_eq(
  $$ select status, review_notes from public.admin_list_foods('zqx paneer tikka', 'INACTIVE') where id = '00000000-0000-0000-0f00-0000000000f1' $$,
  $$ values ('INACTIVE'::text, 'Duplicate of a better entry'::text) $$,
  'admins still see the inactive food and why');
select lives_ok($$ select public.admin_set_food_active('00000000-0000-0000-0f00-0000000000f1',
    tests.ver('00000000-0000-0000-0f00-0000000000f1'), true) $$,
  'an admin activates the food again');
select throws_ok($$ select public.admin_set_food_active((select id from tests.ids where key = 'inactive_twin'),
    tests.ver((select id from tests.ids where key = 'inactive_twin')), true) $$,
  '22023', null, 'activation is refused while it would duplicate an active name');

-- ---------------------------------------------------------------------------
-- Review: approve, reject, duplicates.
-- ---------------------------------------------------------------------------
select ok(
  (select bool_or(is_exact) from public.admin_food_duplicates('ZQX  Dal!')),
  'the review flags an existing food with the same name');
select lives_ok($$ insert into tests.ids values ('approved',
  public.admin_approve_food_submission('00000000-0000-0000-05b0-0000000000c1',
    tests.sub_ver('00000000-0000-0000-05b0-0000000000c1'),
    'Zqx chicken biryani (home)', 1, 'plate', 600, 25, 80, 18, 3, true, 'Checked against a recipe')) $$,
  'an admin approves a user-created food, with a clearer name');
select results_eq(
  $$ select s.status::text, s.reviewed_by, s.approved_food_item_id, s.name, f.name, f.source_submission_id, f.created_by
     from public.food_submissions s join public.food_items f on f.id = s.approved_food_item_id
     where s.id = '00000000-0000-0000-05b0-0000000000c1' $$,
  $$ values ('APPROVED'::text, '00000000-0000-0000-0000-0000000000a1'::uuid, (select id from tests.ids where key = 'approved'),
             'zqx chicken biryani'::text, 'Zqx chicken biryani (home)'::text, '00000000-0000-0000-05b0-0000000000c1'::uuid,
             '00000000-0000-0000-0000-0000000000a1'::uuid) $$,
  'the shared food keeps its provenance; the submission keeps what the user entered');
select is(
  (select source from public.admin_list_foods('zqx chicken biryani home') where kind = 'FOOD' and name = 'Zqx chicken biryani (home)'),
  'USER_SUBMISSION', 'the approved food is still marked as user-created');
select throws_ok($$ select public.admin_approve_food_submission('00000000-0000-0000-05b0-0000000000c1',
    tests.sub_ver('00000000-0000-0000-05b0-0000000000c1'), 'Zqx again', 1, 'plate', 600, 25, 80, 18, 3) $$,
  '22023', 'This food has already been reviewed', 'a food cannot be approved twice');
select throws_ok($$ select public.admin_approve_food_submission('00000000-0000-0000-05b0-0000000000c3',
    tests.sub_ver('00000000-0000-0000-05b0-0000000000c3'), 'ZQX  Dal!', 1, 'bowl', 170, 9, 22, 5, 6) $$,
  '22023', null, 'a duplicate of an active food cannot be approved under the same name');
select lives_ok($$ select public.admin_reject_food_submission('00000000-0000-0000-05b0-0000000000c3',
    tests.sub_ver('00000000-0000-0000-05b0-0000000000c3'), 'Duplicate of Zqx dal') $$,
  'an admin rejects the duplicate');

select tests.login('00000000-0000-0000-0000-0000000000e5');
select is((select count(*)::integer from public.search_foods('zqx chicken biryani') where source = 'FOOD' and name = 'Zqx chicken biryani (home)'), 1,
  'every user now finds the approved food');
select tests.login('00000000-0000-0000-0000-0000000000c3');
select is((select count(*)::integer from public.search_foods('zqx dal') where source = 'SUBMISSION'), 0,
  'a rejected food is not offered to its creator');
select throws_ok($$ select public.log_meal(tests.today(), '[{"food_submission_id": "00000000-0000-0000-05b0-0000000000c3", "quantity": 1}]') $$,
  '23503', null, 'a rejected food cannot be logged');
select is(
  (select id from public.food_usage('recent') where name = 'Zqx chicken biryani (home)'),
  (select id from tests.ids where key = 'approved'),
  'after approval the creator''s recent foods show the shared food');
select lives_ok($$ insert into tests.ids values ('copied',
  public.copy_meal((select id from tests.ids where key = 'meal_before'), tests.today())) $$,
  'the creator copies the meal logged before approval');
select is(
  (select food_item_id from public.meal_items where meal_id = (select id from tests.ids where key = 'copied') and food_name_snapshot like 'Zqx chicken%'),
  (select id from tests.ids where key = 'approved'),
  'the copy logs the shared food');
select is(
  (select count(*)::integer from public.meal_items where food_submission_id = '00000000-0000-0000-05b0-0000000000c1'),
  1, 'the original meal still refers to the submission, with its snapshot');

-- ---------------------------------------------------------------------------
-- Super admin, audit.
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.admin_create_food('Zqx super food', 1, 'g', 4, 0, 1, 0, 0) $$,
  'a super admin manages the food database');

reset role;
select results_eq(
  $$ select action::text, actor_user_id, reason from public.audit_logs
     where entity_type = 'food_items' and entity_id = '00000000-0000-0000-0f00-0000000000f1' and action <> 'CREATE'
     order by action::text $$,
  $$ values ('DELETE'::text, '00000000-0000-0000-0000-0000000000a1'::uuid, 'Duplicate of a better entry'::text),
            ('RESTORE', '00000000-0000-0000-0000-0000000000a1'::uuid, null),
            ('UPDATE', '00000000-0000-0000-0000-0000000000a1'::uuid, 'Lab value') $$,
  'edit, deactivation and activation are audited with the admin and the reason');
select results_eq(
  $$ select action::text, actor_user_id, target_user_id, new_values_json ->> 'status' from public.audit_logs
     where entity_type = 'food_submissions'
       and entity_id in ('00000000-0000-0000-05b0-0000000000c1', '00000000-0000-0000-05b0-0000000000c3')
     order by entity_id $$,
  $$ values ('UPDATE'::text, '00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000c3'::uuid, 'APPROVED'::text),
            ('UPDATE', '00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000c3'::uuid, 'REJECTED') $$,
  'approval and rejection are audited with the reviewer and the submitter');

select * from finish();
rollback;
