# MVP release status

The release boundary of the TrackFitBuddy MVP: what is ready, what is switched off on
purpose, what is limited, and what is future work. It is judged against `spec.md`.
Operating instructions are in [`deployment.md`](./deployment.md).

Status words used below:

- **PASS**: works as specified and is covered by automated tests.
- **PASS (limited)**: usable, with the limitation stated.
- **NOT BUILT**: in the specification, not in this release.

## Ready to use

Sign-in, onboarding, Home, Food logging, Workout and Activity logging, Steps, Weight,
Progress, Profile and goals, Groups, and the admin tools for users, corrections and
audit. All of it is enforced on the server (row-level security and server functions),
not only in the screens.

## AI recommendations

Enabled on 12 Oct 2026 with Claude Haiku 5.5 (`claude-haiku-5-5`) and a deliberately
small monthly budget of ₹84 (about USD 1). One test user was processed live: success on
the first request, at an estimated cost of ₹0.09. Processing stays manual: an admin
starts it, for selected users or for all ready users, and it stops at the budget.

A user without a recommendation sees "No recommendation available"; Home and Progress
show no targets, and nothing is invented. Configuration, cost and how to change the
model or the budget: [deployment.md → AI configuration](./deployment.md#ai-configuration).

## Feature status

### Authentication

| Item                        | Status    | Notes                                                  |
| --------------------------- | --------- | ------------------------------------------------------ |
| Phone + 4-digit PIN login   | PASS      | PIN is hashed with bcrypt on the server                |
| Unknown phone / wrong PIN   | PASS      | Same answer for both; no account enumeration           |
| Lockout                     | PASS      | 5 failures in 15 minutes lock the phone for 15 minutes |
| Logout, session persistence | PASS      | Logout clears all cached data                          |
| Deactivated account         | PASS      | Refused at login; an open session ends within minutes  |
| Onboarding enforcement      | PASS      | No page is reachable until the profile is complete     |
| Admin authentication        | PASS      | Same login; admin authority is checked on the server   |
| User changes their own PIN  | NOT BUILT | Optional in the spec (§5); an admin resets PINs        |

### Onboarding

| Item                                 | Status | Notes                                          |
| ------------------------------------ | ------ | ---------------------------------------------- |
| Required fields and validation       | PASS   | Name, date of birth, gender, height, weight    |
| Step persistence, refresh and resume | PASS   | Each step is saved; a refresh resumes          |
| Initial weight history               | PASS   | The onboarding weight is the first measurement |
| Incomplete-profile routing           | PASS   |                                                |

### Home

| Item                                     | Status | Notes                                        |
| ---------------------------------------- | ------ | -------------------------------------------- |
| Calories, macros, fiber against targets  | PASS   | Targets come from the day's snapshot         |
| Workout, steps, goals, the three actions | PASS   |                                              |
| No fabricated values                     | PASS   | Missing data is shown as "—", never as zero  |
| Behaviour without a recommendation       | PASS   | "No active recommendation"; no targets shown |

### Food

| Item                                           | Status    | Notes                                                                                    |
| ---------------------------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| Search, recent and frequent                    | PASS      |                                                                                          |
| Quantity, meal creation, editing, copy, delete | PASS      | A copy is an independent record                                                          |
| Nutrition snapshots                            | PASS      | Logged meals never change when a food changes                                            |
| Date locking and late entry                    | PASS      | Editable today; locked after; late entry up to 90 days, created locked                   |
| Target adherence                               | PASS      | Eligible tracked days only                                                               |
| Custom food, pending review                    | PASS      | Usable by its creator at once; shared after an admin approves it (one by one or in bulk) |
| Shared food database                           | PASS      | Admin → Food Database: add, edit, activate, deactivate, review                           |
| Duplicate detection (§11)                      | PASS      | Normalized names; one active food per name; likely duplicates shown to the admin         |
| Merging duplicate foods (§11)                  | NOT BUILT | The database supports merges; there is no screen                                         |

### Workout and activity

| Item                                               | Status | Notes                                    |
| -------------------------------------------------- | ------ | ---------------------------------------- |
| Capacity, Monday–Sunday week, workout-day counting | PASS   | Two workouts on one day count as one day |
| Logging, editing and deleting today's record       | PASS   |                                          |
| Past-day locking and late entry                    | PASS   |                                          |
| Calorie estimation and manual override             | PASS   | Shown as an estimate                     |
| Activities separate from workouts, no target       | PASS   |                                          |
| Recommendation guidance                            | PASS   | Guidance only; any workout type counts   |

### Progress

| Item                                               | Status | Notes                                         |
| -------------------------------------------------- | ------ | --------------------------------------------- |
| Ranges 7D, 30D, 3M, 6M, 1Y and their loading state | PASS   | A new range never shows the old range's data  |
| Body, nutrition, training, steps, goals            | PASS   |                                               |
| Missing data and no fabricated values              | PASS   | Gaps stay gaps                                |
| Cycle semantics                                    | PASS   | The real cycle period, not the calendar month |

### Profile

| Item                                      | Status         | Notes                                                                                               |
| ----------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| Personal data, lifestyle, goals, capacity | PASS           | Goal changes apply to the next cycle                                                                |
| Weight and steps                          | PASS           | History kept; the latest steps entry is the day's value                                             |
| InBody upload                             | PASS           | The file is stored privately; it is never read (no OCR)                                             |
| InBody CSV import                         | PASS (limited) | Results from the InBody app CSV, reviewed and confirmed by the user. Not yet deployed to production |
| Current recommendation, feedback          | PASS           | Shown once a recommendation exists                                                                  |
| Account, completeness                     | PASS           |                                                                                                     |

### Recommendations

| Item                                                   | Status    | Notes                                                 |
| ------------------------------------------------------ | --------- | ----------------------------------------------------- |
| Feedback window                                        | PASS      | From the 1st until processing, in the user's timezone |
| Processing, structured output, validation              | PASS      | Tested with the mock provider                         |
| Review window, editing allowed fields, accept and lock | PASS      | Two calendar days; the AI's original values are kept  |
| Failure isolation, retry, reprocess                    | PASS      | One failure never stops the others                    |
| Budget controls                                        | PASS      | Enforced on the server before every user              |
| Previous recommendation preserved                      | PASS      |                                                       |
| Real provider (Claude)                                 | PASS      | Claude Haiku 5.5; one live recommendation verified    |
| Automatic monthly processing                           | NOT BUILT | An admin starts processing by hand                    |
| Budget and settings screen                             | NOT BUILT | Set in the SQL editor (deployment.md)                 |

### Groups

| Item                                     | Status | Notes                                              |
| ---------------------------------------- | ------ | -------------------------------------------------- |
| Create, join by code, leave              | PASS   | One code per group                                 |
| Roles, admin replacement, member removal | PASS   | The only admin must appoint another before leaving |
| Shared progress                          | PASS   | Calories, protein, steps, workout status only      |
| History rules, former member access      | PASS   | A former member loses access at once               |

### Admin

| Item                                                 | Status         | Notes                                                       |
| ---------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| Dashboard                                            | PASS           |                                                             |
| User search, filters, pagination, details            | PASS           | Done on the server                                          |
| Create user, PIN reset, activate/deactivate          | PASS           |                                                             |
| Corrections with audit                               | PASS           | Original kept; stale saves are refused with a clear message |
| Audit log                                            | PASS           | Append-only                                                 |
| Manager restrictions                                 | PASS (limited) | Enforced in the database; assignments are made in SQL       |
| Super-admin protections                              | PASS           |                                                             |
| Food Database                                        | PASS           | Shared catalogue and review of user-created foods           |
| Managers, Groups, AI Usage, System Settings sections | NOT BUILT      | Placeholders in the admin navigation                        |

### PWA

| Item                                | Status     | Notes                                       |
| ----------------------------------- | ---------- | ------------------------------------------- |
| Manifest, icons, standalone, theme  | PASS       | Chrome reports the app installable          |
| Service worker, static caching only | PASS       | No Supabase or private data is ever cached  |
| Update on a new deployment          | PASS       | Offered with "Reload"; never forced         |
| Installed on a physical phone       | NOT TESTED | No device available to the test environment |

## Known limitations

- **No admin screens** for manager assignment, group management, AI usage or system
  settings. The operator uses the SQL statements in deployment.md.
- **Food values are approximate.** The starter catalogue is a reviewed list of typical
  values, not a nutrition database.
- **InBody results come from the InBody app's CSV export** (kg units, one measurement
  per import). A PDF or image report is stored but never read (no OCR), and the admin
  screens cannot open the file. A user without a CSV needs the operator to enter the
  values.
- **Duplicate foods cannot be merged in the app**; an admin deactivates one instead.
- **Foods have no category**: neither the specification nor the data model has one.
- **Recommendation processing is manual**, once a month, started by an admin.
- **Users cannot change their own PIN.**
- **Accounts are never deleted**, only deactivated (by design, spec §7).
- **No offline use**: the installed app opens offline but needs a connection for data.
- **Browser support**: tested on current Chromium, desktop and mobile sizes. Safari and
  Firefox are expected to work but were not tested.

## Future work

Not part of this release, and not required by the MVP definition of done: push
notifications, automatic background processing, health-platform and device
integrations, exercise-level workout tracking, step goals, gamification, public
registration, messaging, payments or subscriptions, AI chat, a social feed, and further
analytics.
