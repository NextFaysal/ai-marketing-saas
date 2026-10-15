# Integration-2 Acceptance — EC Phase-2 × Connect Center merged release line (2026-10-13)

Branch `integration-2` in worktree `~/workspace/ai-marketing-saas-int2`.
**Local work only — NOTHING pushed.** This branch is the base for the
next package (Connect Center Advanced, CC11–CC20).

## Merge summary
- Base: `ec-phase2` HEAD `a029713` (E-commerce Phase-2 B7–B11
  code-complete: EC13–EC24 + CP).
- Merged in: `cc-package` HEAD `c0cfe48` (Connect Center CC1–CC10
  code-complete) with a REAL merge commit `b3c2a6a` (no squash, no
  history rewrite; neither source branch was touched).
- cc-package's base `d2e66fc` is an ancestor of `a029713`, so the
  merge brought in exactly the CC delta (B1–B5) on top of the full
  EC Phase-2 line.
- Merged tree: **189 Prisma models**, **145 migration folders**.

## Conflicts — exactly ONE, resolved by union
`apps/api/src/app.module.ts` (two hunks): HEAD carried the EC
Phase-2 module imports/registrations (Feeds, Purchasing, Warehouse,
Delivery, Tax, Subscriptions); the CC side added `ConnectionsModule`.
Resolution: BOTH kept — imports and the `imports:` array now carry
all EC modules **plus** ConnectionsModule. No feature dropped.

Everything else auto-merged; the hotspots named in the brief were
verified by content after the merge, not assumed:
- `schema.prisma`: auto-merged; verified union — CC models
  (TenantAppConfig, OrgLlmConfig, TenantPaymentGateway,
  TenantPaymentTransaction, WalletAccount, WalletTransaction,
  PayoutRequest, PlatformPaymentEnablement) and EC models
  (LandingPage, Promotion, ProductFeed, DeliverySlot, TaxSetting,
  Warehouse, PurchaseOrder, …) all present exactly once;
  `Integration.isDefault` + `appSource`, `SocialAccount.appSource`,
  `TenantPaymentTransaction.source/gatewayId` present; no duplicate
  model definitions; `prisma validate` valid + client generates.
- `admin` module: CC payout endpoints on AdminController
  (SUPER|FINANCE tier) AND AdminModule's ConnectionsModule import
  present alongside the EC tax/accounting surface; admin `/payouts`
  page builds.
- `common/platform-config.ts`: CC `walletConfig` key present
  (3 references) alongside all prior keys.
- `inbox.service`: CC connectMessaging keying/appSource arrived via
  the CC delta; the full inbox + messaging suites pass on the merged
  tree (see gates) — no EC-side inbox change existed to lose.
- Integrations web page / CommerceConnectPanel: the EC line made NO
  change to the integrations page after the shared B7 base
  (`git diff d2e66fc..a029713` for that path is empty), so the CC
  extraction (panel shared, page a thin wrapper) loses nothing;
  dashboard nav href union verified — no href from either line is
  missing in the merged layout.
- Orders/payments: B8's PaymentVerification-backed staff advances
  and CC9/CC10's TenantPaymentTransaction/Wallet models are distinct
  models and both survive; their suites pass together.

## Migration count — brief/ledger discrepancy, investigated
The brief expected 137 folders from an older ledger snapshot. The
OBSERVED merged count is **145**, and the arithmetic is fully
accounted for: live base 129 + EC Phase-2 12 (ec13, ec15, ec18,
ec19, ec14, ec16, ec20, ec21, ec22, ec23, ec24, cp — the last eight
landed after that snapshot) + CC-only 4 (cc2, cc3, cc9, cc10) = 145.
The ledger's own correction (2026-10-13 ~15:52) already tracked EC
reaching 141 and CC adding its B4/B5 migrations; CC B4/B5 ultimately
used prefixes 20261013230000/20261013240000 (not the reserved
310000+ range), creating two ADDITIONAL same-prefix pairs.

Same-prefix safety check (the cx7 lesson): all four colliding pairs
were read at SQL level — each pair touches disjoint tables only:
- 210000: cc2 = `Integration.isDefault`; ec18 = DeliverySlot +
  Order/StorefrontSetting columns.
- 220000: cc3 = TenantAppConfig + appSource columns; ec19 =
  StorefrontSetting/PaymentVerification columns.
- 230000: cc9 = OrgLlmConfig/TenantPaymentGateway/
  TenantPaymentTransaction; ec14 = ProductFeed.
- 240000: cc10 = Wallet/Payout/PlatformPaymentEnablement +
  TenantPaymentTransaction.source; ec16 = Promotion + Customer/
  Order/StorefrontSetting columns.
Within each prefix the `cc*` folder sorts before the `ec*` folder,
and no EC migration references a CC table (the EC line was built
without them) while cc10's only cross dependency is on cc9 (an
earlier prefix). No folder was renumbered or dropped.

## Gates (merged tree, run sequentially 2026-10-13)
- API jest FULL (NODE_OPTIONS=--max-old-space-size=4096):
  **308/308 suites, 3010/3010 tests PASS** — the known cx3-debounce
  flake did not appear this run.
- Web vitest FULL: **242/242 PASS**.
- Admin: vitest has no test files in this app (its own `test`
  script is `vitest run --passWithNoTests`, the state the CC B5
  gate recorded); tsc 0; next build green incl. `/payouts`.
- tsc: API 0, web 0, admin 0 errors. Prisma validate: **valid**.
- **Fresh-Postgres migration sequence: 145/145 applied clean,
  0 unfinished/rolled back, 190 public tables** (Postgres 16.4,
  throwaway cluster, `prisma migrate deploy` exit 0; verified via
  `_prisma_migrations` counts, not just the CLI tail).
- Web next build: **green** (`/dashboard/connections` present).

## Deploy checklist carried forward (ALL still open)
1. **Push is owner-gated and has NOT happened.** On the owner's
   explicit instruction: `ls-remote` + fetch GitHub main FIRST
   (the owner also pushes directly — merge his commits, never
   overwrite, never force-push), then push this line, then a
   manual Dokploy Redeploy (push-to-deploy is not assumed working).
2. **No migration in this tree has ever run on the real
   production DB** — that now means the full pending set: the 33
   from the previous release line + EC Phase-2's 12 + CC's 4.
   First production contact for all of them is the deploy's
   `prisma migrate deploy`; the sequence is fresh-DB verified
   (145/145) but production carries existing data — the cx7
   discipline applies: watch the API container log on Redeploy.
3. Admin setup still owed: platform gateway credentials for CC10,
   `walletConfig` feeBps (default 0 until set), gateway-side IPN/
   callback URLs for the tenant-payment routes (see
   docs/connect-center-package-summary.md §3).
4. **Live verification still owed:** M30 (every provider: Meta/
   TikTok apps and accounts, Woo/Shopify, couriers, SMTP/SMS, LLM,
   tenant + platform gateways, a real payout) and EC12 (real
   Woo/Shopify stores). Nothing in either package is live-proven.
5. Known UI follow-up carried from CC9: shop "Pay online" buyer
   button + staff collect button (initiation APIs complete;
   scheduled as part of CC19 in the Advanced package).
