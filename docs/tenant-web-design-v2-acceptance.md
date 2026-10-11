# Tenant Web Design v2 — Acceptance

Owner request (2026-10-11): make the tenant app's **Dashboard Overview** and
**Billing** pages advanced, modern, powerful and super responsive. This is a
presentation-only upgrade of `apps/web`: **no API change, no schema change, no
new backend data, no new dependency.** The Admin Console's Design v2
(`apps/admin` globals) is the quality reference; the tenant app stays a light,
bright, Bengali-first merchant product.

## Design tokens & system (apps/web/src/app/globals.css)

Everything is **additive** — every pre-existing class name keeps its exact
legacy definition, so untouched pages inherit the base polish without breaking:

- New `:root` tokens: `--surface`, `--surface-muted`, `--border-soft`,
  `--ink-strong/body/muted/faint`, `--radius-card`, `--shadow-card-v2`,
  `--shadow-pop`, and brand derivations `--brand-soft`, `--brand-soft-strong`,
  `--brand-ring` computed with `color-mix()` **from the existing
  `--brand-from`/`--brand-to`** — so the M59 white-label per-org colour keeps
  flowing into every v2 surface with zero extra code.
- New primitives: `.skeleton` (+ `skel-wave` shimmer), `.hero-panel`,
  `.hero-chip`, `.stat-card` + `.stat-icon` (brand/green/amber/sky) +
  `.stat-label/.stat-value/.stat-hint`, `.quick-action`, `.meter` +
  `.meter-fill` (`-ok/-warn/-danger` tones), `.plan-card` +
  `.plan-card-current`, `.alert` (`-red/-amber/-green/-slate`), `.pay-card`.
- Base polish: tap-highlight removed; a global `prefers-reduced-motion`
  block settles all animation/transition (shimmer, rise-in, meter sweeps).

## Overview page (`/dashboard`) — what changed

Same three fetches as before (analytics overview for the last 7 days,
`ai/reports`, `ai/anomalies`) plus the org row (`GET /organizations/:id`) —
the **same endpoint the dashboard shell itself already calls** for M59
branding — used only so the hero can show the org's real name.

- **Hero strip** (`.hero-panel`): time-of-day Bengali greeting (presentation,
  not data), org/brand name, full Bengali date, and four quick-action tiles to
  real destinations (Inbox, Campaign Builder, Orders, AI Assistant).
- **KPI stat cards** with icon chips, every figure from the same overview
  payload as before: Revenue 7d (hint: order count), Orders 7d (hint: average
  order value from `totals.averageOrderValueMinor`), Ad Spend 7d (hint: MER
  from `kpis.mer`, or an explicit no-data hint when MER is null),
  Contribution Profit (hint: `profit.cogsCoverage.percent`). **No deltas or
  trends are shown** — the payload carries one period only, so none are
  invented.
- **Real-data chart**: inline SVG (no chart library) drawn from the payload's
  own `dailySeries` — revenue area+line and ad-spend dashed line, one dot per
  API-returned day with a tooltip of that day's real orders/revenue/spend,
  gridlines and a "সর্বোচ্চ দিন" max label. If the series is empty or all
  zero, the card says so honestly instead of drawing an empty chart.
- **Top campaigns** list from the payload's `campaigns` array (top 5 by
  spend; platform badge, spend, ROAS with `—` when null). Hidden when empty.
- Onboarding checklist card preserved behaviour-for-behaviour (still hides
  when `allDone`) with a progress bar added; latest AI report and anomaly
  cards keep their exact data, texts and empty states, restyled.
- Loading state is now skeleton cards instead of a "লোড হচ্ছে..." line.

## Billing page (`/dashboard/billing`) — what changed

One fetch, same as before: `GET /organizations/:id/billing`. **All flows are
byte-for-byte the same logic** — `requestPlan` (plan-request POST),
`buyOnline` (checkout POST → gateway redirect / `viaCredit` reload),
`previewCoupon`, `openInvoice` (authenticated blob fetch) — and the handlers
still read the same DOM ids: `pay-phone`, `pay-gateway`, `pay-coupon`,
`pay-coupon-plan`, `plan-note`.

- **Current-plan hero** (`.hero-panel`): plan name, status pill
  (ACTIVE green / TRIALING amber / PAST_DUE red / other slate), real price
  and period-end date, plus a **days-left counter computed from the real
  `currentPeriodEnd`** (past end reads "দিন পেরিয়ে গেছে").
- **Usage meters**: seats (`usage.seatsUsed` vs `limits.seats`) and today's
  AI calls (`usage.aiCallsToday` vs `limits.aiDaily`) render as progress
  bars whose width is exactly the payload ratio (display-capped at 100%),
  tone amber ≥80%, red ≥100%; `seats: null` renders "সীমাহীন" with no bar.
  **Broadcasts deliberately get NO percentage bar**: `limits.broadcastCap`
  is a per-send recipient cap, not a 30-day quota, so a usage-vs-cap bar
  would be a fake percentage. The row shows the real 30-day count and
  explains the cap in words.
- **Plan catalogue**: modern pricing cards; the current plan is highlighted
  (brand ring + soft gradient + "বর্তমান প্ল্যান" pill) with a disabled CTA;
  other plans keep the exact same actions (online buy only when the plan is
  paid and a gateway is on, plus "অনুরোধ পাঠান"). Gateway/coupon form keeps
  all ids and the no-gateway warning.
- **Payment history**: responsive — a `.table-wrap` table at ≥720px, and
  stacked `.pay-card` cards below 720px (amount, date, method, refund line,
  reference, period end, full-width invoice button). Rows are the real
  `payments` array only; the empty state is unchanged and honest.
- Credit banner, gateway-return banners and the Milestone 41 referral card
  are preserved (referral logic untouched; container restyled only).
- Loading state is skeletons instead of a plain text line.

## Responsiveness approach

- Mobile-first grids: KPI cards 1-col → 2-col at 420px → 4-col at xl;
  pricing cards 1 → 2 (sm) → 4 (xl); usage meters stack → 3-col at md;
  hero content wraps; quick actions are a 2-col grid on phones.
- Payment table switches to cards below 720px (no sideways page scroll);
  the chart scrolls horizontally inside its own card below ~520px of
  content width instead of overflowing the page.
- Tap targets ≥44px on the touched pages: quick actions, plan CTAs, coupon
  verify, all billing form inputs, mobile invoice buttons.
- Shell untouched except what globals add globally — M59 branding
  (`--brand-from/--brand-to`, shell logo + brand name) and the M60 mobile
  bottom navigation and subscription/platform banners are byte-identical.

## Verification

- `tsc --noEmit` clean; web unit tests **20/20 pass** (unchanged baseline);
  `next build` green (45 pages).
- Live check on the new build (`next start`): `/`, `/login`, `/dashboard`,
  `/dashboard/billing`, `/offline` all 200; `/manifest.webmanifest` and
  `/sw.js` still served (PWA invariants intact). Built CSS contains
  `hero-panel`, `meter-fill`, `plan-card-current`, `quick-action`,
  `skeleton`, `stat-icon`; the billing chunk contains "ব্যবহার ও সীমা" and
  "দিন বাকি আছে"; the overview chunk contains "শীর্ষ ক্যাম্পেইন" and
  "সুপ্রভাত".
- Git diff touches **zero** `apps/api` files (API suite therefore unchanged
  by construction; not re-run).

## Honest limits

- No real-browser pixel QA was possible in the sandbox: responsiveness is
  verified by the code-level audit above (breakpoints, min-heights,
  overflow containment) plus served-marker checks, not by screenshots.
- The sandbox Postgres holds only default databases, so the pages were not
  exercised against a seeded live tenant in this pass; their data paths are
  unchanged from the previously live-proven pages — only rendering changed.
- `color-mix()` requires a modern browser (2023+); on anything older the
  soft brand tints fall back to the card's base white — the layout never
  breaks, it just loses the tint.
