# Admin Design Next — NB1 Acceptance (ADNX1, ADNX2, ADNX3, ADNX6)

- **Batch:** NB1 (ভিত্তি) of the ADNX package — plan
  `~/workspace/goals/ai-marketing-saas-platform-build/files/Admin-Dashboard-Design-Next-Plan-2026-10-16.md`
  §৪ (ADNX1), §৫ (ADNX2/ADNX3), §৬ (ADNX6), §৯ NB1 row + gates
- **Worktree / branch:** `~/workspace/ai-marketing-saas-adnx`, `admin-design-next`
- **Base:** `cf3efd5` (GitHub main content) · **Local commits only — NO push**
- **Owner decisions applied (not reopened):** dark-only polish, mobile
  bottom quick bar YES, Bengali font = Hind Siliguri, charts = NB3 scope

## Commits (one per item, in plan order)

| Item | Commit | Subject |
|---|---|---|
| ADNX1 | `6447644` | Design System v4 + Hind Siliguri Bengali font |
| ADNX2 | `dcb3d42` | DataTable v3 pattern + adoption on 8 list pages |
| ADNX3 | `58ed97c` | Toast system + eliminate all browser dialogs |
| ADNX6 | `e8dfb17` | Shell polish — mobile bottom quick bar, skip link, palette sheet |

## ADNX1 — Design System v4 + Bengali font (`6447644`)

Built:
- `apps/admin/src/app/globals.css` (210 → 326 lines): append-only v4
  section completing the token set — typography scale
  (`--a-fs-page 24 / section 16 / body 14 / small 12.5 / caption 11`,
  line-heights), elevation (`--a-elev-1..3`), z-index scale
  (`sticky 20, topbar/quickbar 40, drawer/modal 50, palette 60,
  toast 70`), breakpoint contract tokens (360/640/768/1024/1280/1536,
  documented as contract since CSS vars cannot drive media queries),
  focus-ring token (`--a-focus-ring`), touch minimum (`--a-touch-min: 44px`)
  applied to buttons/nav on coarse pointers.
- Unified status-colour mapping, named once in the v4 `:root`:
  success → emerald, warning → amber, danger → red, info → indigo,
  neutral → slate, with `.astatus-success/-warning/-danger/-info/-neutral`
  alias classes composing the existing badge palette.
- `body { font-variant-numeric: tabular-nums; line-height: 1.55 }`.
- Shared v4 styles consumed by the later NB1 items: `.atoast*` (ADNX3),
  `.atable-wrap` + DataTable v3 tweaks (ADNX2), `.aquickbar*` +
  `.ahas-quickbar` + `.askip-link` + `.apalette-panel` (ADNX6).

Contrast fixes (measured, not guessed — relative-luminance ratios
computed from the hex values):
- slate-500 `#64748b` measures **4.24:1 on slate-950** and **3.75:1 on
  slate-900** — below WCAG AA 4.5:1 for small text. slate-400 `#94a3b8`
  measures **7.87:1 / 6.96:1** — passes.
- Value-only changes (no selector removed/renamed): `.ainput`
  placeholder slate-500→400, `.anav-group` slate-500→400,
  `.afilter-label` slate-500→400, `.aempty-sub` slate-500→400,
  card-mode cell-label colour `rgb(100 116 139)`→`rgb(148 163 184)`.
- Page-level `text-slate-500` usages inside page JSX were NOT swept in
  NB1 (they are per-page adoption work for NB2–NB4, ADNX4/ADNX7–15).

Bengali font — BUILT (self-hosted):
- `@fontsource/hind-siliguri@5.3.0` added to `apps/admin/package.json`
  (+3 lines in `pnpm-lock.yaml`; the package's resolution entries
  already existed in the lockfile via another workspace importer).
- `layout.tsx` imports the **bengali subsets** (400/500/600/700) only.
- Stack: `"Inter Variable", Inter, "Hind Siliguri", "Noto Sans Bengali", …`
  — Inter has no Bengali glyphs, so Bengali falls through to Hind
  Siliguri while Latin/digits keep Inter Variable.
- Sandbox note (evidence, not a blocker): `pnpm add` first failed with
  `EPERM … chown '…/pnpm-lock.yaml.<tmp>'` because this filesystem
  forbids chown to gid 65534 (nogroup), which pnpm preserves from the
  original file. Workaround: `chown 0:0` on the lockfile, after which
  the add + install succeeded; the package is present in
  `node_modules/.pnpm/@fontsource+hind-siliguri@5.3.0` and the
  production build compiles the font CSS (build gate below).

## ADNX2 — DataTable v3 (`dcb3d42`)

Built: `DataTable` component in `apps/admin/src/components/ui.tsx` —
`.atable-wrap` scroll container (table-level scroll, never page-level),
`.atable` + `.atable-v3` + `.atable-cards` (mobile card form) +
`.atable-sticky` by default (each opt-out-able), `empty` slot rendered
after the table, SortableTh-compatible (existing sortable headers drop
in unchanged), density inherited from the shell's `data-admin-density`.

Adoption table (class upgrade + `data-label` on every cell, label =
the column header text; orgs/users adopted via the component):

| Page | Table(s) | Cells labelled | Form |
|---|---|---|---|
| `/orgs` | main list | 8 (checkbox + action cells intentionally unlabelled) | DataTable component |
| `/users` | main list | 6 (action cell unlabelled) | DataTable component |
| `/admins` | roster | already labelled at base | `atable-v3` marker added |
| `/audit` | main list | 6 | class + labels |
| `/usage` | org ranking + feature ranking | 9 + 7 = 16 | class + labels |
| `/payouts` | queue | 8 | class + labels |
| `/billing` | payments + online checkouts | 6 + 6 = 12 | class + labels |
| `/health` | connections + scheduled jobs | 7 + 5 = 12 | class + labels |
| `/tickets` | — | — | **DEFERRED (below)** |

Zero-loss for this item: the diff touches only table class strings,
`data-label` attributes, the orgs/users import line and their
`<table>`↔`<DataTable>` tags; a diff scan confirms no other line
content changed.

## ADNX3 — Toast + browser-dialog elimination (`58ed97c`)

Built in `ui.tsx` (ONE implementation each):
- **Toast:** module-level store + `toast(message, kind, action?)` /
  `useToast()` + `ToastHost` (success/error/info styles from globals
  v4, optional action button, 6s auto-dismiss, `aria-live="polite"`),
  mounted once in AdminShell.
- **Modal dialogs:** promise-based `askConfirm` / `askInput` /
  `askReason` over the existing `ConfirmModal`, rendered by
  `DialogHost`, mounted once in AdminShell. `ConfirmModal` gained two
  additive props: `initialValue`, `cancelLabel`.
- `AdminShell.reasonPrompt` → async `reasonDialog(action)` (same
  ≥3-char reason contract; the modal now blocks a short reason inline
  with its own error text, replacing the old follow-up error popup —
  the only `alert` the console had).

Conversion inventory — base audit had **24 grep lines**: 23 real
browser-dialog call sites + 1 doc-comment mention in `ui.tsx` (also
removed). All 23 converted, file by file:

| File | Sites | Conversion |
|---|---|---|
| `billing/page.tsx` | 5 | Refund amount prompt → `askInput` (optional); refund reason prompt → `askInput` (required); revoke-access confirm → `askConfirm` with explicit dual labels ("Access বন্ধ করুন" / "শুধু ফেরত") preserving the original semantics (negative choice = refund proceeds without revoke); coupon-toggle reason → `askInput`; payment-delete reason → `askInput` |
| `orgs/[id]/page.tsx` | 6 | Permanent-delete name prompt → `askInput` (exact-name check unchanged); its reason → `askInput`; subscription reason → `askInput`; conversation-body reason → `askInput`; View-As reason → `askInput`; View-As write confirm → `askConfirm` |
| `users/[id]/page.tsx` | 2 direct + 6 via reason helper | Soft-delete confirm → `askConfirm` (after reason, as before); grant-admin tier prompt → `askInput` with `initialValue: "SUPPORT"` (the original default); reason flows → `await reasonDialog(...)` |
| `orgs/page.tsx` | 1 | Bulk-status reason prompt → `askInput` |
| `security/page.tsx` | 1 direct + 1 via helper | API-key revoke reason → `askInput`; Revoke-My-Sessions → `await reasonDialog(...)` |
| `settings/page.tsx` | 2 | Plan-limits clear confirm → `askConfirm`; its reason prompt → `askInput` |
| `social-ops/page.tsx` | 1 | Ops-action reason prompt → `askInput` |
| `system/page.tsx` | 1 | Queue-action reason prompt → `askInput` |
| `growth/page.tsx` | 2 | Campaign-send confirm → `askConfirm`; changelog-delete confirm → `askConfirm` |
| `components/AdminShell.tsx` | 2 | The `reasonPrompt` helper's own prompt + alert — helper replaced by `reasonDialog` (above); org detail `setStatus` (Suspend/Reactivate/Soft-Delete) flows through it |
| `components/ui.tsx` | 1 (comment) | Doc comment rewritten; no banned call text remains anywhere |

Presentation-only notes: three callers (`settings`, `social-ops`,
`system`) previously showed a "কারণ ছাড়া…" message when a reason was
typed but too short; the modal now prevents submitting a short reason
in the first place, so that message branch is gone (cancelling is
silent, as it was for a dismissed browser prompt). All API calls,
payloads, and success/failure banners (`setMsg`) are unchanged; pages
that already had inline result banners keep them, and the toast
system is the mounted pattern for feedback going forward.

**Hard gate: grep for browser-dialog calls in `apps/admin/src` = 0**
(pattern covers `window.prompt/alert/confirm` and bare
`prompt(`/`alert(`/`confirm(`; verified at commit and again at batch end).

## ADNX6 — Shell & navigation polish (`e8dfb17`)

Built:
- **Mobile bottom quick bar** (`.aquickbar`, `lg:hidden` via the class):
  Command Center `/` (home icon), Payouts `/payouts` (badge =
  `counts.pendingPayouts`), Tickets `/tickets` (badge = `openTickets`),
  Health `/health` (badge = `failedJobs24h`) — icons, hrefs and
  countKeys all from the single nav source `./nav.tsx`, counts from
  the shell's existing `useNavCounts` (absent count ⇒ no badge, as
  everywhere else). Fifth item **আরও** opens the existing mobile
  drawer. Safe-area: `padding-bottom: env(safe-area-inset-bottom)`;
  `<main>` gained class `ahas-quickbar` (extra bottom padding below
  lg so the bar never covers content). **Login:** `/login` and
  `/login/totp` do not render AdminShell at all (verified), so the
  bar cannot appear there.
- **Skip link:** first focusable element in the shell,
  `মূল Content-এ যান` → `#admin-main` (id added to `<main>`),
  styled by `.askip-link` (off-canvas until focused).
- **Command Palette:** small-screen sheet treatment — container
  `px-2 pt-[6vh]` below `sm:`, panel gains `.apalette-panel`
  (max-height 82vh on ≤640px); desktop centred panel unchanged.
  Sticky behaviour verified in code: desktop sidebar `sticky top-0`,
  mobile top bar `fixed` — unchanged.
- Untouched and verified: 7-group nav, badges, favorites/recents,
  density toggle, attention bell, breadcrumbs.

## Gates (run SERIALLY, one heavy gate at a time)

| Gate | Result |
|---|---|
| Admin `tsc --noEmit` | **0 errors** (interim runs after ADNX1/ADNX2/ADNX3/ADNX6 and a final run — all 0) |
| Admin `next build` | **Green** — compiled successfully, static generation 23/23; route table lists the same **22 routes** as base (21 static + `/orgs/[id]`, `/users/[id]` dynamic; `_not-found` excluded from the count, as at base) |
| ADNX3 grep gate | **0 matches** in `apps/admin/src` |
| Legacy globals selector set-diff | **0 removed**, 19 added (`.ahas-quickbar`, `.apalette-panel`, `.aquickbar`, `.aquickbar-active`, `.aquickbar-badge`, `.aquickbar-item`, `.askip-link`, `.astatus-*` ×5, `.atable-wrap`, `.atoast`, `.atoast-action`, `.atoast-error`, `.atoast-info`, `.atoast-success`, `.atoast-wrap`) |
| Route set-diff (page.tsx files, base vs final) | **Identical — 22** |
| Nav href set-diff (`nav.tsx`) | **Identical** |
| API path set-diff (`/admin/...` literals in `apps/admin/src`) | **Identical — 116 = 116**, zero added, zero removed |
| Payload scan | No removed `apiFetch`/`method:` line except growth's changelog delete, whose identical path+method is re-added on the converted line (covered by the API set-diff) |
| Working tree | Clean at batch end (build artifact `tsconfig.tsbuildinfo` restored, not committed) |

Scope compliance: `apps/admin` + this doc only. No new API endpoint,
no backend change, no migration, no schema change, no new feature or
behaviour change, no invented data. Files changed vs base: 22
(488 insertions, 148 deletions), incl. `package.json`/`pnpm-lock.yaml`
for the font package.

## NOT BUILT / DEFERRED (explicit)

1. **Tickets DataTable adoption — DEFERRED to NB3 (ADNX10).** The
   tickets page has no `<table>` element: its list is an inbox-style
   list/detail grid. Forcing the table pattern there would be a
   structural redesign, not the mechanical NB1 adoption; the plan's
   ADNX10 owns that page's redesign.
2. **Tablet icon-rail auto-default — DEFERRED (ADNX6 sub-item).**
   Below `lg` the sidebar is already replaced by the mobile drawer,
   so there is no tablet sidebar to rail; at `lg+` the collapsed
   (icon-rail) state already exists as a persisted operator toggle.
   Making it an automatic default at tablet widths would fight the
   operator's stored preference and the ADX2 persistence contract.
   Revisit only if the owner asks for width-based auto-collapse.
3. **Page-level `text-slate-500` contrast sweep — NOT in NB1.** Only
   the globals.css classes were fixed (ADNX1 scope). Per-page sweeps
   belong to each page's NB2–NB4 adoption item.
4. **Toast adoption inside page result flows — partial by design.**
   The toast system is built and mounted; existing pages keep their
   inline `setMsg` banners (zero-loss), and the one place a browser
   popup previously carried feedback (short-reason error) is now the
   modal's inline error. Converting every page's banner to toasts is
   per-page NB2–NB4 work, not NB1.
5. **Screenshot / browser QA — NOT done** (plan assigns it to NB5 /
   ADNX16). Nothing in this doc claims visual QA; verification here
   is code-level (gates + set-diffs above).
6. **Charts (ADNX5)** — NB3 scope, untouched, per the batch split.
