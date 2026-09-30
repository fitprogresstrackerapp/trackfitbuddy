# Admin management, corrections and audit

Covers the admin area (`/admin`, `/admin/users`, `/admin/users/:userId`,
`/admin/audit`), manager access, domain-specific data corrections, account
activation, PIN reset, and the audit log. Migration:
`supabase/migrations/20261007000100_admin_management.sql`.

## Architecture

```
Browser (React)                       Database (Postgres, SECURITY DEFINER)
  admin-data.ts ── rpc ─────────────▶ admin_list_users / admin_user_account /
                                      admin_audit_log / admin_dashboard /
                                      admin_daily_nutrition / admin_correct_* /
                                      admin_delete_record / admin_set_user_active
               ── RLS reads ────────▶ meals, meal_items, workouts, … (existing policies)
               ── functions.invoke ─▶ Edge Function admin-users
                                        create_user → provisionUser (service role)
                                        reset_pin   → admin_reset_pin → auth_set_pin (bcrypt)
```

- **Every rule is enforced on the server.** The UI hides actions the server would
  refuse, and only because the server tells it to: `admin_user_account` returns
  `can_administer`. Route guards (`RequireRole`) only shape navigation.
- **Readers:**
  - `admin_list_users` does search, filters and pagination server-side and returns
    `total_count` on each row.
  - `admin_user_account` returns account and profile fields, missing fields,
    recommendation status, last activity and `can_administer`.
  - A day's records, body history and recommendation cycles are read through the
    existing RLS policies. Admins see everyone; managers see only assigned users.
  - Daily nutrition totals come from `admin_daily_nutrition`, which uses the same
    computation as Progress.
- **No generic editor.** Each correction is its own function with typed, validated
  parameters (see below).
- **Caching:** TanStack Query keys live under `['admin', …]`. A mutation invalidates only
  the lists, the affected user and the audit. A correction also invalidates that user's
  records, and never touches other users' caches.

## Roles and authority

| Actor       | View                           | Create user          | PIN reset / activate / correct             |
| ----------- | ------------------------------ | -------------------- | ------------------------------------------ |
| SUPER_ADMIN | all users                      | USER, MANAGER, ADMIN | any active account except themselves       |
| ADMIN       | all users                      | USER, MANAGER        | USER and MANAGER accounts (not themselves) |
| MANAGER     | assigned users only, read-only | —                    | —                                          |
| USER        | —                              | —                    | —                                          |

- Authority is centralized in `private.can_administer_as(actor, target)`: the actor must
  be active and must not be the target. A SUPER_ADMIN may act on anyone; an ADMIN may act
  on any target that is neither ADMIN nor SUPER_ADMIN.
- Every correction, `admin_set_user_active` and `admin_reset_pin` calls it. So does the
  account-page flag.
- **Nobody can create a SUPER_ADMIN.** `admin_can_create_role` only allows ADMIN for a
  super admin, and the function's input schema rejects SUPER_ADMIN outright. Super admins
  are provisioned from the command line.
- **Role management is minimal.** A role is chosen at creation only, and there is no
  role-editing UI. The existing `user_roles` trigger already protects the last
  SUPER_ADMIN role and self role changes.
- **Self-protection:** no admin can deactivate themselves or reset their own PIN here
  (they sign in normally). The last active SUPER_ADMIN cannot be deactivated. This check
  is defense in depth, since only another active super admin could try.

## Manager scope

A manager's scope is the `manager_user_assignments` table, checked in the database by
`is_manager_of(user)`.

- **List and search:** `admin_list_users` filters to assigned users before searching and
  paging, so the total count only counts assigned users.
- **Direct URL:** `admin_user_account` refuses an unassigned user with 42501. The page
  shows "This user isn't available", without saying whether the account exists.
- **Record queries:** these use the existing RLS policies (`is_manager_of`). Changing the
  user ID or date in the URL cannot widen what a manager can read.
- **Changes:** managers cannot correct records, change account status or reset PINs.
  Every function refuses them with 42501, and the Edge Function returns 403.
- **Audit and dashboard** are admin only. Managers cannot open them, the navigation
  doesn't offer them, and the functions refuse them.

Assigning managers still happens outside the UI (a database insert). The admin nav
entry "Managers" remains a placeholder.

## Account creation

`POST /functions/v1/admin-users {action: "create_user", phone, pin, role}`

1. The actor comes from the caller's JWT (`auth.getUser`). The actor must be an active
   ADMIN or SUPER_ADMIN; otherwise the function returns 403.
2. The input is validated with a strict Zod schema: phone `+91[6-9]XXXXXXXXX`, PIN
   `^\d{4}$`, role `USER|MANAGER|ADMIN`. Unknown keys such as `actor_id` are rejected
   with 400.
3. `admin_can_create_role(actor, role)` must allow the role (else 403).
4. A duplicate phone returns 409 `PHONE_TAKEN`.
5. `provisionUser` creates the auth user and profile, sets the roles and hashes the PIN
   with bcrypt via `auth_set_pin`. The audit row is a `CREATE` whose actor is the admin.
   The response is `{user_id}` only.

## PIN reset

`POST /functions/v1/admin-users {action: "reset_pin", user_id, pin, reason?}`

The Edge Function calls `admin_reset_pin(actor, user, pin, reason)`, which is callable by
the service role only. It checks `can_administer_as` and sets the audit actor and reason
for the transaction. It then calls `auth_set_pin`, which hashes with bcrypt in the
database and clears the lockout.

The audit row is `PIN_RESET` on `user_pins`, with null old and new values. PIN material
never appears in:

- a response;
- a URL;
- a log line;
- the audit log (`admin_audit_log` also strips any `pin_hash` key).

The existing PIN is never shown, and the UI's PIN field is masked.

## Activation

`admin_set_user_active(user, active, reason)` is a soft change on `profiles.is_active`.
Deactivation also records `deleted_at` (deactivation time) and `deactivated_by`, and nothing is deleted.

- A deactivated user is refused at PIN login (`ACCOUNT_DISABLED`).
- Their open session loses access at once, because RLS helpers require an active
  profile.
- Reactivation restores access to all their data.

The audit shows these changes as "Deactivated" and "Activated": `DELETE` and `RESTORE`
on `profiles`, which is how the existing trigger classifies them.

## Correction model

Each correction is audited with the original value, the corrected value, the actor, the
time and the reason. How the original is preserved depends on the change:

- **Food change:** the old meal item is soft-deleted and a new item is added.
- **Deletion:** the record is soft-deleted and stays in the database.
- **Any other correction:** the active row is updated in place, and the audit log keeps
  the original values.

| Function                       | Corrects                                                         | Derived values that follow                                                 |
| ------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `admin_correct_meal_item`      | quantity, or food (replacement item)                             | nutrition snapshot rescales / re-snapshots from the food's current version |
| `admin_correct_meal`           | meal category                                                    | —                                                                          |
| `admin_correct_training`       | workout/activity type, name, duration, manual calories           | estimated calories re-estimated by the existing trigger                    |
| `admin_correct_steps`          | steps                                                            | —                                                                          |
| `admin_correct_weight`         | MANUAL weight                                                    | — (InBody weights are corrected via the metrics)                           |
| `admin_correct_inbody_metrics` | weight, body fat %, muscle, BMI, BMR                             | the InBody weight entry in weight history syncs                            |
| `admin_correct_profile`        | name, date of birth, gender, height, activity level, capacity    | completeness is recomputed on read                                         |
| `admin_delete_record`          | soft delete of meal, meal item, workout, activity, steps, weight | excluded from analytics                                                    |

Every correction function works the same way:

1. **Authority:** `private.begin_admin_action(user, reason)` checks `can_administer`,
   then sets `app.audit_reason` and `app.audit_action = 'ADMIN_CORRECTION'` for the
   transaction.
2. **Concurrency:** the row is locked (`FOR UPDATE`) and its `updated_at` is compared
   with the version the admin opened. A mismatch raises 40001 ("This record changed since
   you opened it"), and nothing is written.
3. **Validation:** values are checked against the same ranges and constraints as the
   user-facing flows and CHECK constraints. A correction that changes nothing is refused.
4. **Audit:** the existing row trigger writes the audit entry. The migration's override
   makes the action `ADMIN_CORRECTION`, including for unlocked or current-day rows. The
   old and new values hold only the changed columns.

Some things deliberately do not change:

- **Locks:** the user's lock is untouched. `is_locked` stays true, and the user still
  cannot edit the record: the record guard raises 42501 for non-admins. Nothing grants
  users new update rights.
- **Targets and snapshots:** recommendation cycles and daily target snapshots are never
  rewritten. A meal item's nutrition snapshot follows its quantity, because that snapshot
  _is_ the logged record; the food master is unchanged.
- **Analytics** read the active rows, so they use the corrected values immediately: the
  home and progress pages, `daily_nutrition`, groups and the recommendation inputs.

**UI.** The correction dialog shows the original values, then the corrected fields and
an optional reason. "Review correction" lists each change as original → corrected.
Nothing is sent until "Apply correction". Corrected records carry a small "Admin
correction" label. Destructive actions (delete, deactivate) need a confirmation dialog
with a reason.

## Audit

- **Actor:** `audit_logs.actor_id` is always derived on the server
  (`private.current_actor_id()`, i.e. `auth.uid()`). An `app.actor_id` setting is
  ignored when a JWT user is present, so a client cannot claim to be someone else.
  Service-role paths such as the PIN reset set the actor only after verifying the
  caller's JWT in the Edge Function.
- **Append-only:** clients hold SELECT only, and triggers block UPDATE, DELETE and
  TRUNCATE for everyone.
- **Reading:** `admin_audit_log` is admin only. It supports these filters: date range in
  the viewer's timezone, action, entity (domain), actor name, target name and target
  user. It pages with a total count and resolves actor and target names. Any `pin_hash`
  key is removed from the old and new values.
- **UI:** `/admin/audit` shows filters, a paginated list, and a detail dialog with each
  field's original and corrected value, the reason, the actor and the time. Bookkeeping
  columns (`updated_at`, and similar) are hidden. The user page shows that user's latest
  entries.

## Dashboard

`admin_dashboard()` returns counts that are already computed elsewhere:

- active and inactive users;
- incomplete profiles;
- recommendations in review, pending and failed;
- active groups;
- pending food submissions;
- this month's AI spend and budget.

The dashboard also shows the six most recent audit entries.

## Tests

- `supabase/tests/database/10_admin.test.sql`: authority rules, manager scope,
  corrections for each domain, stale versions, audit integrity, activation, PIN reset,
  and the role matrix.
- `tests/integration/admin.test.ts`: the full lifecycle through the Edge Function and
  the app's data functions on the local stack.
- `src/features/admin/**/*.test.ts(x)`: display rules, schemas and pages.
