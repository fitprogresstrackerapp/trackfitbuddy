# TrackFitBuddy

A mobile-first fitness, nutrition and self-analysis dashboard. Users log food, workouts,
activities, steps and weight, and review monthly recommendation cycles. It's a tracking and
analysis tool, not an enforcement-based coach. The full product and technical specification is in
[`spec.md`](./spec.md).

> **Status:** Foundation, database with RLS, phone + PIN login with onboarding, the design
> system and shell, and the Home dashboard are in place. Food, Workout, Progress, Groups,
> Profile and Admin are placeholders.

## Tech stack

- **React 19** + **TypeScript** (strict) + **Vite**
- **Tailwind CSS v4** (via `@tailwindcss/vite`) with design tokens in `src/styles/globals.css`
- **shadcn/ui** primitives (configured in `components.json`; add components only as needed)
- **React Router** (data router), **TanStack Query**, **Zod**, **Recharts**
- **lucide-react** outline icons
- **Supabase** (Postgres, Auth, Storage, Edge Functions, RLS) as the backend

## Getting started

Requires Node.js 20.19+ (22 recommended).

Requires Docker for the local Supabase stack.

```bash
npm install
cp supabase/functions/.env.example supabase/functions/.env   # set PIN_AUTH_SECRET (≥ 32 chars)
npm run supabase:start                                       # DB, Auth, REST, Edge Functions
cp .env.example .env                                         # URL + anon key from `npx supabase status`
npm run user:create -- --local --phone 9876543210 --pin 1234 # first account
npm run dev                                                  # http://localhost:5173
```

See [`docs/auth.md`](./docs/auth.md) for how login, sessions and onboarding work.

### Environment variables

| Variable                 | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `VITE_SUPABASE_URL`      | Supabase project URL                                  |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key; access is enforced by RLS |

Only `VITE_`-prefixed variables reach the browser bundle. **Never** put the Supabase
service-role key or any AI provider key in a `VITE_` variable. Those belong to Edge
Functions only. `.env` is git-ignored.

If the variables are missing or invalid, the app shows a descriptive configuration error
at startup.

## Scripts

| Command                    | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `npm run dev`              | Start the dev server                           |
| `npm run build`            | Type-check and build to `dist/`                |
| `npm run preview`          | Serve the production build locally             |
| `npm run typecheck`        | TypeScript project check                       |
| `npm run lint`             | ESLint (type-aware)                            |
| `npm run format`           | Format with Prettier                           |
| `npm run format:check`     | Verify formatting                              |
| `npm run test`             | Unit and component tests (Vitest)              |
| `npm run test:integration` | Auth/RLS tests against the local stack         |
| `npm run check:bundle`     | Scan `dist/` for server secrets                |
| `npm run supabase:start`   | Local DB, Auth, REST, Edge Functions           |
| `npm run functions:serve`  | Edge Functions with hot reload                 |
| `npm run functions:check`  | `deno check` + `deno lint` for functions       |
| `npm run user:create`      | Create an account / reset a PIN (service role) |
| `npm run db:start`         | Start local Postgres only (needs Docker)       |
| `npm run db:reset`         | Recreate DB from migrations                    |
| `npm run db:test`          | Run database / RLS tests (pgTAP)               |
| `npm run db:lint`          | Lint database functions                        |
| `npm run db:types`         | Regenerate `src/types/database.ts`             |

## Design system

Tokens, typography, components and shell conventions: [`docs/design-system.md`](./docs/design-system.md).
Development-only live reference at `/dev/design-system`.

## Home

Data sources and rules for the Home dashboard: [`docs/home.md`](./docs/home.md).

## Database

Schema, RLS, historical snapshots, locking and audit are documented in
[`docs/database.md`](./docs/database.md). Migrations live in `supabase/migrations/`.

## Architecture

```
src/
├── app/
│   ├── router/        route tree, error + not-found pages
│   ├── providers/     global providers (error boundary, TanStack Query)
│   └── layouts/       root, auth, app (sidebar / top bar / bottom nav), admin
├── components/
│   ├── ui/            controls (shadcn/Radix, restyled)
│   ├── layout/        Page, Section, Panel, Divider, Breadcrumb
│   ├── data/          Metric, DataRow, ProgressBar, StatusBadge, TrendIndicator
│   ├── common/        states (empty / error / loading), form helpers
│   └── charts/        Recharts theme derived from tokens
├── features/<name>/   feature-owned pages, components, hooks, types
├── lib/               env validation, typed Supabase client, query client, utils
├── types/             generated database types
├── constants/         routes, navigation, icon mapping, app name
└── styles/            globals.css (Tailwind + design tokens)
```

- **Routes** are grouped by access level (guest, onboarding, user app, admin) behind guards
  in `src/app/router/guards.tsx`. Security is enforced by Supabase RLS, not by routing.
- **Admin screens** are lazy-loaded.
- **Layout:** mobile top bar + bottom nav (< 768px), icon rail (768–1023px), full sidebar
  (≥ 1024px); content width is capped.
- **Design tokens:** every colour comes from `@theme` tokens (`bg-surface-1`,
  `text-foreground-secondary`, `text-primary`, …). Typography utilities are `metric`
  (condensed display numbers), `label-mono` (dates and status metadata) and `label-section`.
- Feature code stays inside `features/<name>`. Code moves to `components/` or `lib/` only
  when it is genuinely shared.
