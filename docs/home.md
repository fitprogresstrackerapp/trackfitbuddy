# Home dashboard

Home (spec §9) is today-focused: nutrition against today's targets, steps, workout,
activity, one next step, the current cycle's focus, and the three logging actions. It
never shows history or charts; those belong to Progress.

## Data

"Today" is the calendar date in the **profile timezone**, the same day the database uses
for locking. An unusable timezone falls back to `Asia/Kolkata`, the column default.

The three queries are independent, so one failing section never blanks the page. Each
runs with the signed-in session under RLS and filters by the signed-in user's id; there
are no URL parameters.

| Query (`src/features/home/api`) | Reads                                                                                                            | Rules                                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchHomePlan`                 | `daily_target_snapshots` for today; the `recommendation_cycles` row covering today; that cycle's goal            | Targets come from today's snapshot. If none exists yet, they fall back to the covering cycle's `final_*` values, without tolerance. Never invented. |
| `fetchHomeNutrition`            | today's non-deleted `meals` with non-deleted `meal_items`                                                        | Sums the logged **snapshots**, never the food master. Nothing logged gives `null`, not zeros.                                                       |
| `fetchHomeTraining`             | `daily_steps` (active entry), this Monday–Sunday week's non-deleted `workouts`, today's non-deleted `activities` | The latest valid step entry wins. Weekly workouts count distinct days up to today. Activities stay separate from workouts.                          |

## Rules applied on Home

- **Calories:** a range (target × lower … target × upper). Remaining is target minus
  intake; workout and activity calories are **never** subtracted.
- **Protein, carbs, fat and fiber:** "met" when actual ≥ target × tolerance.
  - Tolerances come from the day's snapshot.
  - Without a snapshot, no status is shown.
- **Missing data:** shown as `—`, "No entry today" and similar, never as 0.
- **No step goal:** none exists in Phase 1, so none is shown.
- **Workout capacity:** weekly, not a daily requirement.
  - A day without a workout is shown neutrally.
  - When the cycle started mid-week, the week is marked "Partial week" and no completion
    judgement is made.
- **Recommendation state:** what users can see is no plan, review open until a date, or
  plan active. Processing runs are admin-only data, so "processing" and "failed" aren't
  shown to users. While a new plan is pending, the previous cycle keeps covering today.
- **Next:** a deterministic suggestion; no AI is called. When a section failed to load, it
  says so rather than "Nothing urgent".
- **Focus:** only the goals locked to the current cycle (spec §9).

## Conventions for later features

- **Invalidation:** after logging food, workouts, activities or steps, invalidate
  `homeKeys.all(userId)` (`src/features/home/api/home-queries.ts`).
- **Logging entry points:** `ADD_ACTION_ROUTES` in `src/constants/routes.ts`
  (`/food?add=meal`, `/workout?add=workout`, `/workout?add=activity`). The Food and Workout
  features should read the `add` parameter.
- **Workout plan JSON:** Home reads only `workout_plan_json.sessions[].name` (or plain
  strings) to show the next template session. The recommendation engine owns the full
  contract.
