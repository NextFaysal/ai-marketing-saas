# EB7 Acceptance — ED17 Dark Mode · ED18 Verification & Program Close

Batch 7 of 7 (FINAL) of the E-Commerce Design & Experience Program
(plan: `Ecommerce-Design-Master-Plan-2026-10-16.md`). Worktree
`~/workspace/ai-marketing-saas-design`, branch `design-v3`, base =
EB6 HEAD `04bbfbea`. **Local commits only — no push.** WEB-ONLY:
zero API/schema/prisma files touched, zero migrations.

Commits (oldest → newest):
- `85183d55` ED17 dark mode — tokens, override layer, toggle, specs
- `0ee1f4f0` ED18 Lighthouse budget pack
- `db4f6b29` ED18 consolidated QA map (+ dark-mode checklist)
- this docs commit (acceptance + program summary)

## Gates — baseline vs final (coordinator-run, exit-code checked, serial)

Baseline = EB6 finals on `04bbfbea`. All runs with `TMPDIR` on the
workspace disk (the EB5/EB6 lesson); builds run PER PROJECT.

| Gate | Baseline (04bbfbea) | Final (EB7) |
|---|---|---|
| Web vitest | 788 passed / 96 files | **797 passed / 97 files** (+9 ED17 theme specs) |
| Web tsc (`tsc --noEmit`) | 0 errors | **0 errors** |
| @repo/ui build | exit 0 | **exit 0** |
| @repo/contracts build | exit 0 | **exit 0** |
| @repo/db build | exit 0 | **exit 0** |
| @repo/worker build | exit 0 | **exit 0** |
| @repo/api build | exit 0 | **exit 0** |
| @repo/admin build | exit 0 | **exit 0** |
| @repo/web build (production `next build`) | exit 0 | **exit 0** |
| API / prisma / migrations | untouched | **untouched; zero migrations** |

Production-CSS verification (not just source): the built
`.next/static/css/*.css` contains `.dashboard-root.dark{…}` with
the exact dark token values and the
`@media (prefers-color-scheme:dark)` shop block — the unlayered
dark rules survived the production build verbatim.

## ED17 — Dark mode

### Mechanism
- `tailwind.config.ts` gains `darkMode: "class"` — additive;
  nothing in the tree used `dark:` variants before, so the config
  change alone alters no rendered output.
- `globals.css`: `.dashboard-root.dark { … }` re-declares the EB1
  tokens with dark values (surfaces, ink scale, borders,
  semantics + soft tints, five shadows, `color-scheme: dark`).
  Page ground #0a0f1e, `--surface` #0f172a (slate-900),
  `--surface-raised` #1e293b, `--surface-muted` #17233d,
  `--surface-sunken` #0a0f1e; inks inverted (strong #f1f5f9 →
  faint #8494ab); borders become translucent slate-400
  (0.16 / 0.28 / slate-600 solid).
- The brand seam is NOT re-declared (`--brand`, `--brand-from`,
  `--brand-to` keep the white-label/shop values — dark mode never
  restyles branding). `--brand-soft` / `--brand-soft-strong` ARE
  re-declared: their light definitions color-mix the brand toward
  white, which would read as a pastel wash on dark; the dark
  versions mix toward the dark surface. `--brand-ring`, the
  coloured glow shadows and the type/spacing/radius/motion
  scales are mode-agnostic and stay. The full token list is
  pinned by spec (below).
- `.btn-success` / `.btn-warning` keep their LIGHT gradient stops
  under `.dark` via the override layer: their white labels
  measure 3.8:1 / 3.2:1 on those stops — identical to light
  mode's own values — while the flipped text tokens
  (--success/--warning, chosen for text-on-surface contrast)
  would have dropped the button labels below 2.6:1.

### Contrast — computed from the shipped hex values (WCAG ratios)
| Token | on --surface #0f172a | on --surface-raised #1e293b |
|---|---|---|
| --ink-strong #f1f5f9 | 16.30:1 | 13.35:1 |
| --ink-body #cbd5e1 | 12.02:1 | 9.85:1 |
| --ink-muted #94a3b8 | 6.96:1 | 5.71:1 |
| --ink-faint #8494ab | 5.79:1 | 4.74:1 |
| --success #10b981 | 7.04:1 | 5.77:1 |
| --warning #fbbf24 | 10.69:1 | 8.76:1 |
| --danger #f87171 | 6.45:1 | 5.29:1 |
| --info #38bdf8 | 8.33:1 | 6.83:1 |

Every text-bearing token clears 4.5:1 on both working surfaces.

### Toggle + persistence + first paint
- `components/theme-toggle.tsx` in the dashboard topbar (beside
  the notification bell, same button chrome): lucide
  Monitor/Sun/Moon by state, Bengali aria-label/title
  ("থিম: সিস্টেম/লাইট/ডার্ক — বদলাতে ক্লিক করুন"), cycles
  সিস্টেম → লাইট → ডার্ক → সিস্টেম.
- State: localStorage `qosprey-theme` (`lib/theme.ts`:
  `parseThemePref` / `readStoredThemePref` /
  `writeStoredThemePref` / `resolveIsDark` /
  `applyThemeClass`). Default = system → `prefers-color-scheme`;
  while on system, an OS change re-applies live.
- **Placement decision (documented trade-off):** the pre-paint
  bootstrap (`DASHBOARD_THEME_INIT_SCRIPT`) is inlined as the
  first child of the dashboard root *inside the dashboard
  layout* — NOT in the root layout — because the root layout is
  shared with the shop, and shop pages must never receive the
  dashboard class or pay for the script. The script replicates
  `resolveIsDark` exactly, applies to `.dashboard-root` when it
  is already parsed, and retries on DOMContentLoaded if a
  future React/Next change hoists it ahead of the root. The
  layout additionally re-asserts the class in a mount effect,
  and the toggle applies changes directly — so the worst case
  on a cold dashboard load is a brief light flash before the
  effect lands, never a wrong final state. The dashboard shell
  is a client component whose content paints after hydration
  begins, which keeps that window to a frame in practice; the
  visual truth is a post-deploy checklist item (QA map §3).

### Coverage inventory (the honest map)
**Layer 1 — token-driven surfaces (flip automatically):** the
@repo/ui kit (Button/Input/Card/Badge/Skeleton/PageHeader/
FilterBar/Tabs/Modal/Drawer/Toast/Confirm/Prompt/ResponsiveTable/
StatChip/KpiCard/EmptyState/SkipLink), the globals component
classes (`.card`, `.table-wrap`, `.page-title` family, `.btn-*`),
and every var-backed Tailwind utility (`bg-surface`,
`text-ink-*`, `bg-success-soft`, `shadow-card`, …). All EB5/EB6
commerce surfaces ride these — **commerce is as close to fully
dark as the codebase gets.**

**Layer 2 — the scoped literal override layer** (`.dashboard-root.dark`
descendant rules in globals.css, unlayered so they beat the
utility layer without `!important`). Patterns chosen by grep
frequency over `app/dashboard` (115 .tsx files):

| Pattern (occurrences) | Dark mapping |
|---|---|
| `bg-white` (722) | var(--surface) |
| `bg-white/80` (topbar), `bg-white/95` (mobile nav) | color-mix of --surface at 80/95% |
| `bg-slate-50` (479), `bg-slate-50/80` | var(--surface-muted) |
| `bg-slate-100` (256), `bg-slate-200` (126) | var(--surface-raised) |
| `text-slate-900` (329) / `text-slate-800` (141) | var(--ink-strong) |
| `text-slate-700` (422) / `text-slate-600` (567) | var(--ink-body) |
| `text-slate-500` (2,016) | var(--ink-muted) |
| `text-slate-400` (820) | var(--ink-faint) |
| `border-slate-200` (321) / `border-slate-100` (136) | var(--border-soft) |
| `border-slate-200/80` (55) / `/90` (22) | translucent border rgba |
| `border-slate-300` (64) | var(--border) |
| `divide-slate-100/200` (24) | var(--border-soft) (child selector) |
| `ring-slate-100/200/300` (109) | --tw-ring-color → border tokens |
| `hover:bg-slate-50` (81) / `hover:bg-slate-100` (62) | muted / raised |
| `hover:text-slate-800/900` | var(--ink-strong) |
| `placeholder:text-slate-400/500` | var(--ink-faint) |
| `.input`, `.btn-secondary`, `.btn-dark`, `.table-wrap`, base `thead th`, `.skeleton`, `.badge-*` | token re-expression (see globals.css) |

**Known stragglers (by design or by frequency — NOT covered):**
- `text-slate-300` and lighter steps — deliberately unmapped:
  the sidebar and other always-dark chrome use them as
  light-on-dark text; mapping them would break the sidebar.
- Coloured palette literals outside the slate family
  (`bg-indigo-50`, `bg-emerald-50`, `text-rose-600`, tint
  banners…): they keep their light pastel fills in dark mode —
  dark text on a pastel tint stays readable, but the chips read
  bright against dark surfaces. The kit `.badge-*` family IS
  remapped; page-level ad-hoc tint classes are the long tail a
  future per-file sweep would take.
- `bg-slate-900` (63) / `bg-slate-800` (24) literals stay
  near-black (dark chips/tracks — mostly intentional-looking);
  the `.btn-dark` class itself IS remapped to raised.
- Arbitrary-value classes (`bg-[#…]` one-off hexes) — per-page,
  unmapped.
- The dashboard layout's early-return surfaces (the `!ready`
  loading spinner, the email-verification wall) render OUTSIDE
  `.dashboard-root` and stay light — same family as EB6's
  skip-link note.
- Print surfaces (POS receipt, warehouse labels) stay
  black-on-white — they are paper artefacts, not UI.
- **The admin app (`apps/admin`) is a separate application and
  has NO dark mode from this batch** — ADX/ADNX own it.

**Charts/canvas:** there is no chart library in the dashboard
(no recharts/chart.js; package.json verified). Data surfaces
are tables + kit StatChips/KpiCards — token-driven, they flip.
The only canvas-style surface is the @xyflow/react workflow
canvas (`/dashboard/workflows`, outside commerce), which keeps
its own react-flow colours in both modes; warehouse label SVGs
are print output.

### Shop dark (v2)
`@media (prefers-color-scheme: dark) { [data-shop-theme="v2"] {
… } }` re-declares the SAME dark token values (spec-pinned
identical coverage) on the v2 shop root: a v2 shop follows the
visitor's OS preference automatically — no merchant setting
(settings changes need API/migrations, out of scope), no toggle.
The shop layout's inline `--brand` (merchant primaryColor) is
untouched and still wins for CTAs/prices. **Legacy themes
(classic/bold/minimal) do NOT flip**: their markup is literal
classes that never read the variables — stated plainly, they
stay light in an OS-dark browser, by design.

### Specs (`lib/theme.test.tsx` — 9/9)
- `parseThemePref` (unknown/garbage → system), the full
  stored × system `resolveIsDark` matrix, storage read/write
  (incl. a corrupt stored value), `applyThemeClass` toggling.
- **CSS pin:** both dark blocks are extracted from the real
  `globals.css` and every token in `DARK_TOKEN_LIST` (28 tokens)
  must be re-declared in EACH; neither block may declare
  `--brand` / `--brand-from` / `--brand-to`; the shop block must
  sit inside the dark media query.
- Toggle smoke (jsdom): renders with the Bengali label, cycles
  সিস্টেম → লাইট → ডার্ক → সিস্টেম writing localStorage each
  time, and the `dark` class lands on / leaves the
  `.dashboard-root` element accordingly.

## ED18 — Verification & program close

### Lighthouse budget pack (deliverable shipped; scores post-deploy)
- `apps/web/scripts/lighthouse-budgets.json` — the plan's
  targets (home/listing/PDP: Performance ≥ 0.90, LCP ≤ 2,500ms,
  CLS ≤ 0.1, TBT ≤ 200ms labelled as the lab proxy for the
  INP ≤ 200ms field target; checkout interactive ≤ 3,000ms)
  plus the plan's manual-only targets (first-viewport image
  payload ≤ 500KB, per-route JS ≤ 200KB gzip, dashboard skeleton
  ≤ 300ms) with their verification methods stated in-file.
- `apps/web/scripts/lighthouse-budgets.mjs` — dependency-free
  runner: derives the four URLs from --base/--org/--product,
  shells to `npx lighthouse` (mobile emulation), prints PASS/FAIL
  per budget, writes JSON reports + a summary, exit 1 on any
  failure. Syntax-checked (`node --check`) and its usage guard
  exercised.
- **Feasibility, re-verified honestly:** unlike EB2's finding,
  the Lighthouse CLI IS fetchable in this sandbox now
  (`npx -y lighthouse --version` → 13.5.0) and a Chromium binary
  exists (`/opt/meta-chromium/chrome`). What still does NOT
  exist is a **servable seeded shop**: the storefront SSRs from
  the NestJS API + Postgres with a real org/shop/products, and
  no such stack runs in this sandbox — there is no
  representative page to measure (a login/404 score would be
  worse than no score). **No Lighthouse run was performed and
  no scores are claimed anywhere in this program.** The pack
  executes post-deploy per the QA map.

### Consolidated QA map
`docs/design-program-qa-map.md` — one post-deploy index with a
run order: (1) legacy-theme + light-mode control pass,
(2) Shop v2 screenshot checklist (EB3, 48 boxes),
(3) responsive + a11y checklist (EB6, 46 boxes),
(4) the NEW dark-mode visual checklist (dashboard shell/token
surfaces, the literal long tail with a straggler-recording step,
shop v2 under OS dark, legacy shops expected light),
(5) the Lighthouse pack with score-recording lines. All boxes
unchecked.

### Program summary
`docs/design-program-summary.md` — the ED1–ED18 item-by-item
audit table, the program-wide gate rollup, the NOT BUILT /
limits register and the release notes.

## Honest limits
- **Dark mode correctness is code-level proof**: token
  re-declaration + override specificity (unlayered rules),
  computed contrast ratios, jsdom specs, and the production CSS
  containing the blocks verbatim. No browser has rendered it;
  the QA map's dark section is the visual proof and it is
  entirely unexecuted.
- A cold dashboard load can show a brief light flash before the
  bootstrap/effect lands the dark class (placement trade-off
  documented above); the checklist carries a box for it.
- The override layer is a pattern map, not full coverage: the
  straggler classes listed above keep literal colours in dark
  mode. The acceptance claims "the large majority of dashboard
  surfaces", backed by the frequency table — not "everything".
- The shop media-query block flips token-driven v2 surfaces;
  any v2 component that still hand-rolls a literal light class
  keeps it (same long-tail caveat, shop edition).
- Nothing in EB7 (or the program) is deployed or live-proven;
  release still needs the owner's explicit push instruction +
  Dokploy Redeploy, outside this batch.
