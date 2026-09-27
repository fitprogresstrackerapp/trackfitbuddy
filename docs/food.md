# Food & Nutrition

Food (spec §10–13) shows one day's intake against that day's targets, the day's meals, and
the logging flow. Code lives in `src/features/food`. The daily summary component and the
nutrition rules are shared with Home (`src/features/nutrition`).

## Page

- **Day:** `/food?date=YYYY-MM-DD`.
  - "Today" is the calendar date in the **profile timezone**, which is the day the database
    uses for locking.
  - No parameter means today.
  - An invalid or future date shows today with a notice. The date picker's `max` is today,
    and "next day" stops at today.
- **Order on the page:**
  1. Header actions: _Copy meal_, _Add food_.
  2. Day navigation.
  3. Past-day notice.
  4. Nutrition summary (the same component as Home).
  5. Meals.
  6. _My foods_ (the user's submissions).
- **Quick add:** on wide screens (`xl`, 1280px and up) a panel beside the summary offers
  search, then recent/frequent foods. On narrower screens the same lists open inside the
  add sheet.
- **Opening from Home:** `?add=meal` (Home's _Add food_ action) opens the add flow.
  Closing the flow removes the parameter.
- **Sheets and dialogs:** the add and copy flows use the shared responsive `Sheet` (a bottom
  sheet on mobile, a right-hand panel from `md`). Edit quantity, change category and
  delete meal use `Dialog`.

## Queries (`api/food-queries.ts`)

All reads and writes run with the user's session, so RLS applies. There is no service-role
access from the browser.

| Key                             | Source                                                        | Limit   |
| ------------------------------- | ------------------------------------------------------------- | ------- |
| `['food', uid, 'day', date]`    | `meals` for one date + nested `meal_items` (both non-deleted) | one day |
| `['food', uid, 'targets', d]`   | `fetchTargetsForDate`: the date's snapshot, else its cycle    | one row |
| `['food', uid, 'search', q]`    | RPC `search_foods` (debounced 250 ms, at least 2 characters)  | 20      |
| `['food', uid, 'usage', order]` | RPC `food_usage('recent' \| 'frequent')`                      | 10      |
| `['food', uid, 'copy', date]`   | the user's meals from the 14 days up to the date              | 20      |
| `['food', uid, 'submissions']`  | the user's `food_submissions`                                 | 50      |

- **After a meal change:** the day, usage, search, copy-candidate and **Home**
  (`homeKeys.all`) queries are invalidated. Nothing is optimistic; totals always come back
  from the database.
- **After a category change:** only the day query is invalidated.
- **After a food submission:** the submissions and search queries are invalidated.

## Nutrition

- **Snapshots:** every meal item stores a snapshot, computed by the existing trigger from
  the food and quantity at logging time.
- **Totals:**
  - Day and meal totals sum those snapshots and never read the food master. A later change
    to a food never alters a logged meal.
  - Nothing logged gives `null`, shown as `—`, never 0. A failed query shows an error,
    never zeros.
- **Writes carry no nutrition.** Writes send only a food id (`food_item_id` or
  `food_submission_id`) and a quantity. Name, unit and nutrition values are always derived
  by the database.
- **Quantity edits:** changing a quantity on an editable item makes the trigger rescale the
  item's own snapshot.
- **Preview:** the quantity step shows "≈" values calculated as value × quantity ÷ serving
  size. After saving, the stored values are displayed.
- **Units:** each food has exactly one serving unit (g, ml, piece, bowl…). Quantities are
  entered in that unit, with quick picks for ½, 1, 1½ and 2 servings. No unit conversions
  are invented.
- **Calories:** a range from target × lower to target × upper tolerance, shown as
  Below / Within / Above range. Nothing is subtracted for exercise.
- **Macros:** protein, carbs, fat and fiber count as "met" at ≥ target × the snapshot's
  tolerance, using the same helpers as Home.
- **Fallback targets:** when a day has no snapshot, the targets are the covering cycle's
  final values. These carry no tolerance, so no status is shown.

## Search and ranking

`search_foods(query, limit)` runs as the caller:

- **Candidates:** active shared foods (not deleted or merged), plus the caller's **own**
  pending submissions. Other users' submissions are never returned; RLS also hides them
  from direct reads.
- **Matching:** a normalized name `LIKE` or a trigram word-similarity match (`pg_trgm`).
- **Order:**
  1. Exact name, then name or word prefix, then other matches.
  2. Within the same match quality: most recently used by the caller, then most often
     used by the caller, then similarity, then name.
- **Usage:** computed from the caller's own non-deleted meal items only. Search clicks are
  not tracked.

`food_usage('recent' | 'frequent')` returns the caller's logged foods. Items logged
against merged foods are resolved to the surviving food.

## Source labels

| Label            | Meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `VERIFIED`       | A shared food from the curated database                        |
| `PENDING REVIEW` | The user's own submitted food; usable by them, not shared      |
| `≈ Est.`         | A food flagged `is_approximate` (e.g. restaurant/outside food) |
| `My food`        | On a logged item: it came from the user's submission           |

## Editing and locking

- **Today's unlocked meals:**
  - Add food; the menu's _Add food_ appends to that meal.
  - Edit an item's quantity.
  - Remove an item. Removing the last item deletes the meal, with a confirmation.
  - Change the category.
  - Delete the meal, with a confirmation.
  - Deletion is soft (`is_deleted`), and deleted rows are excluded everywhere.
- **Existing records on past days, or records with `is_locked`:** read-only and marked
  `LOCKED`, with the edit and delete controls hidden. The database guard rejects any change
  anyway (`42501`).
- **Merging into an existing meal:** picking a category that already has an editable meal
  today appends to that meal (`add_meal_items`) instead of creating a second one.
  Uncategorized meals are never merged automatically.

## Late entry (missing historical food)

Missing historical food can be entered later. This is a product decision from the Phase 1
Food brief; `spec.md` §13/§66 only defines locking. The lock model forbids edits to past
records. The exception is kept as narrow as possible, and nothing about
existing locked records changes.

- **Where:** `log_meal(date, items, category)` is a `SECURITY DEFINER` function, and the
  only way to create a meal on a past day.
- **What it creates:** a **new** meal with its items in one call.
  - For a past date it writes a grant into `private.late_entry_grants`, scoped to the
    current transaction, user and date (and, for items, the new meal).
  - It then inserts the meal and items, and deletes the grant.
  - The record guard accepts a past-dated insert only when such a grant exists.
- **What stays blocked:**
  - Users cannot read, write or forge grants. The table and check function are not granted
    to client roles.
  - Direct past-dated inserts still fail.
  - Adding items to an existing past meal fails.
  - Updates and deletes of past or locked rows fail.
- **After saving:** the late meal is dated in the past, so it is locked immediately.
- **Window:** the last **90 days**. Future dates are rejected (`22023`).
- **UI:**
  - A past day within the window offers _Add missing meal_, with a "Locked once saved"
    warning.
  - Older days are read-only.
  - Future dates are never offered.

`add_meal_items(meal_id, items)` runs as the invoker, so RLS and the guard apply. It only
appends to the caller's own editable meal and does not open a late-entry path.

## Copy meal

- **Function:** `copy_meal(source_meal_id, target_date)` rebuilds the source's items (food
  id and quantity) and calls `log_meal`.
- **Result:** a **new, independent** meal with `copied_from_meal_id` set.
  - The source, even a locked one, is only read.
  - Editing the copy never touches the original.
- **Snapshots:** taken at copy time from the food as it is now; merged foods are followed.
- **Rules:** the target date follows the usual rules. Today gives an editable meal, a past
  day is a late entry (locked), and a future date is rejected. Only the caller's own meals
  can be copied.
- **UI:** _Copy meal_ lists the last 14 days of meals (up to 20) and copies into the viewed
  day. A meal's menu offers _Copy to today_ (or _Copy as new meal_ on today).

## User-submitted foods

- **What the user enters:** a name, a serving size and unit, and calories, protein, carbs,
  fat and fiber per serving.
- **Validation:**
  - Zod on the client: non-negative, finite, at most 2 decimals, sensible maximums, and a
    simple unit such as `g`, `ml`, `piece` or `bowl`.
  - Database constraints stay authoritative.
- **Status:** saved as `PENDING_REVIEW`. RLS forbids self-approval.
- **Use:** only the submitter can log the food or find it in search. The user continues
  straight to its quantity after creating it.
- **Similar names:** while the name is typed, similar existing foods are shown as a
  non-blocking "A similar food already exists" note. Nothing is merged or overwritten;
  merging is an admin task.
- **My foods:** the list shows each submission with its status (Pending review / Approved /
  Rejected).

## Errors

Failures show short, action-specific messages ("Couldn't save this food. Please try
again."). Known database conditions are translated: locked record, future date, late-entry
window, unavailable food. Raw database text is never shown.

## Not in this phase

- **Features:** barcode scanning, photo/AI recognition, templates or recipes, micronutrients,
  external nutrition APIs, and net-calorie accounting.
- **Admin:** approving, editing and merging foods comes with the later Admin prompt.
- **Catalog:** the curated shared catalog is admin-managed. This repository ships no food
  seed data.
