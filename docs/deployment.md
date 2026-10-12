# Production deployment

This guide covers:

- the PWA;
- hosting on Vercel;
- the Supabase cloud project;
- Edge Functions and AI configuration;
- secrets;
- a deployment checklist.

No real secret values belong in this file or in the repository.

```text
Browser ──▶ Vercel (static React/Vite build, vercel.json rules)
   │
   ├──▶ Supabase Auth       (sessions; PIN login goes through the pin-login function)
   ├──▶ Supabase Postgres   (RLS on every table)
   ├──▶ Supabase Storage    (private inbody-reports bucket)
   └──▶ Supabase Edge Functions
          pin-login · admin-users · process-recommendations ──▶ Anthropic Claude API
```

## Configuration and secrets

| Variable                            | Where                                                                       | Browser-safe | Purpose                                                          |
| ----------------------------------- | --------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------- |
| `VITE_SUPABASE_URL`                 | Vercel (build env), `.env` locally                                          | yes          | Supabase project URL                                             |
| `VITE_SUPABASE_ANON_KEY`            | Vercel (build env), `.env` locally                                          | yes          | anon / publishable key (RLS protects the data)                   |
| `PIN_AUTH_SECRET`                   | Supabase function secret                                                    | **no**       | derives each account's Auth password (≥ 32 chars)                |
| `ALLOWED_ORIGINS`                   | Supabase function secret                                                    | not secret   | comma-separated app origins allowed by CORS                      |
| `ANTHROPIC_API_KEY`                 | Supabase function secret                                                    | **no**       | Claude API key (process-recommendations only)                    |
| `AI_PROVIDER` / `AI_MODEL`          | function env, **local/tests only**                                          | not secret   | forces a provider (`mock`); leave unset in production            |
| `SUPABASE_SERVICE_ROLE_KEY`         | provided to functions by Supabase; trusted admin machine for `user:create`  | **no**       | service role                                                     |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | provided to functions by Supabase                                           | yes          | —                                                                |
| `SUPABASE_ACCESS_TOKEN`             | operator's machine only (git-ignored `.env.supabase`), for the Supabase CLI | **no**       | deploys migrations, functions and secrets; never used by the app |

The app at runtime needs only the two `VITE_` variables (browser) and the function
secrets (server). The Supabase access token is a deployment tool: nothing in the app,
the functions or the scripts reads it, and it should be revoked when not in use.

Only the two `VITE_` variables ever reach the browser. The following guards enforce
that:

- **Build guard:** `vite.config.ts` stops the build if a `VITE_` variable has a
  secret-looking name (`SECRET`, `SERVICE`, `TOKEN`, `ANTHROPIC`…) or any `VITE_`
  variable holds a secret-looking value (service-role JWT, `sb_secret_…`, `sk-…`,
  connection string). Vercel's own `VITE_VERCEL_*` system variables are allowed:
  they hold deployment metadata, and the app never reads them. The logic lives in
  `scripts/lib/public-env-guard.ts`.
- **Bundle scan:** `npm run check:bundle` scans every file in `dist/`. It looks for:
  - key patterns: service-role JWTs, `sb_secret_`, `sk-ant-`/`sk-` keys and
    connection strings;
  - server variable names and the actual local secret values;
  - Edge Function code (`Deno.env`), the AI prompt and the mock AI provider;
  - source maps and `.env` files.

  Vercel runs the scan as part of the build command, and a failure stops the
  deployment.

- **Source guard:** `src/lib/client-boundary.test.ts` fails if browser code reads a
  non-public variable or imports from `supabase/`, `scripts/` or `tests/`.

Production builds have no source maps (`build.sourcemap: false`).

## Frontend (Vercel)

1. Import the Git repository into Vercel. The framework preset is Vite. `vercel.json`
   sets:
   - install: `npm ci`
   - build: `npm run build && npm run check:bundle`
   - output: `dist`
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production (and Preview, if
   used). Do not add any other variables to Vercel.
3. Deploy. `vercel.json` also provides the SPA rewrite and the security and cache
   headers described below.

**Routing.** Every path that is not a real file is rewritten to `/index.html`. This
makes direct navigation and refresh work on nested routes such as `/groups/:id` and
`/admin/users/:id`. `/assets/*` is excluded, so a missing build file is a real 404,
never HTML served with status 200.

**Headers** (on all paths):

- **Content-Security-Policy:**
  - `default-src 'self'`, `script-src 'self'` (no inline scripts, no eval);
  - `style-src 'self' 'unsafe-inline'` (needed by charts and Radix positioning);
  - `img-src 'self' data: blob: https://*.supabase.co`;
  - `font-src 'self' data:`;
  - `connect-src 'self' https://*.supabase.co wss://*.supabase.co`;
  - `worker-src 'self'`, `manifest-src 'self'`;
  - `frame-src 'none'`, `object-src 'none'`, `frame-ancestors 'none'`;
  - `base-uri 'self'`, `form-action 'self'`.
- **Other headers:**
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - a restrictive `Permissions-Policy`
  - `Cross-Origin-Opener-Policy: same-origin`
  - HSTS
- **HTTPS:** Vercel enforces it, redirecting HTTP to HTTPS.

**Cache headers:**

- `/assets/*`: `immutable`, for one year (the file names are content-hashed);
- `index.html` (every SPA route), `sw.js` and the manifest: `no-cache`.

The strict CSP needed one runtime setting. Zod's JIT compiles validators with
`new Function`, so the app configures Zod as jitless. `src/lib/validation/zod-config.ts`
does this, and it is bundled with Zod itself so it runs before any schema is built.

**Custom Supabase domain.** If you use one, add its origin to `img-src` and
`connect-src` in `vercel.json`.

**Local production check.** To serve `dist/` with exactly these rules at
http://localhost:4173, run:

```bash
npm run build && npm run preview:prod
```

The only difference from production is that the CSP also allows the local Supabase
origin.

## PWA

- **Manifest** (`public/manifest.webmanifest`): name "TrackFitBuddy", `display: standalone`, `start_url`/`scope` `/`, theme and background `#0A0B0A`
  (the design background token).
- **Icons:** 192 and 512 PNG, a maskable 512 PNG, an SVG, and a 180 px Apple touch
  icon, all drawn from the favicon mark.
- **`index.html`:** carries the theme colour, viewport (`viewport-fit=cover`), Apple and
  mobile web-app metadata, a description and minimal Open Graph tags.
- **Service worker** (`src/pwa/service-worker.js`): emitted as `/sw.js` by
  `scripts/vite-plugin-service-worker.ts`, with a per-build ID and precache list. It is
  registered in production builds only.
  - **Precached:** the app shell (`index.html` and the assets it loads), the manifest
    and the icons.
  - **Cached on use:** `/assets/*` files (lazy route chunks, fonts). They are
    content-hashed, so they never go stale.
  - **Never handled:** every cross-origin request (all of Supabase: Auth, database,
    Storage, Functions), every non-GET request, any URL with a query string, and every
    other path. No health, nutrition, body, recommendation, group, admin or audit data
    can enter Cache Storage. So nothing private remains after logout, and a
    deactivated user's app has no data to show.
  - **Offline:** navigations are network-first and fall back to the cached shell. The
    app opens, and data sections show their normal error states. There is no offline
    data sync (spec §81).
- **Updates:** a new deployment's worker installs in the background and waits. The app
  shows "A new version of TrackFitBuddy is available" with a **Reload** action; only
  then does the new worker take over, and old caches are deleted.
  - Navigations are network-first, so a normal reload always loads the current
    deployment.
  - If a lazy chunk from the previous deployment is gone, the error page says "New
    version available" and offers a reload.
- **Sessions:** unchanged. The existing Supabase client keeps its session in
  `localStorage`; nothing else is persisted.

## Supabase cloud project

Do these steps from a trusted machine with the Supabase CLI, and never against a
production project by accident: check the project ref at each step.

1. **Create the project.** Pick a region near the users (for example, Mumbai).
2. **Link the project.** Run `npx supabase login`, then:
   ```bash
   npx supabase link --project-ref <ref>
   ```
3. **Migrations.** Preview, then apply:

   ```bash
   npx supabase db push --dry-run   # review the list: all files in supabase/migrations, in order
   npx supabase db push
   ```

   The migrations use only extensions that hosted Supabase provides (`pg_trgm`,
   `btree_gist`, `pgcrypto`). They also create:
   - the `private` schema;
   - all tables, RLS policies, triggers and functions;
   - the `system_settings` defaults;
   - the private `inbody-reports` bucket: 10 MB limit; PDF, JPEG, PNG, WebP, HEIC or
     CSV (an imported InBody CSV); own-folder policies.

   There is no seed data (`seed.sql` is empty on purpose). Never edit an applied
   migration; add a new one.

4. **Auth** (Dashboard → Authentication). Match `supabase/config.toml`:
   - "Allow new users to sign up": **off**. Accounts are created only by admins.
   - Email provider: **enabled**, with "Confirm email" **off**. The phone + PIN bridge
     signs in through a derived email identity. Phone provider: off.
   - Anonymous sign-ins: off.
   - Site URL: the production app URL.
   - JWT expiry: 3600 s. Refresh-token rotation: on, with reuse interval 10 s.
   - Rate limits: review the sign-in limit (30 per 5 minutes per IP by default here).
5. **Function secrets.** Never put these in Vercel or any `VITE_` variable:
   ```bash
   npx supabase secrets set PIN_AUTH_SECRET=<≥32 random chars>
   npx supabase secrets set ALLOWED_ORIGINS=https://<your-app-domain>
   npx supabase secrets set ANTHROPIC_API_KEY=<key>      # when AI processing is enabled
   ```
   Do **not** set `AI_PROVIDER` or `AI_MODEL` in production. Keep `PIN_AUTH_SECRET`
   stable, because changing it invalidates every account's derived password.
6. **Edge Functions:**
   ```bash
   npx supabase functions deploy pin-login admin-users process-recommendations inbody-import
   ```
   - **Bundling:** use the default Docker bundling. Docker must be running, and
     `--use-api` is not verified.
   - **Shared code:** `process-recommendations`, `admin-users` and `inbody-import` import code from
     `src/` and `scripts/lib/`. The CLI bundles those modules into each function.
     `npm run functions:bundle` proves this locally: it bundles each function with the
     same edge-runtime bundler, then boots each bundle in a container with **no project
     source** and checks CORS and unauthenticated handling.
   - **JWT verification:** `config.toml` sets `verify_jwt = false` for `pin-login` (its
     callers aren't signed in yet); the others verify the JWT at the gateway and
     again in code.
   - **CORS:** each function allows only the origins in `ALLOWED_ORIGINS`; there is no
     wildcard. The local stack's gateway adds `*` on top, but hosted Supabase does not.
7. **First super admin.** Run this once, on a trusted machine. The PIN is never
   printed:
   ```bash
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
   PIN_AUTH_SECRET=<same secret as the functions> \
   npm run user:create -- --phone 98XXXXXXXX --pin <pin> --name "<name>" --role SUPER_ADMIN
   ```
   All other accounts are created in the app (Admin → Users).
8. **Food database.** It starts empty. Admins add foods in the app; no seed is applied
   to production.

## AI configuration

- **Settings.** AI processing is configured in `system_settings`, by the migrations and
  the admin screens:
  - `ai_provider = "anthropic"`, `ai_model` (the migrations default it to
    `"claude-opus-5"`; production is set to `"claude-haiku-5-5"`, see below);
  - `ai_prompt_version = "recommendation-v1"`;
  - `ai_pricing` (INR per million tokens, used for cost estimates and budget checks);
  - `ai_max_retries`, `ai_max_output_tokens`, `ai_request_timeout_seconds`.
- **Production configuration** (set on 12 Oct 2026, in `system_settings`; no code or
  deployment change was needed):

  | Setting                | Value                                             | Why                                                                                     |
  | ---------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- |
  | `ai_model`             | `"claude-haiku-5-5"`                              | Claude Haiku 5.5                                                                        |
  | `ai_pricing`           | version `2026-10-12`; Haiku: 8.4 input, 42 output | USD 0.10 / 0.50 per million tokens (prompts up to 100k tokens) at an assumed 84 INR/USD |
  | `ai_max_output_tokens` | `8000`                                            | Haiku 5.5 thinks by default and thinking counts toward the limit                        |
  | `ai_monthly_budget`    | `84`                                              | About USD 1, for the first live tests                                                   |

  The provider key is the function secret `ANTHROPIC_API_KEY`.

- **Changing the model** is three statements. The model must have a price, or processing
  refuses with `PRICING_NOT_CONFIGURED`; give the price list a new version each time:
  ```sql
  update public.system_settings set value_json = '"claude-haiku-5-5"'::jsonb where key = 'ai_model';

  update public.system_settings
  set value_json = jsonb_set(
        jsonb_set(value_json, '{models,claude-haiku-5-5}',
                  '{"input_per_million": 8.4, "output_per_million": 42}'::jsonb),
        '{version}', '"2026-10-12"'::jsonb)
  where key = 'ai_pricing';

  update public.system_settings set value_json = '8000'::jsonb where key = 'ai_max_output_tokens';
  ```
- **Model notes (Claude Haiku 5.5):**
  - It has no server-side refusal fallback. The provider still sends
    `fallbacks: "default"`, which the API accepts; a declined request stays declined and
    the attempt is marked Failed with the reason. Nothing is activated.
  - Thinking is on by default and its tokens count toward `ai_max_output_tokens` and are
    billed as output. A limit that is too low cuts the reply off, which is treated as a
    failed attempt and retried once.
  - It rejects `temperature`; the provider does not send it.
- **Budget.** `ai_monthly_budget` is **null by default**, and processing refuses to
  start (`BUDGET_NOT_CONFIGURED`) until a budget is set. Keep `ai_pricing` in line with
  the provider's current prices.
  - There is no settings screen yet (Admin → System Settings is a placeholder). Set the
    budget in the Supabase dashboard's SQL editor. The amount is in the `ai_pricing`
    currency (INR), and the database rejects anything but a non-negative number:
    ```sql
    insert into public.system_settings (key, value_json)
    values ('ai_monthly_budget', '2000'::jsonb)
    on conflict (key) do update set value_json = excluded.value_json;
    ```
  - To turn processing off again, delete that row (a missing row means "not set").
- **Provider selection:**
  - **Local development and tests:** `AI_PROVIDER=mock` in `supabase/functions/.env`
    uses the deterministic mock provider. It never makes a network call.
  - **Production:** leave `AI_PROVIDER` unset, so the settings decide (Anthropic).
    `ANTHROPIC_API_KEY` must be set. Without it, processing answers
    `PROVIDER_NOT_CONFIGURED`.
- **Real-provider verification (no paid call).** The deploy bundle of
  `process-recommendations` was run with the Anthropic provider and a fake key, with the
  SDK pointed at a local imitation of the Messages API (`ANTHROPIC_BASE_URL`). This
  verified:
  - the request: model, JSON-schema structured output, the server-side refusal
    fallback, the versioned prompt, standardized input only;
  - Zod validation of the reply;
  - the provider and model recorded from the response;
  - tokens and cost from `ai_pricing`;
  - cycle creation;
  - a rate-limit failure and an invalid reply, each failing in isolation;
  - the key never being stored, returned or logged.

- **Live verification (12 Oct 2026).** One test user was processed on production with
  `claude-haiku-5-5`: one request, no retry, status Success, 3,337 input and 1,369
  output tokens, estimated cost ₹0.0855 (about USD 0.001). The recommendation was
  stored for review with all sections, four sessions for a capacity of four, and 62
  daily target snapshots. Provider, model, prompt version and pricing version were
  recorded on the attempt, the usage record and the cycle.

## Operating the MVP

Day-to-day operation without a developer. "Operator machine" means a trusted computer
with this repository, the Supabase CLI and the git-ignored `.env.supabase` file.

### Accounts

- **First admin:** created once from the operator machine (Supabase cloud project,
  step 7). There is no public registration.
- **Everyone else:** an admin creates the account in the app, Admin → Users → Create
  user (phone, 4-digit PIN, role User / Manager / Admin). The person signs in and
  completes onboarding. Only a super admin can create admins; nobody can create a
  super admin in the app.
- **Forgotten PIN:** Admin → Users → open the user → Reset PIN. Five wrong PINs within
  15 minutes lock that phone number for 15 minutes; a PIN reset clears the lock. Users
  cannot change their own PIN yet.
- **Leaving users:** Deactivate (same page). They can no longer sign in, an open session
  ends within minutes, and all records are kept. Activate reverses it. Accounts are
  never deleted.
- **Managers:** the Manager role sees only assigned users, read-only. There is no
  assignment screen yet; assign in the SQL editor:
  ```sql
  insert into public.manager_user_assignments (manager_id, user_id)
  values ('<manager profile id>', '<user profile id>');
  ```
  Profile ids are in the address bar of Admin → Users → the user's page.

### Food database

The shared food database starts empty, and Admin → Food Database is a placeholder: foods
cannot be added or edited in the app yet. Until they exist, a user can only log food by
creating their own custom foods.

- **Starter catalogue:** `supabase/seeds/starter-foods.json` holds about a hundred common
  Indian and household foods with **approximate** per-serving values (the app shows them
  as approximate). Review the file, then load it once from the operator machine:
  ```powershell
  $env:SUPABASE_URL = 'https://<ref>.supabase.co'
  $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role key>'   # Project Settings → API; never commit
  npm run foods:seed -- --dry-run     # lists what would be added; writes nothing
  npm run foods:seed
  ```
  It is safe to run again: foods already present (same name) are skipped and never
  changed, and nothing is deleted. To add foods later, add them to the file and run it
  again.
- **Correcting a food:** in the SQL editor, update the row in `public.food_items`. Meals
  already logged keep the values they were logged with (spec §12).
- **User-submitted foods** stay private to the person who created them ("Pending
  review"); there is no approval screen yet.

### InBody results

Users add their own results by importing the CSV exported from the InBody app
(Profile → InBody → Import CSV; see [profile.md](./profile.md#inbody-csv-import)). The
uploaded PDF or image itself is never read. A report without results shows "Awaiting
results".

For a user who has no CSV, an operator can still enter the values by hand:

1. Open the file in the Supabase dashboard: Storage → `inbody-reports` → the folder
   named with the user's profile id. (The admin screens list reports but cannot open
   the file yet.)
2. Find the report's id in the SQL editor:
   ```sql
   select id, report_date, file_path from public.inbody_reports
   where user_id = '<user profile id>' order by report_date desc;
   ```
3. Enter the values (the database rejects out-of-range values):
   ```sql
   insert into public.inbody_metrics
     (report_id, user_id, weight_kg, body_fat_percent, muscle_mass_kg, bmi, bmr_kcal)
   select r.id, r.user_id, 78.6, 23.1, 31.6, 24.3, 1650   -- the report's values; null if absent
   from public.inbody_reports r where r.id = '<report id>';

   update public.inbody_reports set extraction_status = 'COMPLETED' where id = '<report id>';
   ```

The weight then appears in the user's weight history as an InBody measurement. Later
corrections can be made in the app (Admin → Users → the user → InBody → Admin correction).

### Enabling AI recommendations

AI processing is off until both a provider key and a budget exist. To turn it on:

1. **Key:** `npx supabase secrets set ANTHROPIC_API_KEY=<key>` (operator machine). It is a
   function secret only; never put it in Vercel or a `VITE_` variable.
2. **Budget:** set `ai_monthly_budget` with the SQL in "AI configuration" above. The
   amount is in INR and is checked against the estimated cost before every user.
3. **Prices:** check that `ai_pricing` in `system_settings` has an entry for the model in
   `ai_model` at the provider's current prices; the budget check and cost figures use
   it. The app's figures are estimates in INR: the real charge is on the Anthropic
   Console's Usage page.
4. **First test:** sign in as an admin → Admin → Recommendations. A user is "Ready" when
   their profile is complete and they have a goal and a weekly workout capacity. Select
   **one test user** → **Process selected**.
5. **Verify:** the History table shows the attempt as Success with provider `anthropic`,
   the model, tokens and estimated cost; AI usage shows the spend. The user sees the
   recommendation on their Profile, in review for two days, and can accept it.
6. **Then** use "Process all ready". Processing is manual and monthly (target: the 4th);
   nothing runs automatically.

What to expect:

- **Budget reached:** processing stops, the page says "Monthly AI budget reached", and
  the remaining users stay pending. Raise the budget (or wait for the next month) and
  process again; users who already succeeded are not processed twice.
- **A user fails** (provider error, invalid reply): only that user is marked Failed with
  a reason; their previous recommendation stays active. Use "Retry failed".
- **Turning it off:** delete the `ai_monthly_budget` row, or
  `npx supabase secrets unset ANTHROPIC_API_KEY`.
- **Local development and tests** never call a real AI: `AI_PROVIDER=mock` in
  `supabase/functions/.env` selects the deterministic mock provider.

### Recovery

- **A bad frontend deployment:** Vercel → Deployments → the last good deployment →
  "Promote to Production" (instant rollback). The service worker shows users "A new
  version is available" and a reload picks it up. Fix forward in git afterwards.
- **A bad migration:** migrations are forward-only. Never edit or delete an applied
  migration and never reset the production database. Write a new migration that corrects
  the problem, test it on the local stack (`npm run db:reset && npm run db:test`), then
  `npx supabase db push`.
- **Backups:** automatic backups depend on the Supabase plan (Dashboard → Database →
  Backups; the free plan has none). Whatever the plan, take your own dump before a risky
  change: `npx supabase db dump --linked -f backup.sql` (schema) and
  `npx supabase db dump --linked --data-only -f data.sql` (data). Keep the files private:
  they contain personal data.
- **An Edge Function fails:** Dashboard → Edge Functions → the function → Logs shows the
  error code. Common causes:
  - `SERVER_ERROR` at once on every call: a secret is missing (`PIN_AUTH_SECRET`);
  - sign-in fails only from the website: `ALLOWED_ORIGINS` does not match the site's
    exact origin;
  - `PROVIDER_NOT_CONFIGURED` / `BUDGET_NOT_CONFIGURED`: AI is not enabled (above).

  To roll a function back, check out the last good commit and run
  `npx supabase functions deploy <name>`.

- **Nobody can sign in:** check the Supabase project is running (free projects pause when
  idle), then `pin-login`'s logs and secrets. `PIN_AUTH_SECRET` must never change: a
  different value invalidates every account until each PIN is reset.
- **Is production healthy?** `npm run smoke:deployment` with a designated test account
  (see the checklist). It is read-only.
- **Releasing a change:** run the checklist below; push migrations before or together
  with the frontend; deploy functions only when files under `supabase/functions/`, or
  the modules they import from `src/` and `scripts/lib/`, changed.

## Error handling and logging

- **Edge Functions** return error codes only (for example `INVALID_INPUT`,
  `FORBIDDEN`, `SERVER_ERROR`): never stack traces, SQL, keys or provider messages.
  Their logs record events, not request bodies, PINs, tokens, prompts or AI output.
- **Browser:**
  - production error screens show plain messages, never raw error text;
  - every form reports a failed save in plain words (onboarding included), keeps what
    was typed, and can be retried;
  - an unreachable server is reported as a connection problem, whichever client
    (database, Storage or Edge Function) made the request;
  - a save is always attempted, even when the browser reports it is offline, so it fails
    at once with that message instead of waiting silently for the connection;
  - the error boundary logs only the error's class name;
  - no debug logging remains (only development-mode logging);
  - expected errors are handled in the UI and not logged.

## Deployment checklist

### Before deployment

- [ ] `npm run format:check && npm run typecheck && npm run lint && npm test`
- [ ] `npm run build && npm run check:bundle` passes (no secrets, no source maps)
- [ ] `npm run functions:check && npm run functions:bundle` pass (Docker running)
- [ ] Local database verified: `npm run db:reset && npm run db:test && npm run test:integration && npm run db:test && npm run db:lint`
- [ ] Browser suites pass against `npm run preview:prod` (production build, real headers)
- [ ] Supabase project linked, and `db push --dry-run` reviewed
- [ ] Auth settings match `config.toml` (sign-up off, email provider on, confirmation off)
- [ ] Function secrets set: `PIN_AUTH_SECRET`, `ALLOWED_ORIGINS` (exact app origin), `ANTHROPIC_API_KEY` if AI is used
- [ ] `AI_PROVIDER` / `AI_MODEL` **not** set in production
- [ ] Edge Functions deployed (`supabase functions list` shows all three)
- [ ] `inbody-reports` bucket exists and is **private**
- [ ] Vercel has only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- [ ] First super admin created. Budget, pricing and nutrition tolerances reviewed.

### After deployment

- [ ] `npm run smoke:deployment` with `APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` and a
      designated **test** account (`SMOKE_PHONE`, `SMOKE_PIN`). It is read-only and
      checks: - headers, manifest, worker and SPA routes; - login, CORS and session refresh; - own data vs other users' data; - admin and AI functions refused for a normal user; - audit immutability; - storage privacy; - public sign-up disabled; - logout.
- [ ] In a browser, as test accounts: login → onboarding → Home, Food, Workout, Progress,
      Profile (InBody upload), Groups (join, view, leave), Recommendations review, then
      Admin (users, a correction, audit) as an admin test account, then logout.
- [ ] Install the PWA on a phone (Add to Home Screen). It opens standalone, and the
      session survives a restart.
- [ ] Manager test account: sees only the assigned user.
- [ ] After any release that adds a migration: `npx supabase db push --dry-run`, review
      the list, then `npx supabase db push` (before or together with the frontend
      deploy).
- [ ] If AI is enabled: process **one** designated test user. Check the attempt row
      (provider, model, tokens, cost) and the admin AI usage view. Do not process real
      users just to test.

## Verification status

What the MVP release is based on. The feature-by-feature status is in
[`release.md`](./release.md).

**Production** (Supabase project `eeltuzswkhsewtpepgsf`, Mumbai `ap-south-1`; Vercel
production domain `https://trackfitbuddy.vercel.app`), checked read-only on 12 Oct 2026:

- all 18 migrations are applied and the remote history matches the repository,
  including `20261011000100_inbody_orphan_cleanup` and
  `20261011000200_stale_correction_conflict` (the version check raises `PT409`);
- all three Edge Functions are active; `verify_jwt` is off for `pin-login` and on for
  the other two; the hosted gateway adds no CORS headers of its own;
- function secrets present: `PIN_AUTH_SECRET`, `ALLOWED_ORIGINS`, and since 12 Oct 2026
  `ANTHROPIC_API_KEY`. AI processing is enabled with a monthly budget of ₹84;
- row-level security is enabled on all 27 tables; clients have no direct privileges on
  `audit_logs`; every security-definer function has a fixed `search_path`;
- the `inbody-reports` bucket is private, with its size limit, allowed file types and
  three policies (read own, upload own, delete own unreferenced);
- Auth settings: public sign-up refused, confirmation off, phone and anonymous sign-ins
  off, Site URL set;
- the live site: every route (including nested ones) returns 200, a missing asset is a
  404, the manifest, icons and service worker are served, and the security headers and
  CSP are present;
- every file the live site serves was downloaded and scanned: no secrets, server code,
  source maps or environment files; configuration and source paths are not reachable;
- data integrity: no duplicate attempts, cycles, snapshots or active step entries; no
  future-dated or orphaned records; files and InBody reports match; no out-of-range
  values. The audit rows without an actor are system actions (migration defaults and
  the command-line creation of the first admin).

**Not yet in production** (added after that check): InBody CSV import. It needs
migration `20261013000100_inbody_csv_import` (`npx supabase db push`) and the
`inbody-import` function (`npx supabase functions deploy inbody-import`). It uses the
secrets that are already set and needs no new one. Until both are deployed, "Import
CSV" in the app answers "Couldn't import the CSV".

`public.rls_auto_enable` on the hosted database is not from this repository: it is a
Supabase platform helper (an event trigger that turns on row-level security for new
tables). It cannot be called through the API.

**Locally, on the same service versions as production** (PostgREST, Postgres, Auth and
Storage versions are taken from the linked project), with the production build served
under the `vercel.json` rules:

- all migrations from an empty database, the database tests, and the integration tests
  through the real API and Edge Functions;
- the Edge Function deploy bundles, booted with no project source;
- the real Claude provider's request and response handling against an imitation of the
  Messages API, including "refuses to start with no key or budget" and "an exhausted
  budget cannot be bypassed by calling the function directly". No paid request;
- a browser audit at 390, 768, 820, 1024 and 1440 px: layout, accessibility, sheets and
  dialogs, Progress loading, offline saves and page loads, a missing chunk after a
  deployment, and logout;
- a first-user simulation: admin-created account → onboarding → Home → food from the
  catalogue → workout → activity → steps → weight → Progress → a group → logout.

**Signed-in checks on the live site** need a designated test account; the PIN is given
to the command, never stored in the repository:

- `npm run smoke:deployment` (read-only): run by the project owner after the first
  deployment; all checks passed. Run it again after every release.
- A stale admin correction on production (two admins, one record) should answer at once
  with "This record changed since you opened it".

**Not verified:**

- installing the PWA on a physical phone;
- browsers other than current Chromium;
- deploying functions with `--use-api`.

Hosting notes:

- Use the stable production domain. Vercel's per-deployment URLs
  (`<project>-<hash>-<team>.vercel.app`) change on every deploy and sit behind Vercel's
  Deployment Protection, so they must not be used for `ALLOWED_ORIGINS` or the Site URL.
- A Supabase project's region cannot be changed. Moving region means a new project and
  repeating the setup steps.
- Once the CLI is linked to the project, `supabase start` runs the local stack with the
  **same service versions as production**. Run the database and integration suites on a
  linked checkout before a release: version differences are real (a stale admin
  correction once hung only on production's PostgREST version). After adding a file in
  a new directory to an Edge Function's imports, restart the local stack so the runtime
  can see it.
- The CLI can act for one account without changing a stored login: set
  `SUPABASE_ACCESS_TOKEN` for the command. Keep the token in a git-ignored file, and
  revoke it when it is no longer needed.
