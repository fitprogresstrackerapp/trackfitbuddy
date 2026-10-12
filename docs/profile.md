# Profile

The Profile page (`/profile`) keeps separate kinds of data apart:

- **Profile:** describes the user.
- **Goals:** what they want to achieve.
- **Body measurements and steps:** what was observed.
- **Current plan:** the recommendation in force.

Each section edits only its own data. Onboarding remains first-time setup only, and Profile
never sends the user back to it. Code lives in `src/features/profile`.

## Profile fields

| Field            | Required | Stored as                              | Notes                                                                                         |
| ---------------- | -------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Name             | yes      | `profiles.name`                        | 1–100 characters                                                                              |
| Date of birth    | yes      | `profiles.date_of_birth`               | Age is **derived** (today in the profile timezone), never stored; onboarding age range 13–100 |
| Gender           | yes      | `profiles.gender`                      | Male, Female, Other, Prefer not to say                                                        |
| Height           | yes      | `profiles.height_cm`                   | Metric only, 100–250 cm (onboarding bounds)                                                   |
| Current weight   | yes      | latest valid `weight_measurements` row | Not a profile column; see Weight                                                              |
| Activity level   | no       | `profiles.activity_level`              | Sedentary … Extremely active; context for the next recommendation                             |
| Job              | no       | `profiles.job`                         | Free text ≤ 200                                                                               |
| Hobbies / sports | no       | `profiles.hobbies`                     | Free text ≤ 500; never creates activity records                                               |

- **Completeness:** stays exactly the onboarding rule (the `profile_readiness` view): name,
  date of birth, gender, height and a current weight. Optional fields never block access.
- **Header status:** the page shows Profile complete / incomplete. When incomplete, it names
  the missing fields ("2 required fields remaining").
- **Shared validation:** Personal edits reuse the onboarding form and schema (one set of
  rules). Height reuses the onboarding bounds.
- **After a personal or height change:** the account is reloaded, so Home's greeting
  updates at once.

## Goals and workout capacity (next cycle)

Goals and capacity are **recommendation inputs**. A recommendation cycle keeps the goal
(`recommendation_cycles.goal_id`, locked by trigger) and capacity (`workout_days_per_week`)
it was created with. Edits on Profile therefore apply to the **next** recommendation.

- **Goals:** `set_goal(long_term_goal, focuses[], objective)` (runs as the user).
  - If the active goal is not used by any cycle, it is edited in place and its focuses are
    replaced.
  - If a cycle uses it, that version is closed (`is_active = false`,
    `effective_to = today`) and a new version starts today. The cycle keeps pointing at the
    old, unchanged goal.
- **Short-term focuses:** any of the seven spec values, each at most once, in the order
  chosen (priority).
- **Objective:** the user's own text, at most 2,000 characters, stored as written.
- **Workout capacity:** a 2–6 preference in `profiles.workout_days_per_week`. The current
  cycle's capacity, and so weekly adherence in Home, Workout and Progress, is never
  changed by it.

## Weight

- **History:** measurements are history (spec §20). "Update weight" calls
  `log_weight(date, kg)`, which adds a **new** MANUAL measurement. Several per day are
  kept.
- **Current weight:** the existing `current_weights` rule: the latest date, InBody over
  manual on the same date, else the latest entry. Manual history is never overwritten or
  deleted because an InBody result exists.
- **Editing:** today's own manual measurements can be corrected or deleted. Past ones
  are locked by the record guard.
- **Date rules:** future dates are rejected. A **missing past day** (up to 90 days back)
  can be added through the same late-entry grant as Food and Workout, and is locked once
  saved.
- **Last measurement:** the delete button is disabled when a measurement is the only one,
  since a current weight is required.
- **History list:** the most recent 10 measurements, with the current one marked. Trends
  live in Progress.

## Steps

- **Entries:** `log_steps(date, steps)` adds an entry (0–200,000). The newest valid entry
  becomes the day's **active** value (existing trigger); earlier entries stay as history.
  Entries are **never summed**: 4,000 then 8,420 means 8,420.
- **Today's entries:** can be deleted. Deleting the active one re-activates the previous
  entry.
- **Past days:** a past day without an entry can be filled once (late entry, 90 days, then
  locked). A past day that already has an entry is locked, because a new entry would
  change the locked one's active flag.
- **Display:** Profile shows today's value, today's entries, and the last 7 days. A day
  without an entry is `—`.
- **No step goal:** none exists in Phase 1, so none is shown.
- **Separate:** steps are not activities or workouts.
- **Other pages:** Home and Progress read the active value (`daily_steps`) and are
  refreshed after changes.

## InBody

- **Upload:** users upload the original report (PDF or image, at most 10 MB) to the
  private Storage bucket `inbody-reports`, under their own folder `{user_id}/…`.
  - Storage policies allow users to write and read only their own folder; admins can read
    all.
  - A trigger requires a user's `inbody_reports.file_path` to be in their own folder and
    the report date not to be in the future.
  - **No orphaned files:** the date, file type and size are checked before anything is
    uploaded. If recording the report still fails, the file just uploaded is removed
    again. Storage lets a user delete only a file in their own folder that no report
    row references, so a file that belongs to a report can't be deleted by its owner.
- **Nothing is read from the report file:** there is no OCR and no AI extraction of a
  PDF or image. A new report shows "Awaiting results" until its results are imported
  from the InBody CSV (below) or entered by an admin. Only stored metrics are shown
  (weight, body fat, muscle mass, BMI, BMR).
- **InBody weight:** the database writes it into weight history (source INBODY) via the
  existing trigger.
- **History:** users cannot edit or delete reports or stored results. A new upload is
  always a new record.
- **Local stack:** `npm run supabase:start` now includes the Storage API.

### InBody CSV import

A user can import the CSV that the InBody app exports ("Import CSV" in the InBody
section, or "Import CSV results" on a report awaiting results). The uploaded PDF or
image is unchanged; the CSV is an additional way to add the results.

**Flow:** choose the file → the server parses and validates it → the values are shown
for review → the user confirms → the result is stored → InBody, weight and Progress
refresh. Nothing is stored before the confirmation.

- **Server-side parsing:** the Edge Function `inbody-import` parses the CSV with a
  deterministic parser (`src/features/profile/lib/inbody-csv.ts`, shared with the unit
  tests). No AI model reads the file. The browser only checks the extension, the size
  and that the file is text, then sends the text.
- **The browser never submits values:** saving sends the same file again with the
  chosen measurement's timestamp, and the server reads the values from the file. A
  browser cannot write `inbody_metrics` (RLS: admin only) and cannot call the save
  function (`import_inbody_metrics`, service role only).
- **Supported format:** the InBody app export. Comma-separated, UTF-8 (a byte-order
  mark is fine), one header row, one row per measurement. Columns are found by header
  name, not by position. The date is 14 digits (`yyyymmddhhmmss`, device time, no
  timezone conversion). `-` or an empty cell means "not measured" and is stored as
  null, never as zero. Values must be plain decimals with a dot.
- **Refused, never guessed:** another delimiter, weights in a unit other than kg, a
  repeated column, a missing required column, an unreadable date, a non-numeric or
  out-of-range value, two rows with the same timestamp, more than 500 rows or 256 KB.
  One invalid row refuses the whole file.
- **Stored in the existing model** (`inbody_metrics`, one result per report):

  | CSV column                   | Stored as                 |
  | ---------------------------- | ------------------------- |
  | `Weight(kg)`                 | `weight_kg`               |
  | `Percent Body Fat(%)`        | `body_fat_percent`        |
  | `Skeletal Muscle Mass(kg)`   | `muscle_mass_kg`          |
  | `BMI(kg/m²)`                 | `bmi`                     |
  | `Basal Metabolic Rate(kcal)` | `bmr_kcal` (whole number) |

  The ranges are those of the table's constraints. At least one of weight, body fat
  and muscle mass is required. Some further whole-body values (body fat mass, soft
  lean mass, total body water, protein, mineral, visceral fat level and area,
  waist–hip ratio, SMI, InBody score) are kept in `other_metrics_json` as
  `{source: "inbody_csv", measured_at, device, metrics: {<key>: {label, value, unit}}}`.
  Segmental values are not stored.

- **Which report the result belongs to:**
  - a report awaiting results with the **same date** → the result is added to it;
  - a report awaiting results dated **one day off** → offered, and the user chooses
    between that report and a separate record; the report then takes the measurement's
    date;
  - **no matching report** → the CSV becomes a report record of its own. It is never
    attached to a report of another date or to another user's report;
  - started from a specific report whose date doesn't match → refused ("This CSV does
    not match the selected report").
- **Re-import:** existing results are never overwritten. A report that has results, or
  a date that already has a result, is refused with an explanation. Corrections stay
  with admins (Admin → Users → the user → InBody → Admin correction).
- **A CSV with several measurements:** the user picks one; one measurement is saved
  per import.
- **Is the CSV stored?** Only when it becomes a record of its own: it is then that
  record's file, in the user's private folder (`text/csv` is allowed for this). When
  the result is added to an uploaded report, the CSV is discarded with the request.
- **Afterwards:** the report is `COMPLETED`, the existing trigger adds the weight to
  weight history (source INBODY), and the result is part of the next AI
  recommendation input (see [recommendations.md](./recommendations.md)).
- **Privacy:** a user imports only into their own account; managers and group members
  gain nothing. The function logs neither the CSV nor any value.

## Current plan and recommendation review

- **Current plan:** the recommendation covering today, never a replaced one. Without one,
  it shows "No current recommendation" (Home: "No recommendation available"); nothing is
  invented. Otherwise the section shows:
  - status (No recommendation / In review until … / Active) and cycle dates;
  - **final** targets beside the **recommended** (AI) values, with an _Edited_ marker;
  - the workout template, the cycle's focus and the recommendation summary.
- **Review window:** the generation day (`period_start`) and the next calendar day
  (`review_deadline`), in the user's timezone. After that, a recommendation still marked
  `IN_REVIEW` is treated as locked. Processing states are never shown to users.
- **During review**, the user can:
  - edit the final calories, protein, carbs, fat and fiber (`review_recommendation`);
  - rename the template's sessions, keeping the same number (capacity is locked);
  - accept & lock (`accept_recommendation`).

  Goals, capacity and the AI originals (`recommended_*`, `parsed_output_json`) cannot be
  edited.

- **Server-side checks:** both functions verify the owner, active account, `IN_REVIEW`
  status and the window, and reject anything else. Direct table edits are not permitted
  for users.
- **History:** every change is written to the audit log (old value, new value, actor,
  time) by the existing trigger. Target snapshots for today onward follow the final
  targets, while earlier snapshots keep theirs, so historical adherence is not rewritten.
- **Warning shown:** "Recommended target — change only if advised by your nutritionist or
  coach."

## Monthly check-in and history

- **Monthly check-in** (spec §31): one optional free-text field, "How did this cycle
  feel?" (at most 2,000 characters). It is saved as this month's
  `recommendation_feedback` row.
  - **Window:** from the 1st of the month until that month's recommendation is generated
    (user timezone). The database enforces it with RLS and a guard trigger, and it is
    also closed while the recommendation is being generated.
  - **After processing:** the text that was used is shown read-only ("Your October
    check-in was used…"). If this month was processed without a check-in, the section
    says when the next one opens. Earlier months are kept, never overwritten.
- **Recommendation history:** generation dates labelled In review / Active / Previous.
  Replaced recommendations and processing details (AI input, tokens, errors) are never
  shown to users.
- **Generation:** recommendations are generated by admins (see
  [`docs/recommendations.md`](./recommendations.md)). A new one starts in the existing
  review window.

## Data refresh

- **Queries:** under `['profile', userId, …]`. Mutations wait for the server (nothing is
  optimistic), then invalidate only what they affect:
  - personal and height → account, Home;
  - weight → weights, account readiness, Progress;
  - steps → steps, Home, Progress;
  - InBody upload → InBody, weights, Progress;
  - InBody CSV import → InBody, weights, account readiness, Home, Progress;
  - goals → plan, Progress;
  - review → plan, Home, Progress, training plan, Food targets, recommendation history;
  - check-in → this month's check-in.
- **Access:** all reads and writes run as the user, so RLS is the boundary.

## Not in this phase

Reading results from an InBody PDF or image (OCR), PIN change, admin user and group management, and step goals or
integrations. AI recommendation generation and monthly feedback now exist (Prompt 10).
