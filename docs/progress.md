# Progress

Progress (spec §44–45) is deterministic self-analysis computed from stored records. It
contains no AI commentary, predictions or rankings. Code lives in `src/features/progress`,
and the page is loaded lazily because it carries the charting library.

## Page

- **Current cycle:** summarised first and independent of the selected range.
- **Selected range:** drives every section below it.
- **Sections, in priority order:** Body, Nutrition, Training, Activity (with steps), Goals.
  A Body section with no measurements moves below the sections that have data, as a
  compact note.
- **Range selector:** `7D · 30D · 3M · 6M · 1Y` (default `30D`), kept in `?range=`. An
  unknown value falls back to 30D.
- **Independent sections:** each section loads, fails (with a retry) and skeletons on its
  own. A failure is never shown as zeros.

## Ranges

- **Today:** the date in the user's **profile timezone**. Ranges are inclusive and end
  today.
- **7D / 30D:** today and the previous 6 / 29 days.
- **3M / 6M / 1Y:** the 3 / 6 / 12 calendar months ending today, starting the day after
  the same date n months earlier. The day is clamped to month length, e.g. 3M ending
  2026-05-31 starts 2026-03-01.
- **Implementation:** `addMonths`, `addDays` and `calendarWeekOf` in
  `src/lib/dates/local-date.ts` use calendar arithmetic, never UTC timestamps.

## Current recommendation cycle

- **Which cycle:** the one covering today, in review or active (replaced cycles never
  count).
- **Label and period:** labelled by the month it began ("September progress"), with its
  real period shown: "Recommendation cycle · SEP 4 – ongoing". Metrics cover the cycle's
  start until today (or its end, if earlier), never a calendar month.
- **Metrics shown when data exists:**
  - Workout days (full weeks, plus this week so far).
  - Calories in range and Protein met, each over eligible tracked days.
  - Weight and body fat, first → latest.
  - Activities.
- **No cycle:** "No recommendation" appears instead. No target or capacity is invented.

## Historical targets

Each date uses **the target in force that day** (spec §26), via the shared
`resolveTargets` in `features/nutrition/lib/targets.ts`, which Home and Food also use:

1. That date's `daily_target_snapshots` row, including its tolerances.
2. Otherwise the covering cycle's final values, without a tolerance.
3. Otherwise no target.

Charts draw the target as a step line, so a change appears on the exact date. Today's
target is never applied to the past.

## Nutrition

- **Totals:** per-day totals come from `daily_nutrition(start, end)`, a SQL aggregate of
  logged meal-item **snapshots** (see Database). Unlogged days are absent and appear as
  chart gaps, never 0.
- **Adherence** (spec §28) = days meeting the target ÷ **eligible tracked days**. A day
  is eligible when:
  - it is complete (before today, since today is still in progress);
  - it has at least one logged food;
  - it has a target snapshot with its tolerance.

  Days without food are not misses; they are not tracked.

- **Rules:**
  - Calories are met within `target × lower` … `target × upper` (default 0.85–1.10).
  - Protein, carbs, fat and fiber are met at `actual ≥ target × tolerance`.
  - Tolerances come from each day's snapshot; nothing is hard-coded.
- **Averages:** intake and target are averaged over the same tracked, completed days.
- **Charts:** calories against target (bars, with a target step line), and one macro at a
  time (Protein / Carbs / Fat / Fiber). A compact table lists all four macros.

## Training

- **Counting:** weekly completion reuses the shared Home/Workout rules (`countWorkoutDays`,
  `isTransitionWeek`). A week's count is its **distinct workout days**, Monday–Sunday. Any
  workout type counts; the AI template never decides adherence.
- **Capacity:** each week's capacity is the one in force on its last elapsed day.
- **Week statuses:**
  - `partial`: the recommendation began mid-week (a transition week).
  - `in progress`: the current week.
  - `no capacity`: no recommendation yet.

  None of these are judged.

- **Adherence:** Σ min(done, capacity) ÷ Σ capacity over completed full weeks. Extra
  workouts never offset another week.
- **Fetching:** workouts are fetched from the Monday of the range's first week, so that
  week's count is complete.
- **Also shown:** workout days, sessions, time, average duration, and workout calories.
  Calories use the value stored at log time (manual overrides respected), never
  recalculated.
- **Display:** a weekly table for up to 6 weeks, and a bar chart (days vs capacity) for
  longer ranges.

## Activity and steps

- **Activities:** separate from workouts, with **no target** (spec §18). The section shows
  sessions, days, time, and stored calories ("not added to food targets"), plus minutes
  per week when at least 2 weeks have data.
- **Steps:** the active daily value from `daily_steps`, the latest valid entry per day.
  The average is taken over days with an entry only, since no entry is not 0 steps. There
  is no step goal. Steps are entered on Profile (see [`profile.md`](./profile.md)); Progress
  refreshes after each change.

## Body

- **Weight:** real measurements only, one per measured date. The existing precedence
  applies: InBody over manual on the same date, else the latest entry. Other entries stay
  in the record. The section shows earliest → latest in the range, the change, and a line
  through the actual points only, with nothing interpolated. The trend chart needs at
  least 2 measured days.
- **Body fat and muscle mass:** from InBody metrics only (non-deleted reports), never
  inferred from weight. Body-fat change is in **percentage points** (pp).

## Goals

- **Shown:** the goal locked to the current cycle, and the profile's active goal if it
  differs (it applies to the next cycle).
- **No percentages:** goals have **no numeric target** in the Phase 1 schema, so no
  percentage or progress bar is shown. For weight-related goals, the observed weight and
  body-fat change in the range is given as descriptive context, without predictions.
- **`goalProgress(start, current, target)`:** implemented and tested (works for loss and
  gain, clamped to 0–1), but it returns `null` unless all three values exist. It is not
  rendered until goals gain a numeric target.

## Records

- **Soft-deleted:** meals, items, workouts, activities, weights and InBody reports are
  excluded.
- **Locked:** records remain valid history and are included.
- **Access:** all reads run as the signed-in user, so RLS is the boundary. Every query is
  bounded by the period and selects only needed columns.
- **Refresh:** Food and Workout mutations invalidate `['progress', userId]`.

## Database

Migration `20261003000100_progress_analytics.sql` adds:

- **`daily_nutrition(p_start, p_end)`:** a `SECURITY INVOKER` function returning per-day
  totals of the **caller's** logged snapshots.
  - Excludes deleted meals and items.
  - Bounded to at most 400 days (a 1-year range plus margin).
  - Absent days are not returned.
  - Anonymous access is revoked.

It exists so a 1-year range never downloads every meal item (spec §67, reusable daily
nutrition aggregation). Weekly workout counting stays in the shared TypeScript helpers, so
there is exactly one implementation.
