# TrackFitBuddy

A mobile-first fitness, nutrition and self-analysis dashboard. Users log food, workouts,
activities, steps and weight, and review monthly recommendation cycles. It's a tracking and
analysis tool, not an enforcement-based coach. The full product and technical specification is in
[`spec.md`](./spec.md).

> **Status:** Phase 0 (foundation). Routing, layout shell, design tokens, providers, and the
> database schema with RLS are in place. Feature pages are placeholders.

## Tech stack

- **React 19** + **TypeScript** (strict) + **Vite**
- **Tailwind CSS v4** (via `@tailwindcss/vite`) with design tokens in `src/styles/globals.css`
- **shadcn/ui** primitives (configured in `components.json`; add components only as needed)
- **React Router** (data router), **TanStack Query**, **Zod**, **Recharts**
- **lucide-react** outline icons
- **Supabase** (Postgres, Auth, Storage, Edge Functions, RLS) as the backend

## Getting started

Requires Node.js 20.19+ (22 recommended).

```bash
npm install
cp .env.example .env   # then fill in your Supabase values
npm run dev            # http://localhost:5173
```

### Environment variables

| Variable                 | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `VITE_SUPABASE_URL`      | Supabase project URL                                  |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key; access is enforced by RLS |

Only `VITE_`-prefixed variables reach the browser bundle. **Never** put the Supabase
service-role key or any AI provider key in a `VITE_` variable. Those belong to Edge
Functions only. `.env` is git-ignored.

The app shell renders without Supabase configured. The first Supabase call throws a
descriptive configuration error if the variables are missing.

## Scripts

| Command                | Purpose                             |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Start the dev server                |
| `npm run build`        | Type-check and build to `dist/`     |
| `npm run preview`      | Serve the production build locally  |
| `npm run typecheck`    | TypeScript project check            |
| `npm run lint`         | ESLint (type-aware)                 |
| `npm run format`       | Format with Prettier                |
| `npm run format:check` | Verify formatting                   |
| `npm run db:start`     | Start local Postgres (needs Docker) |
| `npm run db:reset`     | Recreate DB from migrations         |
| `npm run db:test`      | Run database / RLS tests (pgTAP)    |
| `npm run db:lint`      | Lint database functions             |
| `npm run db:types`     | Regenerate `src/types/database.ts`  |

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
│   ├── ui/            shadcn/ui primitives
│   ├── common/        page structure, loading / empty / error states
│   └── charts/        Recharts theme derived from tokens
├── features/<name>/   feature-owned pages, components, hooks, types
├── lib/               env validation, typed Supabase client, query client, utils
├── types/             generated database types
├── constants/         routes, navigation, icon mapping, app name
└── styles/            globals.css (Tailwind + design tokens)
```

- **Routes** are grouped by access level (public auth, user app, admin) so session and role
  guards can be added per group. Security is enforced by Supabase RLS, not by routing.
- **Admin screens** are lazy-loaded.
- **Layout:** below `lg`, a top bar with the profile control plus a fixed bottom nav; at `lg`
  and up, a persistent sidebar and a wider content area.
- **Design tokens:** every colour comes from `@theme` tokens (`bg-surface-1`,
  `text-foreground-secondary`, `text-primary`, …). Typography utilities are `metric`
  (condensed display numbers), `label-mono` (dates and status metadata) and `label-section`.
- Feature code stays inside `features/<name>`. Code moves to `components/` or `lib/` only
  when it is genuinely shared.
