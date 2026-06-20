# Clarifi UI Redesign — Design Reference

> Extracted from the reference screenshots in `docs/screenshots/` (a clean,
> data-dense admin/dashboard design system). This document captures the visual
> language in enough detail to redesign Clarifi's web UI against it, and maps
> each pattern onto Clarifi's actual screens.
>
> **Status:** reference / design spec. Not yet implemented — current web app uses
> bare `slate-*` Tailwind defaults with no design tokens (`globals.css` and
> `tailwind.config.ts` `extend` are both empty).

---

## 1. Design language at a glance

The reference is a **light, professional, card-based dashboard system**. Defining
traits:

- **Airy and clean** — white cards on a very light cool-gray canvas, generous
  whitespace, thin hairline borders instead of heavy shadows.
- **Data-dense but calm** — lots of numbers, but organized into tidy KPI tiles,
  tables with uppercase headers, and small multiples (sparklines/mini-charts).
- **One confident accent** — a single bright royal blue carries all interaction
  (buttons, links, active tabs, sparklines, progress fills); everything else is
  neutral gray + semantic green/red.
- **Sharp, not rounded** — small border radii (~4–6px), almost rectangular cards.
- **Quiet typographic hierarchy** — tiny UPPERCASE letter-spaced micro-labels for
  section/column headers; large bold numbers for the values that matter.

This is a strong fit for a fintech product: it reads as trustworthy, precise, and
"bank-grade" without being cold.

---

## 2. Color palette

Cool-neutral grays + one royal-blue accent + green/red semantics + a soft
multi-hue set for categorical charts.

### Core neutrals
| Token | Hex (approx) | Use |
|-------|--------------|-----|
| `canvas` | `#F4F6FA` | App background behind cards |
| `surface` | `#FFFFFF` | Cards, modals, tables, inputs |
| `border` | `#E3E7EF` | Hairline card/table/input borders |
| `border-strong` | `#CDD4E0` | Input borders, dividers on hover |
| `text` | `#1C273C` | Headings, primary numbers |
| `text-muted` | `#7A8499` | Body copy, secondary text |
| `text-faint` | `#A9B0BF` | Placeholders, disabled, captions |

### Accent (interaction)
| Token | Hex (approx) | Use |
|-------|--------------|-----|
| `primary` | `#0168FA` | Buttons, links, active tab, sparklines, progress fill, focus ring |
| `primary-hover` | `#0155D4` | Hover state |
| `primary-ink` | `#10183A` | Dark-navy solid button (the Sign In primary CTA) |

> Two primary-button styles appear in the refs: a **dark navy** solid (auth Sign In)
> and a **bright blue** solid (dashboard "Generate Report", modal CTAs). Pick one as
> the canonical primary — recommend **bright blue** for in-app actions, reserving
> navy for the marketing/auth entry — or standardize on blue everywhere for simplicity.

### Semantic
| Token | Hex (approx) | Use |
|-------|--------------|-----|
| `success` | `#2DCB75` | Positive deltas (↑), "Completed", inflow/income |
| `danger` | `#DC3545` | Negative deltas (↓), critical anomalies, outflow emphasis |
| `warning` | `#FBB454` | Warnings, budget-approaching alerts |
| `info` | `#1AB6E8` | Informational accents |

### Categorical / chart palette (soft)
Used for chart segments, category tags, and tinted event blocks. Each has a strong
line color and a ~12% tint for fills/backgrounds:
`blue #0168FA`, `teal #00D6E6`, `green #2DCB75`, `amber #FBB454`,
`pink #F1556C`, `purple #6F42C1`.

Tinted block backgrounds (as in the events widget): the same hues at very low
opacity (`~8–12%`) with a 3px solid left border in the full hue.

---

## 3. Typography

- **Family:** clean neutral grotesque / system sans. Use `Inter` (or `IBM Plex Sans`)
  as the closest free match to the reference.
- **Scale (suggested):**
  | Role | Size / weight | Notes |
  |------|---------------|-------|
  | Page title | 20–24px / 600 | e.g. "Welcome to Dashboard" |
  | Card title | 15–16px / 600 | e.g. "Sales Revenue" |
  | KPI value | 28–34px / 700 | the big numbers |
  | Body | 13–14px / 400 | `text-muted` |
  | **Micro-label** | **11px / 600, UPPERCASE, +0.04em tracking** | section headers, table column heads, field labels ("CONVERSION RATE", "CARD NUMBER", "GETTING STARTED") |
  | Delta | 11–12px / 600 | colored success/danger, often with ↑/↓ |
  | Breadcrumb | 11px / 600 UPPERCASE | active crumb in `primary` |

The **UPPERCASE micro-label** is the single most recognizable signature of this
system — use it for every section header, table column header, and form field label.

---

## 4. Spacing, shape, elevation

- **Radius:** `4px` (inputs, small) / `6px` (cards, buttons). Keep it tight.
- **Borders:** `1px solid border`. This system favors borders over shadows.
- **Shadow:** none-to-minimal. A barely-there `0 1px 2px rgba(28,39,60,0.04)` on
  cards is the ceiling; modals get a slightly stronger one.
- **Card padding:** ~20–24px. Section header sits inside the card, separated from
  content by a hairline divider (as in the contacts/events/todo widgets).
- **Grid:** centered content, comfortable gutters (~24px). Dashboard uses a 4-up
  KPI row, then 2-up chart row, then mixed 2/3-up widget rows.

---

## 5. Component catalogue (from the refs)

### 5.1 KPI / metric tile
`[UPPERCASE LABEL]` → `[big value]` → `[↑1.2% than last week]` + inline **sparkline**.
Four across the top of the dashboard. Delta colored green/red. This is the hero
pattern — Clarifi should lead its dashboard with these.

### 5.2 Buttons
- **Primary solid:** filled blue (or navy), white text, 6px radius, ~38–40px tall.
  Small variant for toolbar actions uses UPPERCASE label ("GENERATE REPORT").
- **Outline:** white bg, 1px border, dark text ("EMAIL", "PRINT", "Cancel").
- **Ghost/link:** plain blue text ("Learn More", "Forgot password?", "View All →").
- Trailing `→` arrow on navigational links ("View All Contacts (525) →").

### 5.3 Inputs & forms
- UPPERCASE field label above the control; 1px border; faint placeholder
  ("Enter card number"); blue focus ring. Two-up rows for related fields
  (Expiry / Secure code). Inputs are rectangular with 4px radius.

### 5.4 Tables
- UPPERCASE column headers, left-aligned text / **right-aligned numbers**.
- Hairline row separators, no zebra. Numeric deltas colored green/red inline
  ("+$32,580.00 ↑6.5%"). Compact row height. Used for earnings, sales-by-state,
  performance breakdown.

### 5.5 Tabbed widget
Horizontal tabs with a **blue underline on the active tab**, muted inactive labels
("Performance Score | Rating | Activities"), a close ✕ at top-right when in a panel.

### 5.6 Segmented score bar + legend
A single horizontal **stacked multi-color bar** (each segment a categorical hue),
above a legend table: colored ring/dot • label • count • %. Excellent fit for
Clarifi's **spending-by-category** breakdown.

### 5.7 Progress bar
Thin track, blue fill, **% label at the right**, optional avatars/tags below
(todo widget). Use for **budget progress** (with success→warning→danger fill as it
approaches/exceeds 100%).

### 5.8 List row
Avatar/round icon + title + subtitle on the left, value/status/timestamp on the
right ("Completed" in green). Used for contacts, transaction history, new customers.
This is Clarifi's **transaction list** and **anomaly feed** pattern.

### 5.9 Activity feed
Avatar + name + relative timestamp ("5 hours ago") + a content card beneath. Good
basis for Clarifi's **anomaly explanations** and **notifications** timeline.

### 5.10 Modal
Header (title + one-line subtitle + ✕), hairline divider, body, footer right-aligned
actions (`Cancel` outline + `Save Info` primary). Used for billing, "First Visit
Metrics" (image-split promo modal), create-account.

### 5.11 Date-stub event block
A `DAY / 03` date stub + a tinted block with a colored left border, color-coded by
type. Niche, but a nice motif for **upcoming bills / recurring transactions**.

### 5.12 Auth screens
Minimal, left-aligned, no card chrome: title + subtitle, UPPERCASE-labeled fields,
full-width solid primary, an "OR" divider, social buttons (outline), and a
"Don't have an account? Create one" footer link. Maps directly to Clarifi
sign-in / sign-up.

---

## 6. Mapping the reference onto Clarifi's screens

Clarifi's real surfaces (from `apps/web/src/app`) and the patterns to apply:

| Clarifi screen | Apply |
|----------------|-------|
| **Sign in / Sign up** (`(auth)/`) | §5.12 auth layout; UPPERCASE field labels; one solid primary. Drop social buttons unless real. |
| **App shell** (`components/app-shell.tsx`) | Top bar with logo + nav; consider a left sidebar nav (refs are sidebar-or-topbar). Active nav item in `primary`. `canvas` bg, `surface` cards. |
| **Dashboard** (`(app)/dashboard`) | §5.1 KPI row (e.g. Total spend, Income, Net, Top category) → §5.2 spending trend area chart → §5.6 category breakdown bar+legend → §5.8 recent-transactions list. This is the closest 1:1 to the reference dashboards. |
| **Budgets** (`dashboard/budgets`) | §5.7 progress bars per category with success→warning→danger fill at 80%/100% (ties to Epic 8 budget alerts). |
| **NL Query chat** (Epic 6) | §5.9 activity-feed framing for Q→A turns; echo the interpretation in a quiet `text-muted` caption; render results as a §5.4 table or §5.6 chart. |
| **Anomaly feed** (Epic 5) | §5.8 list rows with severity color (info/warning/critical → border/dot color); §5.9 feed for the async plain-English explanation; dismiss/report actions as §5.2 outline buttons. |
| **Notifications** (`notification-bell`) | §5.9 activity feed in a dropdown/panel; unread dot in `primary`. |
| **Consents dashboard** (`(app)/consents`, Epic 7) | §5.8 list of connected providers/scopes with status pills; revoke as a `danger` outline action; §5.10 modal for grant/scope detail. |
| **Account / data deletion** (Epic 1.6) | Form layout §5.3; destructive delete as `danger` primary inside a §5.10 confirm modal. |

---

## 7. Fintech-specific adaptations (respect the guardrails)

The reference is generic SaaS; Clarifi adds money rules from `CLAUDE.md`:

- **Money formatting at the display layer only.** Values arrive as integer cents;
  format to dollars in the component (use `@clarifi/shared/money-display`
  `formatCents`). Never do math in the UI.
- **Signed amounts:** inflow positive → `success`; outflow negative → `text` (not
  alarming red by default — reserve `danger` for anomalies/over-budget, not for
  every expense).
- **Per-currency, never summed across currencies.** KPI tiles and tables must label
  currency (CAD primary; USD broken out / "approx"). Don't render a blended total.
- **No PII in any logged/screenshot surface;** category provenance can surface as a
  small tag (user/rule/llm/merchant_cache) on a transaction row if desired.

---

## 8. Suggested implementation path (when redesign is greenlit)

1. **Tokens first.** Put the palette + type scale into `tailwind.config.ts`
   `theme.extend` (colors, fontFamily, radii) and CSS variables in `globals.css`.
   Wire `Inter`. This file is currently empty — it's the natural starting point.
2. **Primitives.** Restyle `ui/button`, `ui/card`, `ui/input` to the spec
   (radii, borders, UPPERCASE labels). Add `ui/kpi-tile`, `ui/stat-delta`,
   `ui/progress`, `ui/segmented-bar`, `ui/badge`, `ui/modal`, `ui/table`.
3. **Shell.** Apply `canvas`/`surface`, restyle `app-shell` nav (active = primary).
4. **Screen by screen**, dashboard first (highest reference fidelity), per §6.
5. Keep it a **presentational** redesign — Tier 1 per screen as long as no data/
   guardrail logic changes. Touching money formatting, currency labels, or anything
   in §7 escalates per the guardrail tripwire.

---

*Reference images: `docs/screenshots/` (10 shots — dashboards, profile, help center,
auth, modals, score widget, contacts/events/todo).*
