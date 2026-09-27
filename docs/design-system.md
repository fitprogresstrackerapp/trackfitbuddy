# Design system

Visual direction (spec §2, §92, §97): a dark, calm fitness intelligence dashboard. It gets
its character from hierarchy, typography, rules and spacing, not decoration.

Live reference (development only): run `npm run dev` and open **`/dev/design-system`**.
The route isn't registered in production builds.

## Where things live

| Folder                  | Contents                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/ui`     | Controls (shadcn/Radix-based, restyled): Button, IconButton, Input, Textarea, DatePicker, Select, Checkbox, RadioGroup, Toggle, Tabs, SegmentedControl, FilterControl, Dialog, Sheet, DropdownMenu, Toaster, Skeleton, Avatar, Label |
| `src/components/layout` | Page, PageHeader, Section, Panel, Divider, Breadcrumb                                                                                                                                                                                |
| `src/components/data`   | Metric, MetricBlock, StatRow, DataRow, ProgressBar, StatusBadge, TrendIndicator                                                                                                                                                      |
| `src/components/common` | States and form helpers: EmptyState, ErrorState, LoadingState, InlineAlert, FormField, AdornedInput, PlaceholderPage                                                                                                                 |
| `src/app/layouts`       | App shell (sidebar, rail, top bar, bottom nav, profile menu), admin shell, auth layout                                                                                                                                               |
| `src/lib/feedback.ts`   | `notify.success / error / warning / info` (toasts)                                                                                                                                                                                   |
| `src/lib/format.ts`     | `formatNumber` (en-IN grouping), `NO_VALUE`                                                                                                                                                                                          |

Feature-specific components stay in `src/features/<name>/components`.

## Tokens

Every colour comes from the tokens in `src/styles/globals.css`, which are the spec §2
palette. Don't add colours or use raw hex values in components.

- Radius is capped at 8px. Controls use `rounded-sm` (4px) and blocks use `rounded-md` (6px).
- Layout tokens: `--spacing-sidebar`, `--spacing-rail`, `--spacing-top-bar`,
  `--spacing-bottom-nav`, and `--container-content` (the maximum content width).

## Typography

| Utility         | Use                                                   |
| --------------- | ----------------------------------------------------- |
| `metric`        | Display numbers: calories, weight, steps, percentages |
| `heading-page`  | Page titles (HOME, FOOD …)                            |
| `heading-block` | Panel, dialog and block titles                        |
| `label-section` | Section labels and form labels                        |
| `label-mono`    | Metadata only: `SEP 21`, `CYCLE 03`, `TARGET`, `7D`   |
| body            | `text-sm` / `text-base` sans                          |

Use monospace only for metadata, never for body text.

## Composition

- A page reads top to bottom: `PageHeader`, then `Section` (a label with a rule), then
  blocks, then actions.
- Prefer rules and spacing to cards. Use `Panel` only when a group needs its own ground,
  and `variant="accent"` for the single most important block on a screen.
- Missing data is never shown as zero. Metrics render `—`, and progress bars render a
  hatched "no data" track (spec §68).
- A status is always icon plus text, never colour alone.
- **Buttons:** one `primary` per screen. Use `secondary` for alternatives, `ghost` for
  low-emphasis actions, and `destructive` for deletion. Icon-only buttons must use
  `IconButton`, which requires a `label`.
- **Feedback:**
  - Validation errors stay next to the field (`FormField`).
  - Persistent conditions use `InlineAlert` (locked, incomplete).
  - Completed actions get a toast via `notify`.
- **Overlays:** `Dialog` for confirmations. For mobile forms use `Sheet`, which is a bottom
  sheet below 768px and a right-hand panel above it. Both trap focus and close on Escape.

## Shell breakpoints

| Width      | Navigation                                                      |
| ---------- | --------------------------------------------------------------- |
| < 768px    | Top bar (brand, section, account menu) + bottom nav             |
| 768–1023px | Top bar + icon rail                                             |
| ≥ 1024px   | Full sidebar; Profile below a divider; account menu at its foot |

- The admin area has its own shell: a CONTROL sidebar with the spec §78 sections, and a
  scrolling section strip below 1024px.
- The admin entry appears only for ADMIN and SUPER_ADMIN, in the sidebar or the account
  menu. This is navigation only; access is enforced by guards and RLS.

## Motion and accessibility

- Motion is limited to state transitions (≈150ms), overlay entrances (≤220ms) and progress
  fills. There are no looping animations, and `prefers-reduced-motion` disables all motion.
- Every page has a skip link, labelled navigation landmarks, `aria-current` on the active
  item and visible focus rings. Progress bars carry `aria-valuenow` and `aria-valuetext`.
