# Campaign Release — 2026-10-16

Owner-authorized release of the completed campaign-line work to GitHub main.

## Composition

- Base: GitHub main `cf3efd5` (R2 Media release). Diffing first showed main
  ALREADY contained the campaign-next line through the Frontier package
  (NB8, `547fb0c`) — CN1–CN18, the DX2 endpoints (week-summary,
  audience-sources) and all 8 campaign migrations were already on main.
- This release adds exactly the remaining delta `547fb0c..349e6de` from
  campaign-next: DX2 step-shell + hub tabs, DX3 (guided review, funnel
  wizard, §5 badge-colour fix, money unification), the DX3🚩
  audience-sources mini-fix, Design Round 2, and the LIVE-CRASH HOTFIX
  (`lib/as-list.ts` — normalizes array | paginated-envelope list
  responses; the campaign-builder page crashed with ".map is not a
  function" because GET /products returns an envelope since the EC
  pagination).
- Merge commit `74a2f9c`: 25 files, +3,091/−416. 21 files clean,
  `docs/campaign-ux-architecture.md` already identical, 4 files 3-way
  merged keeping BOTH sides:
  - `campaigns.service.ts` — CN weekSummary + audienceSourceCatalog ∪
    R2 PublicMediaService CDN preference
  - `globals.css` — other-track CSS ∪ cbx / r2-print styles
  - `r/[token]/page.tsx` — report-share polish ∪ main-side fix
  - `ad-accounts/page.tsx` — DX2 connect-form-to-top ∪ CC28 appSource
    select re-inserted into the moved form (form present exactly once)
- NO new migrations: the merged tree's migration set is identical to
  main's (194 folders).

## Gates (merged tree)

- Fresh Postgres (throwaway PG16): **194/194 migrations applied clean**,
  256 public tables.
- API jest (--runInBand, 10 chunks × ~42 suites, 418 suites total):
  all chunks green EXCEPT the three adjudicated items below.
- Web vitest: **60 files, 474/474 pass**. tsc: api 0, web 0.
  Prisma validate: OK. Builds: web 0, admin 0, api (tsc build) 0,
  worker 0, contracts 0.

### Adjudicated test items (none caused by this release)

1. `inbox/cx3-debounce.spec.ts` — 1 failure inside chunk 5; solo re-run
   **18/18 pass**. The long-documented timing flake (present since NB3,
   reproduces on pristine bases).
2. `social/social-pp1.spec.ts` — 2 failures inside chunk 9, both 5s
   timeouts on REAL sharp SVG→PNG conversions while three jest runners
   ran in parallel; solo re-run **5/5 pass**.
3. `connections/cc26-payout-automation.spec.ts` — 1 DETERMINISTIC
   failure: second payout sweep returns reason `below_threshold`,
   expected `already_created_for_slot`. PRE-EXISTING on base `cf3efd5`:
   reproduced the same night on the tenant-domain tree (same base, no
   campaign merge) and solo on this tree. This release's delta contains
   no connections/wallet files. Disclosed here; needs its own fix —
   the second-sweep reason ordering looks like a real logic issue in
   the payout sweep, not a test artefact.

## Live effect

Pushing this release does not change the live site by itself. The
owner's manual Dokploy Redeploy (web + api) makes it live; the
campaign-builder crash page is fixed only after that redeploy. CN12's
27-item live checklist and DX4's 49-box screenshot QA remain
owner-gated and unchecked.
