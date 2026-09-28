# Database

The PostgreSQL / Supabase data model, and the security model built on it. The SQL in
`supabase/migrations/` is authoritative. This page explains how it's structured and why.

## Migrations

| File                                    | Contents                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `…0100_extensions_and_types.sql`        | `pg_trgm`, `btree_gist`, `private` schema, enums, generic helpers                                                                |
| `…0200_profiles_roles_settings.sql`     | profiles, user_roles, manager assignments, system_settings, access helper functions                                              |
| `…0300_goals_and_recommendations.sql`   | goals, processing runs/users, AI usage, recommendation cycles, feedback, target snapshots                                        |
| `…0400_food_and_meals.sql`              | food submissions, food items and versions, merges, meals, meal items (snapshots)                                                 |
| `…0500_training_and_body.sql`           | workouts, activities, steps, InBody reports/metrics, weight history                                                              |
| `…0600_groups.sql`                      | groups, memberships, group helpers, `get_group_member_day()`                                                                     |
| `…0700_audit_and_record_integrity.sql`  | audit log, record guard (locking and soft delete), audit triggers                                                                |
| `…0800_rls_policies_and_views.sql`      | grants, RLS policies, read views                                                                                                 |
| `20260928000100_pin_authentication.sql` | PIN hashes and lockout (`private` schema), `auth_verify_pin`, `auth_set_pin`, `save_onboarding_measurements`                     |
| `20261001000100_food_logging.sql`       | late-entry grants, record guard update, `log_meal`, `add_meal_items`, `copy_meal`, `search_foods`, `food_usage`                  |
| `20261002000100_training_logging.sql`   | optional names, DB-computed calorie estimates (`training_calorie_rates`), `log_workout`, `log_activity`, late entry for training |
| `20261003000100_progress_analytics.sql` | `daily_nutrition()` — per-day totals of the caller's meal-item snapshots for Progress                                            |

### Workflow

Requires Docker.

```bash
npm run db:start   # start local Postgres (Supabase image)
npm run db:reset   # recreate the DB, apply all migrations and seed.sql
npm run db:test    # pgTAP tests in supabase/tests/database
npm run db:lint    # plpgsql_check over all functions
npm run db:types   # regenerate src/types/database.ts
npm run db:stop
```

- Schema changes are **new** migration files (`npx supabase migration new <name>`). Never
  edit production by hand, and never edit a migration once it has been applied to a shared
  or production database.
- After a schema change, run `db:reset`, `db:test` and `db:types`.
- `supabase/seed.sql` is intentionally empty. There are no fake users or health data.
  Required configuration (the `system_settings` defaults) comes from migrations.

## Tables

| Area            | Tables                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity        | `profiles` (id = `auth.users.id`), `user_roles`, `manager_user_assignments`                                                                                           |
| Configuration   | `system_settings`                                                                                                                                                     |
| Goals           | `goals` (long-term goal + free-text objective, versioned), `goal_focuses` (short-term goals)                                                                          |
| Recommendations | `recommendation_processing_runs`, `recommendation_processing_users`, `ai_usage_records`, `recommendation_cycles`, `recommendation_feedback`, `daily_target_snapshots` |
| Food            | `food_items`, `food_item_versions`, `food_submissions`, `food_merges`, `meals`, `meal_items`                                                                          |
| Training        | `workouts`, `activities`, `steps_entries`                                                                                                                             |
| Body            | `weight_measurements`, `inbody_reports`, `inbody_metrics`                                                                                                             |
| Groups          | `groups`, `group_memberships`                                                                                                                                         |
| Audit           | `audit_logs`                                                                                                                                                          |

Conventions: `uuid` ids from `gen_random_uuid()`, `timestamptz` (UTC) timestamps, `date`
for calendar days, `numeric` for measurements, `jsonb` only for AI payloads and open-ended
InBody metrics. Child tables that belong to a user carry `user_id` and use a composite
foreign key `(parent_id, user_id)`. This makes it impossible to attach one user's row to
another user's parent, and lets RLS check ownership without joins.

Enums are used for stable spec-defined sets (roles, statuses, sources, group roles,
audit actions, meal category, activity level, gender). Goal types, workout types,
activity types and units are CHECK-constrained text, so they can evolve without enum
migrations.

## Role model

| Role                        | Scope                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `USER`                      | Own data. Granted automatically to every new profile.                                            |
| `MANAGER`                   | Read-only access to assigned, active users (`manager_user_assignments`).                         |
| `ADMIN`                     | Operational read/write across users. Can grant only `MANAGER`/`USER`. Cannot touch super admins. |
| `SUPER_ADMIN`               | Everything, including admins and all settings. The last active super admin cannot be removed.    |
| Group `MEMBER/LEADER/ADMIN` | Per-group role in `group_memberships.role`. Not a global role.                                   |

A user can hold several global roles. Deactivated users (`profiles.is_active = false`)
lose all access, including to their own data, and are excluded from managers' and
groups' views.

## Row Level Security

RLS is enabled on every `public` table, and `anon` has no privileges at all. Policies
call `SECURITY DEFINER` helpers in the `private` schema, which the Data API doesn't
expose:

`is_active_user()`, `has_role()`, `is_admin()`, `is_super_admin()`, `current_app_role()`,
`is_manager_of(user)`, `user_has_role(user, role)`, `user_local_date(user)`,
`is_group_member(group)`, `is_group_admin(group)`, `feedback_window_open(user, month)`.

- Helpers read role and membership tables as the function owner, so a policy never
  re-enters another table's RLS. This avoids recursion. Each pins `search_path = ''`.
  Most answer only about the calling user. `user_has_role` and `user_local_date` take a
  user id, but they are reachable only from policies and triggers, because `private`
  isn't exposed through the Data API.
- Policies wrap caller-only helpers in `(select …)` so each is evaluated once per
  statement.
- Access tiers per user-owned table:
  - own rows: active user
  - all rows: admin
  - assigned users: manager (read-only)
- Tables that only the server writes (AI processing, cycles, target snapshots, food
  versions, audit) have no client INSERT/UPDATE privilege at all.
- Clients can't hard-delete. The only client `DELETE` grants are user roles, manager
  assignments, and focuses of a goal not yet used by a cycle.
- Raw AI input/output (`recommendation_processing_users`) is visible to admins only.

### Group visibility

Group members **never** read each other's tables directly. They call
`public.get_group_member_day(group_id, date)`, which returns only:

- name and group role
- calories and protein against the member's own target
- steps
- whether a workout was logged

Weight, body fat, InBody and calculation inputs are never returned. The function only
answers for current members of an active group, only about current active members, and
only for dates on or after the day the viewed member joined. When someone leaves or is
removed, their data disappears from the group. Rejoining creates a new membership row,
so data from before they left stays hidden.

### Service-role boundary

The service role bypasses RLS. It exists only in trusted server code (Edge Functions:
user creation, PIN reset, recommendation processing, InBody extraction, admin
corrections) and must **never** reach the browser or a `VITE_` variable. Server code
acting for an admin sets `set_config('app.actor_id', <admin id>, true)` so audit rows name
the real actor. A JWT user can't override `app.actor_id`.

## Historical integrity

### Daily target snapshots

`daily_target_snapshots` holds the calorie, macro and workout target, plus the tolerances,
that applied on each date. It's unique on `(user_id, target_date)` and linked to the cycle
that produced it. Adherence for a date must use that date's snapshot, never today's
target, so changing a setting or a cycle never rewrites past results. The server writes
snapshots when a cycle is generated or its targets change. Creating them is part of the
recommendation phase.

### Meal nutrition snapshots

Each `meal_items` row stores the nutrition values that applied when it was logged
(`snapshot_*`, `food_name_snapshot`):

- On insert, a trigger computes them from the food source and ignores any values the
  client sends.
- A quantity change rescales the captured snapshot. It never re-reads the master, which
  may have changed since.
- Only admins can set snapshot values directly.
- Changing, versioning (`food_item_versions`) or merging a food never changes logged
  meals.

### Recommendation cycles

- A cycle runs from the actual generation date (`period_start`) to the day before the
  next generation (`period_end`, inclusive; null while current).
- `processing_month` is only a label. Cycles can't overlap (exclusion constraint), and
  `review_deadline = period_start + 1`, which gives a two-calendar-day review window.
- AI originals (`recommended_*`, `parsed_output_json`) are immutable. User edits go to
  `final_*` and `workout_plan_json`, and every change is audited with the old value, new
  value, actor and time.
- The goal (`goal_id`) and capacity (`workout_days_per_week`) are locked per cycle:
  - A goal used by a cycle can't be edited, and its focuses can't change.
  - Changing goals means creating a new goal version, which applies to the next cycle.
- Reprocessing marks the old cycle `REPLACED`. Every processing attempt keeps its own row
  with tokens, cost, model and prompt version.

### Locking

The rule (spec §66) is enforced by `private.guard_user_record()` on meals, meal items,
workouts, activities, steps and weight. For a normal user, evaluated in their timezone:

- records can only be created for today, except a new meal, workout or activity for a missing
  past day (up to 90 days back) created through `log_meal` / `log_workout` / `log_activity` —
  see [`food.md`](./food.md#late-entry-missing-historical-food);
- a record is editable only while its date is today and it isn't explicitly locked;
- the record date can't be moved, and lock flags can't be touched;
- soft-deleted records can't be restored.

Admins and trusted server code bypass the lock. Their changes are audited, and a change to
a locked record is logged as `ADMIN_CORRECTION`. The `is_locked` flag supports explicit
locking (for example, by a nightly job) but isn't required for enforcement.

### Soft deletion

User records use `is_deleted`, `deleted_at`, `deleted_by` and `delete_reason`, with the
stamps set by trigger. Profiles use `is_active`, `deleted_at` and `deactivated_by`, and
groups use `is_active`. Normal queries go through the `security_invoker` views, which drop
deleted rows:

`active_meals`, `active_meal_items`, `active_workouts`, `active_activities`,
`active_weight_measurements`, `daily_steps` (active step value per day),
`current_weights` (latest valid weight; InBody wins on the same date),
`profile_readiness` (whether the mandatory profile fields are complete).

Deleted rows stay in the base tables for admin inspection.

### Audit log

`audit_logs` is append-only. Triggers block UPDATE, DELETE and TRUNCATE for everyone,
including the owner, and clients have SELECT only (admins). Rows are written by
`private.audit_row_change()`:

- **Always audited:** role changes, manager assignments, settings, cycle edits, food
  master changes and merges.
- **Audited when someone other than the owner acts:** admin corrections, deletions,
  deactivation, group removals, and so on.

For updates, only the changed columns are stored. Callers can attach a reason with
`set_config('app.audit_reason', '…', true)`.

## Decisions not specified by the spec

- **Profile id = auth user id.** The spec lists `id` and `auth_user_id` separately. They
  are merged, which keeps RLS simple (`user_id = auth.uid()`).
- **Age is derived from `date_of_birth`.** Current weight comes from `weight_measurements`,
  and profile completeness from the `profile_readiness` view. None of these is stored on
  the profile.
- **The objective lives in `goals.description`**, not on the profile, so it's versioned
  with the goal.
- **Gender** values are `MALE`, `FEMALE`, `OTHER`, `PREFER_NOT_TO_SAY`. The spec names the
  field but not its values; this set is a product decision. `PREFER_NOT_TO_SAY` is a
  provided answer, so it satisfies the gender requirement in `profile_readiness`.
- **Timezone:** `profiles.timezone` (IANA name, default `Asia/Kolkata`). All calendar-day
  rules (today, locking, feedback month) use it. Mon–Sun weeks are computed per user date.
- **Lock rule applies to steps and weight too** (spec §66 wording). So entries can't be
  back-dated by users. InBody reports can carry past dates.
- **Users may log their own pending food submission** in a meal. It stays private, and it
  only joins the shared database after admin approval.
- **Raw AI I/O lives on the processing attempt, not the cycle.** The cycle references it,
  to avoid duplicate copies. The same applies to review and lock fields.
- **Group history visibility:** members see data only from the viewed member's join date
  onward. The spec says a Group Leader may have "limited historical access", but that
  isn't defined yet, so for now LEADER has no extra access.
- **Group creators** can always read their group row. This is needed for
  `INSERT … RETURNING`. It exposes the group's name and code only, never member data.
- **`ai_monthly_budget`** defaults to null (not configured), so processing can't start
  until an admin sets a budget.

## Authentication tables and functions

Added in the authentication phase. See [`docs/auth.md`](./auth.md).

- `private.user_pins` holds bcrypt PIN hashes, and `private.login_attempts` tracks
  per-phone lockout. Neither is reachable through the Data API.
- `auth_verify_pin` and `auth_set_pin` can be called by the service role only.
  `auth_set_pin` writes a `CREATE` or `PIN_RESET` audit row with no PIN material.
- `save_onboarding_measurements` runs as the caller, so RLS and the record guards apply.
  It sets the height and records the initial weight as today's `MANUAL` measurement.
  Repeat calls update that row instead of adding another.

## Not yet in the database (later phases)

- Supabase Storage bucket and policies for InBody files.
- Admin-facing Edge Functions for user creation and PIN reset. The same steps exist today
  in `scripts/lib/provision-user.ts`.
- Server-side functions for joining a group by code, recommendation review and accept,
  and nightly locking.
- The analytics aggregation functions.
