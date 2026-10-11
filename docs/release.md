# MVP release status

The release boundary of the TrackFitBuddy MVP: what is ready, what is switched off on
purpose, what is limited, and what is future work. It is judged against `spec.md`.
Operating instructions are in [`deployment.md`](./deployment.md).

Status words used below:

- **PASS**: works as specified and is covered by automated tests.
- **PASS (limited)**: usable, with the limitation stated.
- **NOT CONFIGURED**: built and tested, switched off until the operator configures it.
- **NOT BUILT**: in the specification, not in this release.

## Ready to use

Sign-in, onboarding, Home, Food logging, Workout and Activity logging, Steps, Weight,
Progress, Profile and goals, Groups, and the admin tools for users, corrections and
audit. All of it is enforced on the server (row-level security and server functions),
not only in the screens.

## Switched off on purpose

- **AI recommendations (NOT CONFIGURED).** The monthly recommendation engine, the Claude
  provider, budget control, review and locking are built and tested with a mock
  provider, and the real provider's request and response handling is verified without a
  paid call. Production has no provider key and no budget, so processing cannot start.
  Until it is enabled, users see "No recommendation available", Home and Progress show no
  targets, and nothing is invented. Enabling it:
  [deployment.md → Enabling AI recommendations](./deployment.md#enabling-ai-recommendations).

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

| Item                                           | Status         | Notes                                                                                  |
| ---------------------------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| Search, recent and frequent                    | PASS           |                                                                                        |
| Quantity, meal creation, editing, copy, delete | PASS           | A copy is an independent record                                                        |
| Nutrition snapshots                            | PASS           | Logged meals never change when a food changes                                          |
| Date locking and late entry                    | PASS           | Editable today; locked after; late entry up to 90 days, created locked                 |
| Target adherence                               | PASS           | Eligible tracked days only                                                             |
| Custom food, pending review                    | PASS (limited) | A user can create and use their own foods. No admin approval screen: they stay private |
| Shared food database                           | PASS (limited) | Loaded once by the operator from the starter catalogue; no admin screen to add or edit |
| Duplicate detection and merging (§11)          | NOT BUILT      | The database supports merges; there is no screen                                       |

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

| Item                                      | Status         | Notes                                                                            |
| ----------------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| Personal data, lifestyle, goals, capacity | PASS           | Goal changes apply to the next cycle                                             |
| Weight and steps                          | PASS           | History kept; the latest steps entry is the day's value                          |
| InBody upload                             | PASS (limited) | The file is stored privately. Results are entered by the operator, not extracted |
| Current recommendation, feedback          | PASS           | Shown once a recommendation exists                                               |
| Account, completeness                     | PASS           |                                                                                  |

### Recommendations

| Item                                                   | Status         | Notes                                                 |
| ------------------------------------------------------ | -------------- | ----------------------------------------------------- |
| Feedback window                                        | PASS           | From the 1st until processing, in the user's timezone |
| Processing, structured output, validation              | PASS           | Tested with the mock provider                         |
| Review window, editing allowed fields, accept and lock | PASS           | Two calendar days; the AI's original values are kept  |
| Failure isolation, retry, reprocess                    | PASS           | One failure never stops the others                    |
| Budget controls                                        | PASS           | Enforced on the server before every user              |
| Previous recommendation preserved                      | PASS           |                                                       |
| Real provider (Claude)                                 | NOT CONFIGURED | No key, no budget; no live request has been made      |
| Automatic monthly processing                           | NOT BUILT      | An admin starts processing by hand                    |
| Budget and settings screen                             | NOT BUILT      | Set in the SQL editor (deployment.md)                 |

### Groups

| Item                                     | Status | Notes                                              |
| ---------------------------------------- | ------ | -------------------------------------------------- |
| Create, join by code, leave              | PASS   | One code per group                                 |
| Roles, admin replacement, member removal | PASS   | The only admin must appoint another before leaving |
| Shared progress                          | PASS   | Calories, protein, steps, workout status only      |
| History rules, former member access      | PASS   | A former member loses access at once               |

### Admin

| Item                                                                | Status         | Notes                                                       |
| ------------------------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| Dashboard                                                           | PASS           |                                                             |
| User search, filters, pagination, details                           | PASS           | Done on the server                                          |
| Create user, PIN reset, activate/deactivate                         | PASS           |                                                             |
| Corrections with audit                                              | PASS           | Original kept; stale saves are refused with a clear message |
| Audit log                                                           | PASS           | Append-only                                                 |
| Manager restrictions                                                | PASS (limited) | Enforced in the database; assignments are made in SQL       |
| Super-admin protections                                             | PASS           |                                                             |
| Managers, Groups, Food Database, AI Usage, System Settings sections | NOT BUILT      | Placeholders in the admin navigation                        |

### PWA

| Item                                | Status     | Notes                                       |
| ----------------------------------- | ---------- | ------------------------------------------- |
| Manifest, icons, standalone, theme  | PASS       | Chrome reports the app installable          |
| Service worker, static caching only | PASS       | No Supabase or private data is ever cached  |
| Update on a new deployment          | PASS       | Offered with "Reload"; never forced         |
| Installed on a physical phone       | NOT TESTED | No device available to the test environment |

## Known limitations

- **No admin screens** for the food database, manager assignment, group management, AI
  usage or system settings. The operator uses the SQL statements in deployment.md.
- **Food values are approximate.** The starter catalogue is a reviewed list of typical
  values, not a nutrition database.
- **InBody results are entered by hand.** There is no extraction from the file, and the
  admin screens cannot open the file.
- **User-submitted foods stay private**; there is no approval or merge screen.
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
