# Workout & Activity

The Workout page (spec §14–18) shows the Monday–Sunday week's workout days against the
recommendation's **workout capacity**. It also shows the recommended template as
guidance, and lists the week's workouts and activities. Shared training code lives in
`src/features/training`. The page is `src/features/workout/pages/workout-page.tsx`, and
the type labels are in `features/workout/lib` and `features/activity/lib`.

## Workout capacity and adherence

- **Capacity** is the number of days per week the user can realistically work out
  (2–6). It is not a set of weekdays, fixed rest days, or a schedule. It comes from the
  recommendation in force for the viewed date: the date's target snapshot
  (`workouts_per_week`), else the covering cycle (`workout_days_per_week`).
  - No recommendation means no capacity. The page says so and never invents one.
- **Adherence** counts **distinct days** with at least one valid (non-deleted) workout in
  the **Monday–Sunday calendar week**, never a rolling 7 days, up to today.
  - Several workouts on one day count as one workout day. This keeps the Home definition
    from Prompt 5 and matches spec §17's day-by-day example.
  - **Any** workout type counts. The AI template never decides whether capacity was met,
    so four logged workouts of any types reach `4 / 4`.
  - Workouts logged before the recommendation began still count for that calendar week.
- **Partial week:** if the recommendation cycle starts after the week's Monday, the week
  is marked **Partial week**. Its count is shown, but it is not judged as a full week
  (no "sessions remaining").
- **Status:** `n sessions remaining` for the current week, `n of c completed` for a
  finished week, or **Capacity met** followed by "Additional activity is optional."
  There is no failure language and nothing celebratory.
- **No workouts:** a week with none shows `—` and "No workouts logged this week", never
  a fabricated 0 (spec §68).

The helpers `countWorkoutDays`, `isTransitionWeek`, `nextSession` and `parseWorkoutPlan`
are shared with Home (`features/training/lib/training.ts`), so there is one
implementation.

## Guidance

- **Source:** the recommendation's `workout_plan_json.sessions` (names, with an optional
  `duration_minutes` and `focus`), shown as the weekly template.
- **Next guidance:** for the current week this is the next session in template order.
  It is chosen by the number of workout days done, not by matching types. It is labelled
  as guidance ("Suggestions only").
- **When capacity is met:** "Weekly capacity met" replaces the suggestion; no further
  workout is pushed.
- **No recommendation:** "No workout guidance", with no plan invented.

## Workout vs activity

- **Workouts** use the spec §14 types (Chest … Athletic / Performance, Custom).
- **Activities** use the spec §18 types (Walking … Hiking / Trekking, Custom).
- **Separate:** each has its own table, list, form and icon (lucide `Dumbbell` for
  workouts, `Activity` for activities). An activity never counts toward workout
  capacity.
- **No activity target:** there is no frequency target in Phase 1, so nothing is ever
  met, missed or on track. The week shows session count, time and calories only.
- **Names:** any type can carry an optional name ("Push Strength"). A name is required
  for Custom. Lists show the name, with the type beside it.

## Calories

- **Estimate:** the database computes and stores it at log time as
  `round(duration × rate, 1)` (trigger `estimate_training_calories`).
  - The client never sends an estimate; a supplied value is ignored.
  - Rates are approximate kcal per minute, configurable in
    `system_settings.training_calorie_rates`, per type with a default per kind.
  - Default workout rates: default 6, HIIT 10, Cardio and Athletic 8.
  - Default activity rates: default 5; Walking 4, Running 10, Cycling 7, and so on.
- **Preview:** the form reads the same rates through `training_calorie_rates()` and
  shows the estimate with spec §15's wording: "Estimated based on the default workout
  assumption. Actual expenditure may vary."
- **Manual override:** optional and non-negative. The displayed value is
  `final_calories = coalesce(manual, estimated)`, and lists mark it _Manual_ or
  _Estimated_.
- **Stable history:** the estimate is recomputed only when an editable record's duration
  or type changes. Changing the rates never rewrites stored values.
- **No effect on food:** workout and activity calories are shown separately, as
  secondary figures. They are never added to or subtracted from the food target.

## Editing, deleting and locking

- **Editable:** today's unlocked records can be edited (type, name, duration, manual
  calories) and deleted, with a confirmation. Deletion is soft (`is_deleted`), and
  deleted records are excluded from the page, Home and totals.
- **Locked:** past records, or records with `is_locked`, show `LOCKED` and stay readable,
  with edit and delete hidden.
  - The database guard rejects any change (`42501`), whatever the UI does.
  - The date of a saved record can't be changed.
- **Admin corrections:** these go through the existing service-role and admin path and
  are audited. There is no admin UI in this phase.

## Late entry

This uses the same mechanism as Food (see [food.md](./food.md#late-entry-missing-historical-food)):

- **Functions:** `log_workout()` and `log_activity()` (`SECURITY DEFINER`) are the only
  way to create a record on a past day, up to **90 days** back. Future dates are
  rejected (`22023`).
- **Grants:** each call writes a one-shot, transaction-scoped grant that names its table.
  A workout grant admits only a workout, and a meal grant only a meal. Users cannot read
  or forge grants.
- **Still blocked:** direct past-dated inserts.
- **After saving:** a late record is locked immediately.
- **UI:** the form's date field allows today back to 90 days, and a past date shows
  "Locked once saved".

## Page and queries

- **Day:** `/workout?date=YYYY-MM-DD` selects a day, and its Monday–Sunday week is shown.
  An invalid or future date shows today with a notice.
  - Day navigation is shared with Food; the week header adds previous/next week.
  - `?add=workout` and `?add=activity` (Home's quick actions) open the matching form.
- **Queries** (`features/training/api`):
  - `['training', uid, 'week', weekStart, today]`: one week of workouts and activities.
  - `['training', uid, 'plan', date]`: capacity and template.
  - `['training-rates']`: the estimate rates.
- **After a mutation:** the training weeks and **Home** (`homeKeys.all`) are
  invalidated. Nothing is optimistic.
- **Layout:** the log and edit form is the shared responsive `Sheet` (a bottom sheet on
  mobile, a side panel from `md`).

## Not in this phase

Exercise sets, reps and weights; an exercise library; personal records; AI workout
generation or chat; wearable and health integrations; steps entry UI; GPS; leaderboards;
the admin correction UI; and Progress charts.
