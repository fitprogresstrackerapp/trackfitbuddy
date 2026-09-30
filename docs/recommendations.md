# Monthly AI recommendations

The recommendation engine generates each user's monthly targets and workout template
(spec §29–43, §71–74). It is monthly and cycle-based, and an admin triggers it. It runs
on the server, returns structured output, and is budget-controlled. Every step is
auditable, and each user is processed independently.

The AI gives **guidance**. The app measures behaviour against targets deterministically
(Home, Food, Workout, Progress), and the AI never decides whether a target was met.

| Part                     | Where                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Engine (pure TypeScript) | `src/features/recommendations/engine/` (config, input, input-builder, prompts, output, provider, cost, processor) |
| Edge Function            | `supabase/functions/process-recommendations/` (entry, Supabase repository, provider factory, Claude provider)     |
| Database                 | `supabase/migrations/20261005000100_recommendation_engine.sql`                                                    |
| Admin screen             | `/admin/recommendations` (`src/features/recommendations/pages`)                                                   |
| User screens             | Profile: Current plan (existing review flow), Monthly check-in, Recommendation history                            |

The engine folder uses only relative `.ts` imports and `zod`. The Deno Edge Function and
Vitest therefore run the same code, including the shared Progress, nutrition, training
and date functions it reuses.

## Monthly cycle and processing date

- **Cycle:** runs from one generation date to the day before the next (`period_start` …
  `period_end`). Analytics use these real dates, not calendar months.
- **Processing date:** the intended day is the 4th (`recommendation_processing_day`).
  There is no cron. An admin processes users on or after that day, and the **actual**
  date (in the user's timezone) becomes the new `period_start`. Processing on Oct 5
  gives a cycle starting Oct 5.
- **Processing month:** the user's local month on that date. Only one current
  (non-replaced) recommendation exists per user and month.

## Eligibility (readiness)

The spec (§71) defines only the required profile fields. The smallest rule on top:

1. active account;
2. the onboarding-required fields (name, date of birth, gender, height, current weight;
   `profile_readiness`);
3. an active goal;
4. a workout capacity (2–6 days/week);
5. no recommendation yet this month, and no attempt already PENDING or PROCESSING.

InBody, steps, feedback, meals and history are **optional**. When they are missing,
they are sent as missing. A user who isn't ready is never sent to the AI: if selected,
they get a `SKIPPED` attempt with a plain reason ("Profile incomplete", "No goals
configured", "Already has a recommendation this month").

Admin states per user and month (`recommendation_overview()`): READY, INCOMPLETE,
PENDING, PROCESSING, SUCCESS, FAILED, SKIPPED.

## Input builder (deterministic analytics)

`buildRecommendationInput(source)` is pure. The Edge Function's repository loads one
user's rows with the service role, bounded to the analysed window. The builder
produces `RecommendationInput` (`recommendation-input-v1`, strict Zod schema). Every
number is computed with the **same functions Progress uses**, so Progress and the AI
always agree:

| Metric                     | Rule (shared function)                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window                     | Previous cycle start → the day before processing (at most 366 days). First recommendation: the last 28 completed days (`recent_data`).                                                   |
| Nutrition averages         | Tracked, completed days only (`summarizeNutrition`); the processing day is never counted.                                                                                                |
| Nutrition adherence        | Days meeting **that day's snapshot** target (with its tolerance) / eligible tracked days. Never average intake / average target.                                                         |
| Workouts                   | Distinct workout days (`countWorkoutDays`); Monday–Sunday full weeks only; transition and running weeks excluded; `min(done, capacity)` per week (`weeklyTraining`, `workoutAdherence`). |
| Activities                 | Sessions, days, minutes, stored calories and types (`entryTotals`). They are never counted as workouts.                                                                                  |
| Steps                      | Average of days with an active entry (`stepsSummary`). A missing day is not zero, and no step target is invented.                                                                        |
| Weight / body fat / muscle | First → last observed value in the window (`weightSeries` with InBody precedence, `compositionSeries`, `change`). Never interpolated.                                                    |
| InBody                     | Latest report with metrics dated on or before the processing date. Otherwise `null`. Reports and images are never sent.                                                                  |
| Goal                       | The active goal version, which the new cycle will lock. A goal changed for the next cycle is used here, while the previous cycle keeps its own.                                          |
| Capacity                   | The profile preference, for the new cycle. The previous cycle is summarised against its own locked capacity.                                                                             |
| Previous recommendation    | Final targets (after user edits), whether they were edited, template names and types, focus and summary. It never includes raw AI history.                                               |
| Feedback                   | This month's check-in. It is frozen at claim time (see Feedback).                                                                                                                        |

`null` always means missing. The AI never calculates adherence, averages or changes.

## Provider abstraction

```ts
interface AIRecommendationProvider {
  readonly name: string
  readonly model: string
  generateRecommendation(
    input,
    { prompt, maxOutputTokens, timeoutMs, jsonSchema },
  ): Promise<{
    rawText
    provider
    model
    inputTokens
    outputTokens
    totalTokens
    actualCost
    stopReason
    requestId
  }>
}
```

- **`mock`** (`MockRecommendationProvider`):
  - deterministic, no network;
  - used for local development, every test and the browser checks;
  - a marker in the user's feedback such as `[mock:timeout]` simulates failures
    (timeout, rate_limit, unavailable, auth, refused, invalid_json, schema_invalid,
    out_of_range, macro_incoherent, wrong_sessions, weekday, flaky_json);
  - only the mock reads these markers; to a real provider they are plain text.
- **`anthropic`** (`process-recommendations/anthropic-provider.ts`):
  - calls the Claude Messages API through the official SDK;
  - structured output via `output_config.format` with a JSON schema derived from the
    Zod output schema (unsupported keywords stripped; Zod still enforces them);
  - server-side refusal fallbacks (`fallbacks: "default"`); the model that actually
    answered is recorded;
  - SDK retries are off, because the processor retries;
  - the default model is `claude-opus-5`.
- **Selection:**
  - `system_settings.ai_provider` / `ai_model` decide in production;
  - the Edge Function env var `AI_PROVIDER` (and optional `AI_MODEL`) overrides them;
  - local `supabase/functions/.env` sets `AI_PROVIDER=mock`.
- **Secrets:** `ANTHROPIC_API_KEY` exists only in the Edge Function environment.

## Prompt versioning

- `src/features/recommendations/engine/prompts.ts` holds versioned prompts. The current
  one is `recommendation-v1`, selected by `ai_prompt_version`.
- Each attempt and cycle stores its prompt version.
- A changed prompt is a new version (`recommendation-v2`), never an edit of an old one.
  Old recommendations are never regenerated under a new prompt.
- The system prompt covers:
  - the role and product philosophy: guidance, any workout type counts, no compliance
    judging;
  - null = unavailable, and precomputed metrics that the AI must not recalculate;
  - gradual changes, coherent targets and ranges, a template of exactly the capacity
    with no weekdays;
  - health boundaries: no diagnosis, treatment, medication or guarantees, and a
    professional where relevant;
  - concise output, conclusions only; no reasoning is requested or stored.
- **Prompt-injection boundary:**
  - the entire input is one JSON document inside `<user_data>` tags in the user turn;
  - the system prompt says it is data, and that job, hobbies, objective and feedback
    are the user's words, never instructions;
  - `<` is escaped (`<`), so user text can't close the tag.

## Output validation

- **Output shape:** the spec §36 structure (`recommendationOutputSchema`, strict Zod):
  `assessment`, `targets`, `long_term_goal`, `short_term_focus`,
  `workout_plan {days_per_week, sessions[{name, type, focus}]}`,
  `activity_recommendation`, `nutrition_suggestions`, `improve`, `watch`, `summary`.
- **Validation order:**
  1. **JSON:** invalid JSON → `MALFORMED_JSON` (retryable).
  2. **Schema:** unknown fields, wrong types, unknown workout types or focuses, overlong
     text → `SCHEMA_INVALID` (retryable).
  3. **Ranges:** the review form's ranges (`TARGET_RANGES`: calories 800–6000 whole
     number, protein 0–500, carbs 0–1000, fat 0–400, fiber 0–150). Out of range →
     `TARGET_OUT_OF_RANGE`. Values are **never clamped**.
  4. **Macro coherence:** |P×4 + C×4 + F×9 − calories| / calories ≤ 15 %. Otherwise
     `MACRO_INCOHERENT`.
  5. **Schedule:** exactly the capacity (`days_per_week` and session count), allowed
     types, names of at most 60 characters, no weekday names. Otherwise
     `SCHEDULE_INVALID`.
- **On failure:** the attempt is FAILED, the raw text and validation issues stay in
  `raw_output_json`, and no cycle is created. `complete_recommendation_attempt` checks
  ranges and capacity again in SQL.

## Processing, retries and failures

The Edge Function `POST /functions/v1/process-recommendations` accepts only these
commands:

```json
{ "action": "start", "mode": "PROCESS", "process_all_ready": true }
{ "action": "start", "mode": "PROCESS" | "RETRY" | "REPROCESS", "user_ids": ["…"] }
{ "action": "continue" }
```

Any other field is rejected with 400. The input is always built on the server, so a
browser can't send `weight_kg: 50`.

The function runs these steps in order:

1. **Authenticate:** verify the JWT (gateway and Auth server).
2. **Authorise:** require an active ADMIN or SUPER_ADMIN (checked server-side against
   `user_roles`). Managers, group leaders and users get 403.
3. **Load configuration:** enabled, budget, provider and secret, prompt version, and
   pricing in the budget currency. Otherwise 409: `AI_DISABLED`, `BUDGET_NOT_CONFIGURED`,
   `PROVIDER_NOT_CONFIGURED`, `PROMPT_NOT_FOUND` or `PRICING_NOT_CONFIGURED`.
4. **Recover stale attempts:** PROCESSING attempts older than
   `ai_stale_processing_minutes` become FAILED ("Processing interrupted"). They are
   never retried automatically.
5. **Queue (start only):** `enqueue_recommendation_run` creates a run (`mode`,
   `created_by` = the admin, provider, model, prompt, batch size, budget) and one attempt
   per selected user: PENDING if eligible, otherwise SKIPPED with a reason.
6. **Process one batch:** up to `ai_batch_size` PENDING attempts, three at a time. For
   each user:
   1. load and build the input (skip if not ready);
   2. reserve the budget and claim;
   3. call the provider with retries;
   4. validate;
   5. complete, or fail.
7. **Stop starting new users** once ~100 s have passed or the budget refuses a claim.
   Those users stay PENDING.
8. **Update run statuses:** RUNNING, STOPPED_BUDGET, COMPLETED, PARTIAL (some failed) or
   FAILED (all failed).

**Architecture decision:** one Edge Function request processes one batch
synchronously. This is the smallest reliable fit for the runtime's wall-clock limit.
The admin page calls `continue` automatically while users are pending. If the page is
closed, nothing is lost: pending users wait for the next Process or Continue. There is
no job queue or background worker.

**Retries** (`ai_max_retries`, default 1, bounded 0–3):

- timeouts, rate limits, an unavailable provider, malformed JSON and schema errors
  retry within the same attempt;
- authentication failures, refusals, truncated output (`max_tokens`) and business-rule
  failures don't retry;
- every provider request is an `ai_usage_records` row.

**Per-user isolation:** each user is independent. An exception or failure is counted
and the batch continues.

**Modes:**

- **PROCESS:** READY or FAILED users.
- **RETRY:** FAILED users only. A new attempt (`attempt_number` + 1) is created and the
  failure stays in history.
- **REPROCESS:** explicit, and the admin page asks for confirmation. Only for users who
  already have this month's recommendation. It is generated from the same basis (the
  cycle before this month's). On success the existing cycle becomes `REPLACED`, which is
  kept, never deleted, and still visible to admins, and the new one begins its review
  window.
- Successful users are never reprocessed by PROCESS or RETRY.

**Failures:**

- Admins see a concise reason ("Provider rate limit", "Target out of range: calories",
  "Macros do not add up to the calorie target", "Processing interrupted").
- Users see only "No current recommendation" / "No recommendation available"; the
  previous recommendation stays in force.
- Stack traces, keys and provider payloads are never shown to users.

**Duplicate prevention:**

- enqueueing is serialised by an advisory lock;
- a unique index allows one open (PENDING/PROCESSING) attempt per user;
- claims only take PENDING attempts, under row locks;
- `complete_recommendation_attempt` takes a per-user lock and rechecks this month's
  cycle;
- the existing unique indexes allow one current cycle per user and month, and one open
  cycle per user.

## Persistence and activation

- **Input:** `claim_recommendation_attempt` stores `raw_input_json` (with the frozen
  feedback), the input schema, provider, model, prompt and pricing versions, and the
  goal and capacity used. The provider call can't run inside a transaction, so the
  explicit PENDING → PROCESSING → SUCCESS/FAILED states make interruptions recoverable.
- **Success:** `complete_recommendation_attempt` does everything in **one
  transaction**:
  - stores the raw output, parsed output, recommended targets, tokens and estimated cost
    on the attempt;
  - marks this month's cycle REPLACED when reprocessing;
  - closes the previous cycle (`period_end` = day before; locked if still marked
    `IN_REVIEW`);
  - inserts the new cycle:
    - `IN_REVIEW`, `period_start` = the user's local date, `review_deadline` = +1 day;
    - final targets = recommended;
    - `workout_plan_json.sessions` = the AI template;
    - `activity_recommendation_json`;
    - the goal version and capacity from the input;
  - writes target snapshots from the start date (62 days), leaving earlier dates
    untouched;
  - locks and links this month's feedback;
  - records usage rows.
- **Failure:** `fail_recommendation_attempt` stores the reason, raw output and usage,
  and releases the reservation.
- **Audit:** cycle and feedback changes are audited by the existing triggers, with the
  initiating admin as actor (`app.actor_id` = `run.created_by`). The run keeps the
  initiating admin; the service-role worker is separate.

The **existing Prompt 9 review flow** is unchanged:

- the user edits final targets and session names, or accepts & locks, within the
  window;
- after the deadline the recommendation counts as locked;
- AI originals are immutable.

Home, Food, Workout and Progress pick up the new cycle through the snapshots and cycle
rows they already read. A recommendation in review is shown as in review, not as
accepted.

## Cost tracking and budget

- **Pricing** (`ai_pricing`):
  - versioned (`version`), in a currency, with per-model input and output prices per
    million tokens;
  - the currency must match `ai_budget_currency` (default INR);
  - seeded Opus prices are Anthropic's list price at an assumed 84 INR/USD, and must be
    updated with a new version when prices or rates change.
- **Cost:** every attempt and usage row stores its `pricing_version`. Costs are
  **estimated** (`estimated_cost`). `actual_cost` is kept separately if a provider ever
  reports it, and the admin screen labels spend "estimated".
- **Budget:** `ai_monthly_budget` in `ai_budget_currency`. It is null by default, and
  processing refuses to start until it is set. The budget month is the run's processing
  month.
- **Reservation (race-safe):** before a provider call, `claim_recommendation_attempt`
  takes a global advisory lock and checks:

  ```
  month spend (actual ?? estimated) + running reservations + this attempt's reservation ≤ budget
  ```

  - Exactly at the budget is allowed.
  - The reservation is the worst case: (estimated input tokens + the full output limit)
    × (1 + retries).
  - If the claim is refused, the attempt stays PENDING, the batch stops and the run
    becomes STOPPED_BUDGET ("Monthly AI budget reached").
  - Raising the budget (or a new month) and pressing Continue resumes.
  - The browser never sends budget figures.

## Monthly feedback (spec §31)

- **Storage:** one free-text field per user and month (`recommendation_feedback`,
  1–2,000 characters). It is optional; processing never requires it.
- **Window:** from the 1st of the month (user timezone) until that month's
  recommendation is generated. A late processing date extends the window.
- **Enforcement** (RLS plus the `recommendation_feedback_guard` trigger):
  - users write only their own feedback, for the current month;
  - no writes once the month is processed, and none while the user's generation is
    PROCESSING;
  - users can't set the lock or the link.
- **Freeze:** the claim reads the feedback under the same advisory lock, so the stored
  input contains exactly what the AI received. On success the row is locked and linked
  to the new cycle (re-linked on reprocess). A failure reopens the window.
- **History:** earlier months' feedback rows are never overwritten.
- **Visibility:** admins can read feedback. Managers can't.

## Security

- The AI key and the service-role key exist only in the Edge Function environment.
  `npm run check:bundle` verifies that neither reaches the browser bundle.
- The browser invokes one function with a command. It never sends AI input,
  configuration or budget.
- Only active ADMIN / SUPER_ADMIN may process (checked server-side). The processing SQL
  functions can't be called by any client session, admins included.
- **Visibility:** processing rows (`raw_input_json`, raw output) and usage are
  admin-only. Users see only their resulting recommendation; managers see assigned
  users' recommendations (existing policy), never processing internals.
- **Direct API calls:** users can't write, update or delete cycles, snapshots or
  attempts. Locked recommendations can't be edited.
- **Logs:** only ids, outcomes, counts and concise reasons. Never keys, tokens, the PIN,
  the request body, user text or the AI input.

## Current limitations

- No automatic (cron) processing, and no background worker. A batch runs within one
  request, and the admin page continues automatically while it is open.
- The Claude provider is not exercised by the automated tests, which must never call a
  real AI. Its request and response handling was verified against a local imitation of
  the Messages API (see [deployment.md](./deployment.md#ai-configuration)). A live
  request still needs a real key in a staging project.
- The Edge Function imports the shared engine from `src/`, which is outside
  `supabase/functions/`. `npm run functions:bundle` bundles it with the same bundler as
  `supabase functions deploy`, and runs the bundle with no project source. A deploy to
  a hosted project has not happened yet.
- Token estimates before the call are conservative (3 characters per token). Pricing is
  maintained manually; the INR prices assume an exchange rate.
- Snapshots are written 62 days ahead. A user not reprocessed for longer has later days
  without a snapshot, so adherence isn't counted for them until the next cycle.
- The admin screen lists every active user on one page, with the attempt history
  paginated (20 per page). The AI Usage admin section is still a placeholder: usage is
  on the Recommendations page.
- Users see only current and previous (not replaced) recommendations in their history.
