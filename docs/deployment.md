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
   - the private `inbody-reports` bucket: 10 MB limit; PDF, JPEG, PNG, WebP or HEIC;
     own-folder policies.

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
   npx supabase functions deploy pin-login admin-users process-recommendations
   ```
   - **Bundling:** use the default Docker bundling. Docker must be running, and
     `--use-api` is not verified.
   - **Shared code:** `process-recommendations` and `admin-users` import code from
     `src/` and `scripts/lib/`. The CLI bundles those modules into each function.
     `npm run functions:bundle` proves this locally: it bundles each function with the
     same edge-runtime bundler, then boots each bundle in a container with **no project
     source** and checks CORS and unauthenticated handling.
   - **JWT verification:** `config.toml` sets `verify_jwt = false` for `pin-login` (its
     callers aren't signed in yet); the other two verify the JWT at the gateway and
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
  - `ai_provider = "anthropic"`, `ai_model = "claude-opus-5"`;
  - `ai_prompt_version = "recommendation-v1"`;
  - `ai_pricing` (INR per million tokens, used for cost estimates and budget checks);
  - `ai_max_retries`, `ai_max_output_tokens`, `ai_request_timeout_seconds`.
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

  A live Claude request has **not** been made. See the checklist.

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

**Verified locally** (Docker Supabase stack, production build served with the
`vercel.json` rules):

- all migrations applied to a fresh database;
- pgTAP, integration and storage tests;
- the Edge Function deploy bundles, run standalone;
- the real-provider contract;
- the PWA (installability, the worker, what it caches, updates, offline shell);
- CSP and headers, and direct navigation on every route;
- every browser suite against the production build.

**Verified against cloud infrastructure** (Supabase project `eeltuzswkhsewtpepgsf` in
Mumbai, `ap-south-1`; Vercel production domain `https://trackfitbuddy.vercel.app`):

- `db push`: the 16 migrations up to `20261007000100` applied to the fresh hosted database, the remote history
  matches the repository, and `db lint --linked` reports no errors;
- `supabase functions deploy` (Docker bundling) for all three functions, including the
  two that import shared code from `src/` and `scripts/lib/`;
- the hosted gateway: `verify_jwt` is off for `pin-login` and on for the other two, and
  it adds no CORS headers of its own, so the functions' allow-list decides;
- CORS: only the production origin is allowed, on all three functions;
- Auth settings: public sign-up refused, confirmation off, phone and anonymous sign-ins
  off, Site URL set;
- anonymous access: no profile reads, no public access to the `inbody-reports` bucket;
- the Vercel build: it passes the build guard and bundle scan with Vercel's
  `VITE_VERCEL_*` system variables present, and none of them is in the published bundle;
- the live site: every route (including nested ones) returns 200, a missing asset is a
  404, the manifest and service worker are served, and the security headers and CSP are
  present;
- sign-in as the super admin, and `npm run smoke:deployment` with a designated test
  account (run by the project owner; all checks passed).

Hosting notes:

- Use the stable production domain. Vercel's per-deployment URLs
  (`<project>-<hash>-<team>.vercel.app`) change on every deploy and sit behind Vercel's
  Deployment Protection, so they must not be used for `ALLOWED_ORIGINS` or the Site URL.
- A Supabase project's region cannot be changed. Moving region means a new project and
  repeating the steps above (which is how this project moved from Tokyo to Mumbai before
  any real data existed).
- Once the CLI is linked to the project, `supabase start` runs the local stack with the
  **same service versions as production** (PostgREST, Postgres, Auth, Storage). Run the
  database and integration suites on a linked checkout before a release: version
  differences are real (the stale-correction hang above only appears on production's
  PostgREST version). After adding a file in a new directory to an Edge Function's
  imports, restart the local stack so the runtime can see it.
- The CLI can act for one account without changing a stored login: set
  `SUPABASE_ACCESS_TOKEN` for the command. Keep the token in a git-ignored file, and
  revoke it when it is no longer needed.

**Production hardening release** (reliability and UX fixes; see the commit "harden
production reliability and UX"). Verified locally on the production build at 390, 768,
820, 1024 and 1440 px:

- Progress range switching, loading and error states;
- sheets and dialogs (fit, focus trap, Escape, no loss of input on a backdrop tap);
- accessibility probes on every page;
- offline saves and page loads, a missing chunk after a deployment, and logout.

The release adds two migrations, which must be pushed to the production database
(checklist above):

- `20261011000100_inbody_orphan_cleanup.sql`: until it is pushed, a refused InBody upload
  is still rejected up front by validation, but a file whose record fails for another
  reason is not removed.
- `20261011000200_stale_correction_conflict.sql`: **a production bug fix.** Until it is
  pushed, a stale admin correction (two admins correcting the same record) hangs
  instead of reporting the conflict, because production's PostgREST version retries the
  old error code.

**Still not verified:**

- a live Claude request: `ANTHROPIC_API_KEY` is not set and `ai_monthly_budget` is null,
  so AI processing is off. To enable it, set the key and a budget, then process one
  designated test user;
- installing the PWA on a physical phone;
- the browser walkthrough of every feature on the live site (After deployment, second
  item). The automated browser audit runs against the production build with the local
  database, not against the live site;
- deploying functions with `--use-api`.
