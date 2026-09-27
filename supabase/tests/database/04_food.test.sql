-- Food logging: log_meal, late entry, copy_meal, search_foods, food_usage.
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

create schema tests;
create function tests.login(p_id uuid) returns void language sql
as $$ select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
create function tests.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', '919100000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', '919100000002', 'authenticated', 'authenticated');
insert into public.profiles (id, phone, name) values
  ('00000000-0000-0000-0000-0000000000a1', '+919100000001', 'Alice'),
  ('00000000-0000-0000-0000-0000000000b2', '+919100000002', 'Bob');

insert into public.food_items (id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) values
  ('00000000-0000-0000-0f00-000000000001', 'Chicken breast', 100, 'g', 165, 31, 0, 3.6, 0),
  ('00000000-0000-0000-0f00-000000000002', 'Chicken curry', 1, 'bowl', 320, 24, 10, 20, 2),
  ('00000000-0000-0000-0f00-000000000003', 'Banana', 1, 'piece', 105, 1.3, 27, 0.4, 3.1);

insert into public.food_submissions (id, submitted_by, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g) values
  ('00000000-0000-0000-05b0-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'Chicken biryani home', 1, 'plate', 600, 25, 80, 18, 3),
  ('00000000-0000-0000-05b0-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'Chicken secret recipe', 1, 'plate', 500, 30, 40, 20, 2);

-- Bob has a meal today (for isolation checks).
insert into public.meals (id, user_id, meal_date) values
  ('00000000-0000-0000-0e00-0000000000b2', '00000000-0000-0000-0000-0000000000b2', tests.today());
insert into public.meal_items (meal_id, user_id, food_item_id, quantity)
values ('00000000-0000-0000-0e00-0000000000b2', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0f00-000000000003', 1);

create table tests.ids (key text primary key, id uuid);
grant all on tests.ids to authenticated;

set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000a1');

-- ---------------------------------------------------------------------------
-- log_meal: today
-- ---------------------------------------------------------------------------
select lives_ok($$
  insert into tests.ids values ('today', public.log_meal(
    tests.today(),
    '[{"food_item_id": "00000000-0000-0000-0f00-000000000001", "quantity": 200},
      {"food_item_id": "00000000-0000-0000-0f00-000000000003", "quantity": 2}]',
    'LUNCH'))
$$, 'log_meal creates a meal with items for today');
select results_eq(
  $$ select food_name_snapshot, quantity, unit, snapshot_calories, snapshot_protein_g
     from public.meal_items where meal_id = (select id from tests.ids where key = 'today') order by food_name_snapshot $$,
  $$ values ('Banana'::text, 2.00::numeric, 'piece'::text, 210.00::numeric, 2.60::numeric),
            ('Chicken breast', 200.00, 'g', 330.00, 62.00) $$,
  'nutrition snapshots are computed by the database from food, quantity and serving unit'
);
select is(
  (select meal_category::text from public.meals where id = (select id from tests.ids where key = 'today')),
  'LUNCH', 'category stored');
select lives_ok(
  $$ update public.meal_items set quantity = 300 where meal_id = (select id from tests.ids where key = 'today') and unit = 'g' $$,
  'today''s items stay editable');
select is(
  (select snapshot_calories from public.meal_items where meal_id = (select id from tests.ids where key = 'today') and unit = 'g'),
  495.00::numeric, 'quantity change rescales the snapshot');

select throws_ok($$ select public.log_meal(tests.today(), '[]') $$, '22023', null, 'a meal needs at least one food');
select throws_ok(
  $$ select public.log_meal(tests.today() + 1, '[{"food_item_id": "00000000-0000-0000-0f00-000000000003", "quantity": 1}]') $$,
  '22023', 'Food cannot be logged for a future date', 'future dates are rejected');
select throws_ok(
  $$ select public.log_meal(tests.today(), '[{"food_item_id": "00000000-0000-0000-0f00-000000000003", "quantity": 0}]') $$,
  '23514', null, 'quantity must be positive');
select throws_ok(
  $$ select public.log_meal(tests.today(), '[{"food_submission_id": "00000000-0000-0000-05b0-0000000000b2", "quantity": 1}]') $$,
  '23503', null, 'another user''s pending food cannot be logged');
select lives_ok(
  $$ select public.log_meal(tests.today(), '[{"food_submission_id": "00000000-0000-0000-05b0-0000000000a1", "quantity": 1}]') $$,
  'own pending food can be logged');

-- add_meal_items: appends to an existing editable meal
select lives_ok(
  $$ select public.add_meal_items((select id from tests.ids where key = 'today'), '[{"food_item_id": "00000000-0000-0000-0f00-000000000002", "quantity": 1}]') $$,
  'foods can be added to today''s existing meal');
select is(
  (select count(*) from public.meal_items where meal_id = (select id from tests.ids where key = 'today')),
  3::bigint, 'the existing meal now has three items (no duplicate meal)');
select throws_ok(
  $$ select public.add_meal_items('00000000-0000-0000-0e00-0000000000b2', '[{"food_item_id": "00000000-0000-0000-0f00-000000000003", "quantity": 1}]') $$,
  'P0002', null, 'foods cannot be added to another user''s meal');

-- ---------------------------------------------------------------------------
-- Late entry (historical, missing food)
-- ---------------------------------------------------------------------------
select lives_ok($$
  insert into tests.ids values ('late', public.log_meal(
    tests.today() - 3,
    '[{"food_item_id": "00000000-0000-0000-0f00-000000000002", "quantity": 1},
      {"food_item_id": "00000000-0000-0000-0f00-000000000003", "quantity": 1}]',
    'DINNER'))
$$, 'a missing past meal can be created through log_meal');
select is(
  (select count(*) from public.meal_items where meal_id = (select id from tests.ids where key = 'late')),
  2::bigint, 'late meal has its items');
select throws_ok(
  $$ update public.meal_items set quantity = 2 where meal_id = (select id from tests.ids where key = 'late') $$,
  '42501', 'Record is locked and can no longer be changed', 'a late entry is locked once created');
select throws_ok(
  $$ update public.meals set is_deleted = true where id = (select id from tests.ids where key = 'late') $$,
  '42501', 'Record is locked and can no longer be changed', 'a late entry cannot be deleted by the user');
select throws_ok(
  $$ insert into public.meal_items (meal_id, user_id, food_item_id, quantity)
     values ((select id from tests.ids where key = 'late'), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0f00-000000000003', 1) $$,
  '42501', null, 'items cannot be added to an existing past meal');
select throws_ok(
  $$ insert into public.meals (user_id, meal_date) values ('00000000-0000-0000-0000-0000000000a1', tests.today() - 2) $$,
  '42501', null, 'direct past-date inserts are still rejected');
select throws_ok(
  $$ select public.add_meal_items((select id from tests.ids where key = 'late'), '[{"food_item_id": "00000000-0000-0000-0f00-000000000003", "quantity": 1}]') $$,
  '42501', null, 'add_meal_items cannot extend a past (locked) meal');
select throws_ok(
  $$ select public.log_meal(tests.today() - 91, '[{"food_item_id": "00000000-0000-0000-0f00-000000000003", "quantity": 1}]') $$,
  '22023', null, 'late entry is limited to the last 90 days');
select throws_ok(
  $$ select count(*) from private.late_entry_grants $$,
  '42501', null, 'late-entry grants are not readable by users');
select throws_ok(
  $$ insert into private.late_entry_grants (txid, user_id, meal_date) values (txid_current(), '00000000-0000-0000-0000-0000000000a1', tests.today() - 2) $$,
  '42501', null, 'late-entry grants cannot be forged by users');
select throws_ok(
  $$ select private.late_entry_granted('00000000-0000-0000-0000-0000000000a1', tests.today(), null) $$,
  '42501', null, 'users cannot call the grant check directly');

-- ---------------------------------------------------------------------------
-- copy_meal
-- ---------------------------------------------------------------------------
select lives_ok($$
  insert into tests.ids values ('copy', public.copy_meal((select id from tests.ids where key = 'late'), tests.today()))
$$, 'a locked historical meal can be copied to today');
select results_eq(
  $$ select meal_date, meal_category::text, copied_from_meal_id from public.meals where id = (select id from tests.ids where key = 'copy') $$,
  $$ values (tests.today(), 'DINNER'::text, (select id from tests.ids where key = 'late')) $$,
  'the copy is a new meal on the target date that records its source');
select results_eq(
  $$ select food_item_id, quantity from public.meal_items where meal_id = (select id from tests.ids where key = 'copy') order by quantity, food_item_id $$,
  $$ select food_item_id, quantity from public.meal_items where meal_id = (select id from tests.ids where key = 'late') order by quantity, food_item_id $$,
  'the copy has the same foods and quantities');
select lives_ok(
  $$ update public.meal_items set quantity = 3 where meal_id = (select id from tests.ids where key = 'copy') and food_item_id = '00000000-0000-0000-0f00-000000000003' $$,
  'the copy is editable today');
select is(
  (select quantity from public.meal_items where meal_id = (select id from tests.ids where key = 'late') and food_item_id = '00000000-0000-0000-0f00-000000000003'),
  1.00::numeric, 'editing the copy never changes the original');
select throws_ok(
  $$ select public.copy_meal('00000000-0000-0000-0e00-0000000000b2', tests.today()) $$,
  'P0002', null, 'another user''s meal cannot be copied');
select throws_ok(
  $$ select public.copy_meal((select id from tests.ids where key = 'late'), tests.today() + 1) $$,
  '22023', null, 'meals cannot be copied into the future');

-- ---------------------------------------------------------------------------
-- search_foods and food_usage
-- ---------------------------------------------------------------------------
select ok(
  (select bool_or(name = 'Chicken breast' and source = 'FOOD') from public.search_foods('chick')),
  'shared approved foods are found by partial name');
select ok(
  (select bool_or(name = 'Chicken biryani home' and review_status = 'PENDING_REVIEW') from public.search_foods('chicken')),
  'the user''s own pending food is found and marked pending');
select ok(
  not (select coalesce(bool_or(name = 'Chicken secret recipe'), false) from public.search_foods('chicken')),
  'another user''s pending food is never returned');
select is(
  (select name from public.search_foods('chicken breast') limit 1),
  'Chicken breast', 'an exact name match ranks first');
select is(
  (select name from public.search_foods('chicken') where source = 'FOOD' limit 1),
  'Chicken curry', 'among equal matches, a food the user logged ranks higher');
select ok(
  (select count(*) = 0 from public.search_foods('c')), 'queries shorter than two characters return nothing');
select results_eq(
  $$ select name from public.food_usage('frequent', 3) $$,
  $$ values ('Banana'::text), ('Chicken curry'), ('Chicken biryani home') $$,
  'frequent foods are ordered by use count');
select is(
  (select count(*) from public.food_usage('recent', 8) where name = 'Chicken secret recipe'),
  0::bigint, 'usage never includes other users'' foods');

-- Master food change never rewrites logged snapshots.
reset role;
update public.food_items set calories = 150 where id = '00000000-0000-0000-0f00-000000000001';
set local role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000a1');
select is(
  (select snapshot_calories from public.meal_items where meal_id = (select id from tests.ids where key = 'today') and unit = 'g'),
  495.00::numeric, 'a master food change leaves logged nutrition unchanged');

-- Isolation
select tests.login('00000000-0000-0000-0000-0000000000b2');
select is(
  (select count(*) from public.meals where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'another user cannot read the meals');

reset role;
select * from finish();
rollback;
