# Design Tokens v3 (EB1 / ED1)

The single source of truth for colour, type, radius, shadow and motion
in the web app. Tokens live as CSS variables in `:root` in
`apps/web/src/app/globals.css`; `apps/web/tailwind.config.ts` reads the
same variables for its shadow / radius / type utilities and exposes
var-backed colour utilities alongside the legacy literal palettes.

**The v3 rule:** every default below equals the value the hard-coded
utility or class computed to before the token layer existed. Migrating
a surface to tokens must never change its rendered output at default
settings — tokens change *where the value comes from*, not the value.

## Brand

| Token | Default | Source / purpose |
|---|---|---|
| `--brand-from` | `#6366f1` (indigo-500) | Pre-existing. The M59 white-label shell overrides `--brand-from`/`--brand-to` per org in the dashboard; all gradient surfaces derive from them. |
| `--brand-to` | `#8b5cf6` (violet-500) | Pre-existing gradient end. |
| `--brand` | `var(--brand-from)` | **The** solid brand colour. In the shop, the shop layout sets `--brand` directly to the org's `primaryColor`, falling back to `#4f46e5` (indigo-600 — the exact colour shop CTAs hard-coded before ED1). Drives `.btn-brand`. |
| `--brand-strong` | `var(--brand-to)` | Strong/secondary brand step. |
| `--brand-soft` | `color-mix(brand-from 9%, white)` | Pre-existing (v2). Tint surfaces. |
| `--brand-soft-strong` | `color-mix(brand-from 16%, white)` | Pre-existing (v2). |
| `--brand-ring` | `color-mix(brand-from 38%, transparent)` | Pre-existing (v2). Focus/selection rings and glows. |

Tailwind: `bg-brand` / `text-brand` / `bg-brand-strong` / `bg-brand-soft`
are var-backed; the numeric `brand-50…900` palette stays literal so
opacity modifiers (`brand-500/15`) keep compiling to the same colours.

## Surfaces & borders

| Token | Default | Equals |
|---|---|---|
| `--surface` | `#ffffff` | white (pre-existing v2) |
| `--surface-muted` | `#f8fafc` | slate-50 (pre-existing v2) |
| `--surface-raised` | `#ffffff` | white — cards/panels above the page surface |
| `--surface-sunken` | `#f1f5f9` | slate-100 — inset wells, rails |
| `--border-soft` | `rgba(226,232,240,0.8)` | slate-200/80 (pre-existing v2) |
| `--border` | `rgba(203,213,225,0.9)` | slate-300/90 — the `.input`/`.btn-secondary` border |
| `--border-strong` | `#cbd5e1` | slate-300 solid |

Tailwind: `bg-surface`, `bg-surface-muted`, `bg-surface-raised`,
`bg-surface-sunken`.

## Ink (text)

| Token | Default | Equals |
|---|---|---|
| `--ink-strong` | `#0f172a` | slate-900 (pre-existing v2) |
| `--ink-body` | `#334155` | slate-700 (pre-existing v2) |
| `--ink-muted` | `#64748b` | slate-500 (pre-existing v2) |
| `--ink-faint` | `#94a3b8` | slate-400 (pre-existing v2) |
| `--ink-inverse` | `#ffffff` | white — text on brand/dark surfaces |

Tailwind: `text-ink-strong` etc. The numeric `ink-800/900/950` keys stay
literal.

## Semantic colours

| Token | Default | Equals / used by |
|---|---|---|
| `--success` | `#059669` | emerald-600 — `.btn-success` gradient start |
| `--success-bright` | `#10b981` | emerald-500 — gradient end |
| `--success-soft` | `#ecfdf5` | emerald-50 |
| `--warning` | `#d97706` | amber-600 — `.btn-warning` gradient start |
| `--warning-bright` | `#f59e0b` | amber-500 — gradient end |
| `--warning-soft` | `#fffbeb` | amber-50 |
| `--danger` | `#dc2626` | red-600 |
| `--danger-soft` | `#fef2f2` | red-50 |
| `--info` | `#0284c7` | sky-600 |
| `--info-soft` | `#f0f9ff` | sky-50 |

Tailwind: `bg-success`, `bg-success-soft`, `text-danger`, `bg-info-soft`, …
Var-backed colours do **not** support Tailwind opacity modifiers
(`bg-success/50` will not compile to a translucent colour) — use the
`-soft` tokens for tints.

## Type scale

| Token | Default | Notes |
|---|---|---|
| `--text-display` / `-lh` | `2rem` / `1.15` | Hero/display headings (new in v3) |
| `--text-page-title` / `-lh` | `26px` / `1.25` | Exactly the old `.page-title` (`text-[26px] leading-tight`) |
| `--text-section` / `-lh` | `15px` / `1.4` | `.section-title` size; the legacy class keeps its inherited line-height — `1.4` is the target EB5 normalises to |
| `--text-body` / `-lh` | `14px` / `1.55` | Base UI text; `.page-sub` keeps Tailwind text-sm's `1.25rem` line-height explicitly |
| `--text-small` / `-lh` | `13px` / `1.5` | Dense lists, nav |
| `--text-micro` / `-lh` | `11px` / `1.4` | Labels, badges, table heads |

Tailwind: `text-display`, `text-page`, `text-section`, `text-body`,
`text-small`, `text-micro`.

## Spacing, radius, shadow, motion

| Token | Default |
|---|---|
| `--space-1…8` | `0.25 / 0.5 / 0.75 / 1 / 1.5 / 2rem` (the 4px rhythm in use) |
| `--radius-sm` | `0.5rem` (rounded-lg) |
| `--radius-md` | `0.75rem` (rounded-xl — buttons/inputs) |
| `--radius-lg` | `1rem` (rounded-2xl — cards) |
| `--radius-card` | `1rem` (pre-existing v2; `rounded-card` utility) |
| `--radius-xl` | `1.5rem` (rounded-3xl) |
| `--radius-full` | `9999px` |
| `--shadow-card` | `0 1px 2px rgba(15,23,42,.05), 0 4px 16px -4px rgba(15,23,42,.08)` — the old config literal, now the single source (`shadow-card`) |
| `--shadow-card-hover` | `0 2px 4px rgba(15,23,42,.06), 0 12px 32px -8px rgba(15,23,42,.16)` (`shadow-card-hover`) |
| `--shadow-glow` | `0 8px 24px -8px rgba(99,102,241,.55)` (`shadow-glow`) |
| `--shadow-drawer` | `0 0 60px rgba(2,6,23,.45)` (`shadow-drawer`) |
| `--shadow-card-v2` | pre-existing v2 — hero/panel surfaces inside globals.css |
| `--shadow-pop` | pre-existing v2 — popovers/modals inside globals.css |
| `--shadow-success` | `0 8px 24px -8px rgba(16,185,129,.55)` (`.btn-success`) |
| `--shadow-warning` | `0 8px 24px -8px rgba(245,158,11,.55)` (`.btn-warning`) |
| `--motion-fast` | `120ms` (tbody row transitions) |
| `--motion-base` | `200ms` (card hovers, fade-in) |
| `--motion-slow` | `350ms` (rise entrances) |

## The shop brand seam (ED1)

Before ED1, a merchant's `primaryColor` reached the announcement bar,
the header logo tile/cart button and a few accents — but **no buy or
checkout button**: every primary shop CTA was hard-coded `bg-indigo-600`.
ED1 closes that gap:

1. `app/shop/[orgSlug]/layout.tsx` sets `--brand: <primaryColor ||
   "#4f46e5">` on the shop root element. The fallback is the exact
   colour the CTAs used before, so unbranded shops are unchanged.
2. `.btn-brand` (globals.css) paints `background-color: var(--brand)`
   with white text; `.btn-brand-shadow` reproduces the
   `shadow-lg shadow-indigo-600/30` geometry with the brand colour at
   30% via `color-mix`. Adopted by: PDP buy + checkout-now
   (`ProductDetailClient`), QuickView buy + checkout-now, cart
   checkout link, checkout submit button.
3. Hover: `.btn-brand:hover` darkens via `filter: brightness(0.92)` —
   the token-path equivalent of indigo-600 → indigo-700 that works for
   any org colour. (The resting colour is exact; the hover is an
   intentional, documented approximation — an arbitrary merchant
   colour has no "700" step to be exact with.)
4. ExpressCheckout's confirm button is **emerald by design**
   (`bg-emerald-600`), not indigo — it was left untouched; it is not
   part of the brand CTA family.
5. The single-product checkout (`/checkout/[slug]`) and landing pages
   (`/l/[slug]`) live outside the shop layout (no `--brand` seam) —
   their CTAs migrate in EB3 with the Shop v2 shell.

## What deliberately did NOT move to tokens in ED1

- `lib/shop-theme.ts` theme strings (classic/bold/minimal): literal
  class strings are the byte-compat contract (pinned by
  `lib/shop-theme.test.ts`); they contain no variable seam. EB3's
  Shop v2 theme is the first token-native theme.
- `.input` focus ring, `.badge-brand`, `.nav-link-active`: these read
  the literal `brand-*` palette today; the palette is the token's
  default source, and rewiring them to `var(--brand)` would change
  behaviour under the white-label override (a product decision, not
  a refactor). Documented here so EB5/EB7 can decide deliberately.
- The ~100 additive component families in globals.css (inbox, social,
  AI, campaign `.cbx-*`, …): they already derive from
  `--brand-from/--brand-to/--brand-soft/--brand-ring` and the v2
  surface tokens; EB1 re-expressed only the core primitives
  (`.card`, `.table-wrap`, `.page-*`, `.section-title`,
  `.btn-secondary/success/warning`) plus the config-level shadow
  wiring that tokenises every `shadow-*` consumer transitively.

## Dark mode (ED17 / EB7) — SHIPPED

The readiness above is now realised. Two scopes re-declare the
surface / ink / border / semantic / shadow tokens with dark values
in `globals.css` (one value set, pinned identical by
`lib/theme.test.tsx` against `DARK_TOKEN_LIST` in `lib/theme.ts`):

1. **Dashboard** — `.dashboard-root.dark`: the `dark` class sits on
   the dashboard root element only. Preference = light / dark /
   system (default system), stored in localStorage
   (`qosprey-theme`), applied pre-paint by a bootstrap script in
   the dashboard layout and toggled from the topbar
   (`components/theme-toggle.tsx`). A scoped override layer in
   globals.css maps the highest-frequency literal classes
   (bg-white, text-slate-400…900, border/divide/ring slate steps,
   `.input`, `.btn-secondary`, badges…) onto the tokens inside the
   dashboard subtree; the coverage inventory + straggler list lives
   in `docs/design-eb7-acceptance.md`.
2. **Shop v2** — `@media (prefers-color-scheme: dark)` scoped to
   `[data-shop-theme="v2"]`: a v2 shop follows the visitor's OS
   preference automatically. Legacy themes use literal classes and
   do not flip (by design).

Not re-declared, deliberately: `--brand`, `--brand-from`,
`--brand-to` (the white-label seam — dark mode never restyles
branding), `--brand-ring`, `--ink-inverse`, the coloured glow
shadows, and the type/spacing/radius/motion scales.
`--brand-soft` / `--brand-soft-strong` ARE re-declared because
their light definitions mix the brand colour toward white.
Dark contrast (on `--surface` #0f172a): ink-strong 16.3:1,
ink-body 12.0:1, ink-muted 7.0:1, ink-faint 5.8:1, success 7.0:1,
warning 10.7:1, danger 6.5:1, info 8.3:1.
