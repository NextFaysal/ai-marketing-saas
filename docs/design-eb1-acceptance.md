# EB1 Acceptance — ED1 Tokens v3 + ED2 @repo/ui + ED3 Icon System

Batch 1 of 7 of the E-Commerce Design & Experience Program
(plan: `Ecommerce-Design-Master-Plan-2026-10-16.md`). Worktree
`~/workspace/ai-marketing-saas-design`, branch `design-v3`, base =
gc-stack release `17a2c27`. **Local commits only — no push.**

Commits (oldest → newest):
- `06e60ab8` feat(ui): ED2 @repo/ui consolidation
- `4719900f` feat(design): ED1 Tokens v3
- `365ca406` feat(icons): ED3 lucide icon system + providers mounted
- deps chore commit: lucide-react + testing stack (web)

## Gates — baseline vs final

Baseline measured on the untouched base (fresh worktree, after
`pnpm install` + `pnpm --filter @repo/db generate`):

| Gate | Baseline (17a2c27) | Final (EB1) |
|---|---|---|
| Web vitest | 703 passed / 82 files | **715 passed / 83 files** (+11 ui-components specs, +1 shop-theme pin test) |
| Web tsc (`tsc --noEmit`) | 0 errors (after build; a fresh tree fails standalone only because `@repo/contracts` dist doesn't exist yet — topological, pre-existing) | **0 errors** |
| @repo/ui tsc | — (part of -r build) | **exit 0** |
| `pnpm -r build` (7 projects, incl. production `next build`) | exit 0 | **exit 0** |
| API / prisma / migrations | — | **untouched: 0 files** in `git diff 17a2c27..HEAD` under apps/api, packages/db, prisma; **zero migrations** (22 files changed, all web/ui/docs/lockfile) |

## ED1 — Tokens v3

**Token inventory + defaults evidence** — full table in
`docs/design-tokens-v3.md`. Every v3 default was sampled from the
value in force before the change:
- Brand: `--brand: var(--brand-from)`, `--brand-strong: var(--brand-to)`
  (the pre-existing M59 seam variables `#6366f1`/`#8b5cf6`); the
  pre-existing v2 tokens (`--surface #ffffff`, `--surface-muted
  #f8fafc`, `--border-soft rgba(226,232,240,.8)`, the four `--ink-*`
  slate steps, `--brand-soft/-strong/-ring` color-mix derivations,
  `--radius-card 1rem`, `--shadow-card-v2`, `--shadow-pop`) kept
  verbatim.
- Added: `--surface-raised #fff`, `--surface-sunken #f1f5f9`
  (slate-100), `--border rgba(203,213,225,.9)` (slate-300/90, the
  `.input`/`.btn-secondary` border), `--border-strong #cbd5e1`,
  `--ink-inverse #fff`; semantics `--success #059669` /
  `--success-bright #10b981` (the exact `.btn-success` gradient),
  `--warning #d97706` / `--warning-bright #f59e0b` (`.btn-warning`),
  `--danger #dc2626`, `--info #0284c7` + `-soft` tints = the
  emerald/amber/red/sky-50 steps; type scale `--text-page-title
  26px/1.25` (= `.page-title`'s `text-[26px] leading-tight`),
  `--text-section 15px`, `--text-body 14px`, `--text-small 13px`,
  `--text-micro 11px`, `--text-display 2rem/1.15`; spacing rhythm
  `--space-1…8`; radius `--radius-sm .5 / -md .75 / -lg 1 / -xl 1.5 /
  -full`; shadows `--shadow-card/-card-hover/-glow/-drawer` set to
  the exact literals that stood in tailwind.config; motion
  `--motion-fast 120 / -base 200 / -slow 350ms`.

**Tailwind wiring** (`tailwind.config.ts`, additive): boxShadow
card/card-hover/glow/drawer now read `var(--shadow-*)` (defaults =
the old literals, so every `shadow-*` consumer is tokenised
transitively with identical output); new var-backed colours
`brand.DEFAULT/strong/soft`, `ink.strong/body/muted/faint/inverse`,
`surface(.muted/.raised/.sunken)`, `success/warning/danger/info`
(+soft); fontSize `text-display/page/section/body/small/micro`;
borderRadius `rounded-card`. The literal `brand-50…900` and
`ink-800/900/950` palettes are unchanged (opacity modifiers like
`brand-500/15` keep compiling identically). Collision scan: no
pre-existing class in the codebase accidentally becomes live.

**globals.css re-expression** (same selectors, values via var()):
`.card`, `.table-wrap` (border-soft/surface/radius-lg/shadow-card),
`.page-title`, `.page-sub`, `.section-title` (type + ink tokens),
`.btn-success`, `.btn-warning` (semantic gradient + shadow tokens),
`.btn-secondary` border colour. Deliberately NOT rewired (recorded
in the tokens doc): `.input` focus ring, `.badge-brand`,
`.nav-link-active` read the literal brand palette today, and making
them follow `var(--brand)` would change behaviour under the
white-label override — a product decision, not a refactor. The ~100
additive families (inbox/social/AI/campaign) already derive from
the brand vars and were left byte-identical.

**Shop themes**: `lib/shop-theme.ts` strings untouched (doc comment
added explaining why). **Classic byte-compat spec result:
`lib/shop-theme.test.ts` — 3/3 passed** (pre-existing classic pin
kept; ED1 extended it with full bold/minimal object pins +
`cardImageWrapClass` + `themeIdOf` fallback).

**Shop brand seam + CTAs**: the audit found the seam reached only
the announcement bar/header tile — no buy button. ED1 sets
`--brand: <org primaryColor || "#4f46e5">` on the shop layout root
(the fallback IS today's hard-coded CTA colour) and moves the
primary CTAs to `.btn-brand` (+`.btn-brand-shadow` where
`shadow-lg shadow-indigo-600/30` stood): PDP buy + checkout-now
(`ProductDetailClient`), QuickView buy + checkout-now, cart
checkout link, checkout submit. Resting colour at default =
`#4f46e5`, exactly today's indigo-600, by construction. **Not
swapped, deliberately:** ExpressCheckout confirm (emerald-600 by
design, not indigo — the plan's premise didn't match the code);
single-product `/checkout/[slug]` + landing `/l/[slug]` CTAs (they
live outside the shop layout — EB3 shell scope).

## ED2 — @repo/ui consolidation

`packages/ui` gains an `exports` map: `.` (server-safe) and
`./client` (`"use client"`). The 5 existing exports stay
API-compatible (24 web consumers grepped; EmptyState/KpiCard/Card/
Badge untouched in behaviour; Skeleton now uses the globals
`.skeleton` shimmer class with `rounded-xl` preserved; EmptyState
gains an optional `action` ReactNode slot).

New inventory (typed props, no business logic):
- index (server-safe, no hooks): `Button` (8 variants mapped to the
  `btn-*` globals classes + danger/ghost/link; sm/md/lg; loading
  spinner + disabled), `Input`/`Select`/`Textarea` (label/error/
  hint, implicit label wrap, `input` class), `PageHeader`,
  `FilterBar`, `Tabs` (controlled, on the globals `view-switch`
  classes, ARIA tab semantics), `StatChip`, `ResponsiveTable`
  (CSS dual-render: table ≥md, `cards` node <md).
- client: `Modal`, `Drawer` (role=dialog/aria-modal, Escape close,
  focus save/restore, body scroll lock), `ToastProvider` +
  `useToast()` (success/error/info, auto-dismiss, aria-live),
  `ConfirmProvider` + `useConfirm()` (promise-based; superseded
  call resolves false; danger tone; Bengali default labels).

**Tests**: `apps/web/src/lib/ui-components.test.tsx` (jsdom) —
**11/11 passed**: Button variants/loading, Input label+error, Tabs
onChange/aria, ResponsiveTable dual-render structure, Toast
auto-dismiss, Confirm resolve true/false, Modal Escape. Test stack
(@testing-library/react+dom, jsdom) added as web devDeps.

**Adoption (proving, not redesigning)**: `ToastProvider` +
`ConfirmProvider` mounted at the dashboard root in
`app/dashboard/layout.tsx` (main returned tree; behaviour-neutral —
no page calls the hooks yet; EB5/EB6 adopt). One deviation:
`packages/ui/tsconfig.json` has no DOM lib, so client.tsx reaches
DOM APIs via `globalThis` with structural types (tsconfig outside
the batch's file set; behaviour identical, commented in-file).

## ED3 — Icon system

`lucide-react ^1.57.0` (web dep, pinned by the lockfile).
`apps/web/src/lib/icons.ts`: `NAV_ICONS` (43 keys), `COMMERCE_ICONS`
(30), `SHOP_ICONS` (8) — semantic name → Lucide component. No name
substitutions were needed (verified against the installed d.ts;
five names are documented aliases in v1.57 — Building2, BarChart3,
Wand2, LineChart, FileBarChart — noted in the file header).

**Grep proof** (pictographic ranges U+1F000–1FAFF, U+2600–26FF,
U+2B00–2BFF, U+FE0F, counted by script):

| File | Before | After |
|---|---|---|
| `lib/nav.ts` (all 38 items; icon is now a NavIconName key) | 42 | **0** |
| `app/dashboard/layout.tsx` (nav renderers, GROUPS, mobile bottom nav, topbar + shell chrome: menu, view-as, logout, notifications…) | 34 | **0** |
| `app/dashboard/commerce/page.tsx` (all 24 hub chips/cards) | 25 | **0** |
| `app/shop/[orgSlug]/ShopHeader.tsx` (wishlist/account/cart) | 4 | **0** |
| `app/dashboard/pos/page.tsx` (header scope only: title + 2 print buttons) | 17 | 14 remain — itemised page-internal status/panel glyphs (🟢🔴🔄📷📥⭐🎁📴⚠️💵📒), EB5 scope per the plan boundary |

One content-role glyph remains in layout.tsx: ✅ inside a
Bengali sentence string (verification-resent feedback text) — text,
not an icon; ▸/▾ chevrons and the ⌘ comment are typography.
ShopFooter needed no work: it is inline in the shop layout and
text-only (0 emoji), and ShopContactButtons has 0 emoji (verified).

## Honest limits

- **No visual/screenshot QA** — impossible pre-deploy in this
  sandbox; zero-regression rests on (a) token defaults sampled from
  the values in force, (b) the classic-theme byte-compat spec,
  (c) class-name/selector preservation, (d) the green production
  build. Post-deploy screenshot QA remains the owner's step, like
  every prior design package.
- `.btn-brand` hover is `brightness(0.92)` — the resting colour is
  exact; a hover "700-step" cannot be exact for an arbitrary
  merchant colour (documented in the tokens doc).
- `text-section`'s line-height token (1.4) is a target, not yet
  applied — the legacy class keeps its inherited line-height until
  EB5 normalises it (applying it in EB1 would have changed computed
  output).
- Var-backed Tailwind colours don't support opacity modifiers
  (`bg-surface/50`) — use `-soft` tokens; documented.
- Page-internal emoji outside the migrated files/surfaces
  (empty states, in-content markers, POS panels) remain for
  EB3/EB5 by design. The dashboard layout's two early-return
  branches (loading, verification wall) are not provider-wrapped —
  the main tree is; hooks have no consumers yet either way.
- **Dark mode: readiness only.** All v3 values are variables in one
  `:root` block, so ED17 (EB7) can re-declare them under a dark
  scope with zero class changes. No dark palette ships in EB1.
- API untouched, zero migrations, nothing live-proven; deploy
  still needs the owner's push instruction + Dokploy Redeploy,
  which are outside this batch.
