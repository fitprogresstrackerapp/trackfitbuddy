-- Bulk approval of user-created foods: authorization, values unchanged,
-- per-food skips (stale, reviewed, duplicate name), nothing left behind for a
-- skipped food, limits, and audit.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.ver(p_sub uuid) returns timestamptz language sql stable security definer
as $$ select updated_at from public.food_submissions where id = p_sub $$;
-- The batch as the admin screen sends it: ids with the versions it loaded.
create function tests.batch(variadic p_ids uuid[]) returns jsonb language sql stable security definer
as $$ select jsonb_agg(jsonb_build_object('id', i, 'expected_updated_at', tests.ver(i))) from unnest(p_ids) as i $$;
create table tests.result (id uuid, food_item_id uuid, outcome text, message text);
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
grant all on tests.result to authenticated;

insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', '919700000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', '919700000003', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d4', '919700000004', 'authenticated', 'authenticated');
insert into public.profiles (id, phone, name) values
  ('00000000-0000-0000-0000-0000000000a1', '+919700000001', 'Ada Admin'),
  ('00000000-0000-0000-0000-0000000000c3', '+919700000003', 'Uma User'),
  ('00000000-0000-0000-0000-0000000000d4', '+919700000004', 'Max Manager');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000d4', 'MANAGER');

insert into public.food_items (id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) values
  ('00000000-0000-0000-0f00-0000000000f1', 'Qbx poha', 1, 'plate', 250, 5, 45, 6, 2);

insert into public.food_submissions (id, submitted_by, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) values
  ('00000000-0000-0000-05b0-0000000000b1', '00000000-0000-0000-0000-0000000000c3', 'Qbx upma', 1, 'bowl', 220, 6, 35, 7, 3),
  ('00000000-0000-0000-05b0-0000000000b2', '00000000-0000-0000-0000-0000000000c3', 'Qbx vada', 1, 'piece', 140, 4, 15, 8, 2),
  ('00000000-0000-0000-05b0-0000000000b3', '00000000-0000-0000-0000-0000000000c3', 'QBX Poha!', 1, 'plate', 260, 5, 46, 7, 2),
  ('00000000-0000-0000-05b0-0000000000b4', '00000000-0000-0000-0000-0000000000c3', 'Qbx dosa', 1, 'piece', 170, 4, 28, 5, 1),
  ('00000000-0000-0000-05b0-0000000000b5', '00000000-0000-0000-0000-0000000000c3', 'qbx  dosa', 1, 'piece', 175, 4, 29, 5, 1),
  ('00000000-0000-0000-05b0-0000000000b6', '00000000-0000-0000-0000-0000000000c3', 'Qbx idli', 1, 'piece', 58, 2, 12, 0.4, 0.8);

select ok(not has_function_privilege('anon', 'public.admin_approve_food_submissions(jsonb, text)', 'EXECUTE'),
  'anon cannot bulk approve');

set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select * from public.admin_approve_food_submissions(tests.batch('00000000-0000-0000-05b0-0000000000b1')) $$,
  '42501', null, 'a user cannot bulk approve, not even their own foods');
select tests.login('00000000-0000-0000-0000-0000000000d4');
select throws_ok($$ select * from public.admin_approve_food_submissions(tests.batch('00000000-0000-0000-05b0-0000000000b1')) $$,
  '42501', null, 'a manager cannot bulk approve');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select * from public.admin_approve_food_submissions('[]') $$,
  '22023', 'Select at least one food', 'an empty batch is refused');
select throws_ok(
  $$ select * from public.admin_approve_food_submissions(
       (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'expected_updated_at', now())) from generate_series(1, 51))) $$,
  '22023', 'Approve at most 50 foods at once', 'more than 50 foods at once is refused');

-- The idli changed after the admin loaded the list: the screen holds an older version.
create temp table loaded as select tests.batch(
  '00000000-0000-0000-05b0-0000000000b1', '00000000-0000-0000-05b0-0000000000b2',
  '00000000-0000-0000-05b0-0000000000b3', '00000000-0000-0000-05b0-0000000000b4',
  '00000000-0000-0000-05b0-0000000000b5')
  || jsonb_build_array(jsonb_build_object('id', '00000000-0000-0000-05b0-0000000000b6',
                                          'expected_updated_at', now() - interval '1 minute')) as items;

select lives_ok($$ insert into tests.result
  select * from public.admin_approve_food_submissions((select items from loaded), 'Batch review') $$,
  'an admin approves a batch');
select results_eq(
  $$ select id, outcome, message from tests.result order by id $$,
  $$ values
     ('00000000-0000-0000-05b0-0000000000b1'::uuid, 'APPROVED'::text, null::text),
     ('00000000-0000-0000-05b0-0000000000b2', 'APPROVED', null),
     ('00000000-0000-0000-05b0-0000000000b3', 'SKIPPED', 'An active food with this name already exists. Use a more specific name.'),
     ('00000000-0000-0000-05b0-0000000000b4', 'APPROVED', null),
     ('00000000-0000-0000-05b0-0000000000b5', 'SKIPPED', 'An active food with this name already exists. Use a more specific name.'),
     ('00000000-0000-0000-05b0-0000000000b6', 'SKIPPED', 'Changed since the list was loaded') $$,
  'each food is approved or skipped with its reason; one problem does not stop the rest');
select results_eq(
  $$ select f.name, f.calories, f.protein_g, f.serving_unit, f.is_approximate, f.source_submission_id
     from public.food_items f join tests.result r on r.food_item_id = f.id
     where r.id = '00000000-0000-0000-05b0-0000000000b1' $$,
  $$ values ('Qbx upma'::text, 220.00::numeric, 6.00::numeric, 'bowl'::text, true, '00000000-0000-0000-05b0-0000000000b1'::uuid) $$,
  'approved foods carry the submitted values unchanged, marked approximate, linked to the submission');
select is(
  (select count(*)::integer from public.food_submissions
   where id in ('00000000-0000-0000-05b0-0000000000b1', '00000000-0000-0000-05b0-0000000000b2', '00000000-0000-0000-05b0-0000000000b4')
     and status = 'APPROVED' and reviewed_by = '00000000-0000-0000-0000-0000000000a1' and review_notes = 'Batch review'),
  3, 'approved submissions record the reviewer and the note');
select is(
  (select count(*)::integer from public.food_submissions
   where id in ('00000000-0000-0000-05b0-0000000000b3', '00000000-0000-0000-05b0-0000000000b5', '00000000-0000-0000-05b0-0000000000b6')
     and status = 'PENDING_REVIEW' and reviewed_at is null),
  3, 'skipped foods stay pending for individual review');
select is(
  (select count(*)::integer from public.food_items where source_submission_id in (
     '00000000-0000-0000-05b0-0000000000b3', '00000000-0000-0000-05b0-0000000000b5', '00000000-0000-0000-05b0-0000000000b6')),
  0, 'a skipped food leaves no shared food behind');
select is(
  (select count(*)::integer from public.food_items where name_normalized = 'qbx dosa' and not is_deleted),
  1, 'two foods with the same name in one batch give one shared food');
select is(
  (select count(*)::integer from public.search_foods('qbx upma') where source = 'FOOD' and name = 'Qbx upma'),
  1, 'an approved food is in search');

-- Approving the same list again changes nothing.
select is(
  (select string_agg(distinct outcome, ',') from public.admin_approve_food_submissions((select items from loaded))),
  'SKIPPED', 'a repeated submission of the same batch approves nothing twice');
select is((select count(*)::integer from public.food_items where source_submission_id = '00000000-0000-0000-05b0-0000000000b1'),
  1, 'still one shared food per submission');

reset role;
select is(
  (select count(*)::integer from public.audit_logs
   where entity_type = 'food_submissions' and action = 'UPDATE'
     and actor_user_id = '00000000-0000-0000-0000-0000000000a1' and reason = 'Batch review'
     and entity_id in ('00000000-0000-0000-05b0-0000000000b1', '00000000-0000-0000-05b0-0000000000b2', '00000000-0000-0000-05b0-0000000000b4')),
  3, 'every approval in the batch is audited with the admin and the note');

select * from finish();
rollback;
