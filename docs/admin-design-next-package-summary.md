# Admin Design Next (ADNX) — Package Summary

- **Package:** ADNX1–ADNX18 in 5 batches (NB1–NB5), plan
  `~/workspace/goals/ai-marketing-saas-platform-build/files/Admin-Dashboard-Design-Next-Plan-2026-10-16.md`
- **Worktree / branch:** `~/workspace/ai-marketing-saas-adnx`, `admin-design-next`
- **Base:** GitHub main `cf3efd5` · **Local commits only — NO push**
- **Scope held across the whole program:** `apps/admin` + `docs`
  only. No new API endpoint, no backend change, no migration, no
  schema change, no config-key change.
- **NO LIVE PROOF.** Nothing in this package has run against the
  live admin with a real operator account. What visual QA was and
  was not executed is stated exactly in the ADNX16 row and in
  `admin-design-nb5-acceptance.md`.

## Item-by-item audit (ADNX1–ADNX18)

| Item | Status | Batch | Commit | Note |
|---|---|---|---|---|
| ADNX1 Design System v4 + Bengali font | **BUILT** | NB1 | `6447644` | Tokens/typography/status mapping; Hind Siliguri self-hosted (4 weights) |
| ADNX2 DataTable v3 | **BUILT** | NB1 | `dcb3d42` | Component + adoption; exceptions in the deferred list (system's 3 inner tables, analytics onboarding, usage class-level) |
| ADNX3 Toast + browser-dialog elimination | **BUILT** | NB1 | `58ed97c` | Final grep for prompt/alert/confirm: **0** |
| ADNX6 Shell polish | **BUILT** | NB1 | `e8dfb17` | Mobile bottom quick bar, skip link, palette sheet; tablet auto-rail deferred (recorded decision) |
| ADNX4 State completeness | **BUILT** | NB2 | `ba61a50` | Skeleton/empty/error+retry across the program's pages, batch by batch |
| ADNX7 Command Center | **BUILT** | NB2 | `1d3a0fc` | করণীয় rail, honest KPI references (no fabricated trends) |
| ADNX8 Customers | **BUILT** | NB2 | `120aba2` | Lists + unified detail pattern, mobile detail action bar |
| ADNX9 Money | **BUILT** | NB2 | `9d82ea7` | Billing form pattern + KPI rail; payouts queue polish; no invented large-amount flag |
| ADNX5 Lightweight SVG chart | **BUILT** | NB3 | `6bebd55` | Bar variant consumed by Analytics; line variant built, no consumer (recorded) |
| ADNX10 Support & Trust | **BUILT** | NB3 | `21578b3` | Tickets two-step mobile, Audit drawer, Admins on DataTable (closes NB1's tickets deferral) |
| ADNX11 Operations | **BUILT** | NB3 | `1168f26` | Health/Alerts/System/Social-Ops states, toasts, mobile tabs |
| ADNX12 Analytics/Usage/Growth | **BUILT** | NB3 | `f9ea7b6` | Chart adoption, sticky range, form pattern |
| ADNX13 Security + Settings | **BUILT** | NB4 | `d15b782` | Sessions DataTable, modal-confirmed dangerous actions, Settings chip rail + dirty tracking |
| ADNX14 Search/Login/TOTP | **BUILT** | NB4 | `662768a` | Palette-aligned search, login/TOTP on the dashboard visual system |
| ADNX15 Personalization completion | **BUILT** | NB4 | `1e78bfa` | SavedViews completion, last-used filters, cross-page slate-500 sweep to 0 |
| ADNX16 Responsive + screenshot QA | **PARTIAL** | NB5 | `7f645cc` | EXECUTED in-sandbox for unauthenticated surfaces: 8 real screenshots (login/TOTP × 360/768/1280 + branded-404 before/after) + overflow measurements at 6 widths + static audit of all 22 pages. NOT executed: every authenticated page (they redirect to login without a live API + auth) and the 5 journeys — all in the post-deploy checklist, every box unchecked |
| ADNX17 Accessibility + first tests | **BUILT** (code level) | NB5 | `1f194d8` | A11y audit table, focus return + modal focus fixes, slate-600 content-text fixes, **9 passing component tests** (the admin app's first). Full keyboard-journey + screen-reader verification is live-only and NOT claimed |
| ADNX18 Performance record + summary | **BUILT** | NB5 | this commit | Numbers below are from the final NB5 production build |

## Program totals (ONE consistent set — final NB5 tree)

| Measure | Value | Method |
|---|---|---|
| Commits (base `cf3efd5` → package end) | **23** | NB1 5 + NB2 5 + NB3 5 + NB4 4 + NB5 4 (ADNX16, ADNX17, ADNX18, NB5 acceptance) |
| Routes | **22** — identical set to base | `page.tsx` set-diff base vs final: identical; final build lists the same 22 (+ `/_not-found`) |
| Nav hrefs | Identical to base | set-diff on `nav.tsx` href literals |
| API literals (`/admin/...` in `apps/admin/src`) | **122 = 122**, identical | one scan (grep -oE over git trees, sorted unique) applied to both base and final |
| Browser dialogs | **0** | grep `window.prompt/alert/confirm` + bare calls |
| `text-slate-500` in `apps/admin/src` | **0** | grep (NB1-measured below-AA class fully swept) |
| PageHead adoption | **22/22** | 20 pages import the component; login + TOTP adopt the PageHead pattern (no shell) — distinction recorded since NB4 |
| DataTable adoption | Component: **7 pages** (admins, analytics, health, orgs, security, social-ops, users) + Chart fallback; class-level card pattern (`.atable-cards.atable-v3`): **4 pages** (audit, billing, payouts, usage); recorded exceptions: system's 3 inner raw tables, analytics onboarding table, settings' 1 table — all inside their own scroll containers, never page-level |
| Admin tests | **1 file, 9 tests, all passing** | `pnpm test` (vitest 2.1.9, node env, renderToStaticMarkup — the web app's pattern; no config file needed) |
| Screenshots executed | **8 files** in `docs/qa-nb5/` | login ×3, totp ×3, 404 before/after ×2 — all eyeballed; index + verdicts in the NB5 acceptance |

## Performance record (ADNX18 — final production build, this tree)

Per-route Size / First Load JS from the final `next build`
(identical to the pre-NB5 build on every route except
`/_not-found`, which dropped 994 B → 127 B when it became the
small custom page):

| Route | Size | First Load | | Route | Size | First Load |
|---|---|---|---|---|---|---|
| `/` | 4.5 kB | 120 kB | | `/orgs/[id]` | 6.48 kB | 122 kB |
| `/admins` | 1.85 kB | 117 kB | | `/payouts` | 4.47 kB | 120 kB |
| `/alerts` | 1.8 kB | 117 kB | | `/search` | 1.79 kB | 117 kB |
| `/analytics` | 4.34 kB | 120 kB | | `/security` | 4.81 kB | 120 kB |
| `/audit` | 2.76 kB | 118 kB | | `/settings` | **14.8 kB** | **130 kB** |
| `/billing` | 6.14 kB | 122 kB | | `/social-ops` | 3.9 kB | 119 kB |
| `/growth` | 6.21 kB | 122 kB | | `/system` | 8.08 kB | 124 kB |
| `/health` | 3.75 kB | 119 kB | | `/tickets` | 3.03 kB | 118 kB |
| `/login` | 2.78 kB | 105 kB | | `/usage` | 3.25 kB | 119 kB |
| `/login/totp` | 1.94 kB | 105 kB | | `/users` | 2.74 kB | 118 kB |
| `/orgs` | 3.32 kB | 119 kB | | `/users/[id]` | 3.35 kB | 119 kB |

Shared by all: **103 kB** First Load JS (46.5 + 54.2 + 1.93 kB chunks).

- **Outlier:** `/settings` — largest route (14.8 kB / 130 kB), as
  expected: it is the 800+ line Config Hub holding every provider
  block in one page by the owner's ADX9 decision (in-page sub-nav,
  no route split). Not a defect; splitting it is a routing
  decision for the owner, not a polish fix. Next: `/system`
  (8.08 kB) for the same reason (5 tabs in one page). No other
  route exceeds 6.5 kB.
- **Font payload (emitted files, `.next/static/media`):** Hind
  Siliguri Bengali subset, woff2 — 400: 71,076 B · 500: 73,688 B ·
  600: 74,784 B · 700: 72,956 B (**292,504 B total across all four
  weights**; a browser downloads only the weights a page actually
  renders, each with a ~51 kB woff fallback for legacy engines).
  Inter Variable: latin 48,256 B + latin-ext 85,068 B (unicode-range
  split; a Bengali/English console page realistically loads latin +
  the Hind weights it uses). No font change was made in NB5 and no
  speculative optimization is claimed.
- **No performance fix was applied in NB5:** no clear, safe win was
  found (no duplicate imports, no accidental double-loading in the
  build output). Observations only, per the item's rule.

## Consolidated deferred / deviation list (NB1–NB5, ONE list)

**Closed along the way (recorded so they are not re-opened):**
tickets DataTable adoption (NB1→NB3 ADNX10); per-page toast
adoption (NB1→NB2–NB4); page-level slate-500 sweeps (NB2/NB3→NB4
ADNX15 cross-page pass, final count 0).

**Still open / NOT BUILT, with reasons:**
1. **Authenticated screenshot QA + the 5 mobile journeys + all
   flagged visual checks** (settings chip rail, dirty dot,
   sessions card at 360, TOTP tap target, tickets sheet,
   social-ops tab, chart at 360, audit drawer) — post-deploy only;
   `docs/admin-design-next-live-qa-checklist.md`, all unchecked.
2. **Mobile toast vs detail action-bar overlap — CONFIRMED BY CODE
   in NB5, NOT fixed.** `.atoast-wrap` sits at `bottom: 76px` on
   mobile while the org/user detail action bar is fixed at
   `bottom: 64px + safe-area` with ~56–60px height (taller when
   buttons wrap) — a toast on a detail page will overlap the bar
   transiently. A blind CSS offset change was not made: the bar's
   height varies with wrapping, so the fix needs eyes on a real
   device (checklist item) rather than a guessed number.
3. **Full focus-trapping in dialogs — NOT built.** ConfirmModal /
   DialogHost / DetailDrawer / CommandPalette all have Escape-to-
   close and (after NB5) focus-in + focus-return, but Tab is not
   hard-trapped inside the dialog. For a single-operator console
   this was judged acceptable across ADX/ADNX; recorded here as a
   known limitation, not a claim.
4. **Tablet icon-rail auto-default** — deferred by recorded
   decision (NB1): below lg the drawer replaces the sidebar; the
   rail exists as a persisted operator toggle. Revisit only on
   owner request.
5. **KPI ▲▼/percentage trends — deliberately NOT built** (NB2):
   an incomplete current month vs a complete previous month would
   fabricate a trend. Only exact-definition previous-month
   references are shown.
6. **Second payout "large amount" flag — NOT built** (NB2): no
   such field exists in the payout payload or config; the
   four-eyes flag is the only amount flag.
7. **System's 3 inner raw tables** (BullMQ queues, DB growth,
   Activity Log) **kept `.atable`** (NB3) — per-tab states were
   the ADNX11 mandate; these carry per-row action clusters.
   Candidate for a later polish pass.
8. **Analytics onboarding table kept container-scroll** and
   **Usage's tables kept class-level card adoption** (NB3) —
   recorded per-table choices, same rendered pattern.
9. **Social-Ops positive empty texts kept** (emerald all-clear
   paragraphs) instead of neutral EmptyState (NB3) — they carry
   status meaning by design.
10. **Tickets bubbles' inline light backgrounds** (`#eef2ff` /
    `#f1f5f9`, from ADX10) — restyle-or-accept decision deferred
    to the live visual pass (checklist item).
11. **Silent-success updates** (tickets status/assign/priority;
    org-detail flags toggle) — kept as at base (NB2/NB3 recorded
    decisions; failures toast).
12. **Settings config-block field-level errors — NOT built**
    (NB4): no client-side validation exists at base; inventing
    rules risked rejecting server-valid values. Errors surface
    as toasts.
13. **Unsaved-changes router guard — N/A by construction** (NB4):
    `beforeunload` covers all exits (shell navigation is
    full-document). If the shell ever moves to `<Link>`, a
    router-level guard becomes necessary.
14. **SavedViews for billing/alerts/admins/social-ops and usage's
    main ranking — NOT built** (NB4): those pages have no filter
    state to save.
15. **Security's Admins list + API-key list kept `<ul>` form**
    (NB4) — short rosters, not tables; only sessions were
    mandated to DataTable.
16. **Chart `line` variant has no consumer** (NB3) — built and
    tested at component level only via the bar path; no page's
    data called for a line rendering.
17. **Remaining `text-slate-600` (4 spots) — decorative only:**
    `.anav-off` (no-access nav items, muted by design), the
    payouts "→" step separator, the breadcrumb chevron, and the
    sidebar pin icon (invisible until row hover/focus). All
    content-bearing small text is at slate-400 or brighter
    (final counts: slate-500 = 0, content slate-600 = 0).

## Owner-gated remainder

1. **Integration:** this branch is based on `cf3efd5`. If GitHub
   main has moved by integration time (a campaign release was in
   flight during NB5), a union integration + fresh gates are
   required before any release — per the standing rule.
2. **Push:** only on the owner's explicit in-the-moment
   instruction, after `ls-remote` + fetch (the owner also pushes
   directly; his commits merge in, never overwritten).
3. **Deploy:** the owner's manual Dokploy Redeploy.
4. **Live QA:** execute `docs/admin-design-next-live-qa-checklist.md`
   after deploy (22 pages × 6 widths × filled/empty + 5 journeys +
   flagged checks). Until then the package is code-complete and
   sandbox-verified only — **not live-proven**.
