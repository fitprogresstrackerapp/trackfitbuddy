# Authentication and onboarding

Phase 1 login is **phone number + 4-digit PIN** (spec §5). There's no OTP, SMS, email or
social login, and no self-registration. Admins create accounts.

## Architecture

```
Browser ──POST {phone, pin}──▶ Edge Function pin-login (service role)
                                 │ 1. validate shape (E.164 phone, 4 digits)
                                 │ 2. public.auth_verify_pin(phone, pin)
                                 │      bcrypt check + per-phone lockout (Postgres)
                                 │ 3. Supabase Auth sign-in with a server-derived password
Browser ◀── access + refresh token ┘
Browser: supabase.auth.setSession(tokens) → normal Supabase session, RLS applies
```

- **The PIN never reaches Supabase Auth.** Only `auth_verify_pin` checks it. PINs are
  stored in `private.user_pins` as bcrypt hashes (`pgcrypto`, cost 10). The `private`
  schema isn't exposed through the Data API and isn't granted to `anon` or
  `authenticated`.
- **The Supabase Auth credential isn't the PIN.** Each account's auth identity is:
  - email: `<user id>@phone-pin.invalid` (synthetic, never delivered);
  - password: `HMAC-SHA256(PIN_AUTH_SECRET, user id)`.

  Nobody knows or types this password. Only server code holding `PIN_AUTH_SECRET` can
  derive it, and that code does so only after the PIN is verified. The PIN itself is
  rejected by Supabase Auth, and there are integration tests for this.

- **Sessions are ordinary Supabase sessions.** They are refreshed by supabase-js, so RLS,
  `auth.uid()` and token refresh work as usual. No custom JWTs are signed anywhere.
- **Lockout:** 5 failed attempts within 15 minutes lock that phone number for 15 minutes.
  Attempts are tracked per phone, including unknown numbers, so a lockout doesn't reveal
  whether an account exists. Resetting the PIN clears the lockout.
- **Generic errors:** an unknown phone and a wrong PIN give the same response
  (`INVALID_CREDENTIALS`). `ACCOUNT_DISABLED` is returned only after a correct PIN.
- **Self-registration is off:** `[auth] enable_signup = false`. The email provider has to
  stay enabled because the bridge signs in through it (see the comment in
  `supabase/config.toml`).

### Where the code lives

| Concern                                | Location                                                         |
| -------------------------------------- | ---------------------------------------------------------------- |
| PIN storage, verification, lockout     | `supabase/migrations/20260928000100_pin_authentication.sql`      |
| Login endpoint                         | `supabase/functions/pin-login/index.ts` (Deno)                   |
| Auth-password derivation (server only) | `supabase/functions/_shared/pin-auth.ts`                         |
| Account provisioning (service role)    | `scripts/lib/provision-user.ts`, CLI `scripts/create-user.ts`    |
| Session / account state                | `src/features/auth/auth-provider.tsx`, `auth-context.ts`         |
| Route guards                           | `src/app/router/guards.tsx`, tree in `src/app/router/routes.tsx` |
| Login UI                               | `src/features/auth/pages/login-page.tsx`                         |
| Onboarding UI and saving               | `src/features/profile/`                                          |

## Secrets

| Secret                      | Where                                           | Never in               |
| --------------------------- | ----------------------------------------------- | ---------------------- |
| `PIN_AUTH_SECRET`           | Edge Function secrets, provisioning machine     | browser, `VITE_*`, git |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions (injected), provisioning machine | browser, `VITE_*`, git |
| anon key                    | browser (`VITE_SUPABASE_ANON_KEY`)              | —                      |

- Local: `supabase/functions/.env` (git-ignored). The template is
  `supabase/functions/.env.example`.
- Hosted: `npx supabase secrets set PIN_AUTH_SECRET=…`.
- Rotating `PIN_AUTH_SECRET` requires re-deriving every user's auth password.
- `npm run check:bundle` fails the build check if a service-role JWT, a secret API key or a
  server secret appears in `dist/`.

## Creating accounts

Until the Admin UI exists, accounts are created from a trusted machine:

```bash
# Local stack
npm run user:create -- --local --phone 9876543210 --pin 1234 --role SUPER_ADMIN
npm run user:create -- --local --phone 9876543210 --pin 4321 --reset-pin

# Hosted project: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and PIN_AUTH_SECRET instead of --local
```

The account starts with an incomplete profile, and the user completes onboarding on first
login. Avoid leaving real PINs in shell history.

## Session state and routing

`AuthProvider` is the single source of truth:

- **Session:** from Supabase Auth (`getSession` and `onAuthStateChange`).
- **Account:** profile, roles and readiness (`profile_readiness` view), all read through
  RLS. It's re-checked on window focus and every 5 minutes.
- **Deactivated or deleted account:** RLS hides the profile from its owner. The provider
  treats a missing profile as "account unavailable", ends the session and shows _This
  account is not active_ on the login page.
- **Cache isolation:** the whole TanStack Query cache is cleared whenever the signed-in
  user changes, including logout and expiry.
- **Logout:** `signOut({ scope: 'local' })` revokes this device's refresh token, clears the
  cache and replaces history with `/login`. The next login starts at Home.

| Route                                                        | Guard                                |
| ------------------------------------------------------------ | ------------------------------------ |
| `/login`                                                     | signed-out only                      |
| `/onboarding`                                                | signed in and profile incomplete     |
| `/`, `/food`, `/workout`, `/progress`, `/groups`, `/profile` | signed in and profile complete       |
| `/admin/*`                                                   | above, plus `ADMIN` or `SUPER_ADMIN` |

Guards only decide what to render. Authorization is enforced by RLS and server functions.

## Onboarding

Two steps, each saved when completed. A refresh resumes at the first incomplete step.

1. **Basic information:** name, date of birth (age is derived and never stored), and gender
   (Male, Female, Other, Prefer not to say). Written directly to `profiles` under RLS.
2. **Body measurements:** height (cm) and current weight (kg), saved through
   `save_onboarding_measurements()` in one transaction. The weight becomes today's
   `MANUAL` row in `weight_measurements`. Retries and double submits update that row
   instead of adding another.

Client validation (Zod) uses human ranges: age 13–100, height 100–250 cm, weight 25–300 kg.
The database enforces hard limits independently (constraints and triggers).

Readiness comes from the database view `profile_readiness`: name, date of birth, gender,
height and a current weight. Optional profile fields never block entry.

## Local development

```bash
npm run supabase:start   # DB, Auth, REST, gateway, Edge runtime (serves pin-login)
npm run functions:serve  # optional: hot reload while editing functions
npm run dev
```

The frontend `.env` needs only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see
`npx supabase status`).
