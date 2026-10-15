# Connect Center B5 (CC10) — Acceptance (2026-10-13)

Branch `cc-package`, worktree `~/workspace/ai-marketing-saas-cc`. Local
commits only — NO push. Base: B4 HEAD `8d85e64`. **B5 is the final
Connect Center batch: the package CC1–CC10 is now code-complete**
(see `docs/connect-center-package-summary.md`).

## Commits
- `d135a06` CC10 schema+config: `walletConfig` platform key +
  migration `20261013240000_cc10_platform_wallet` (sequence #135).
- `78b0f70` CC10 api: WalletService + platform checkout in
  TenantPaymentsService + tenant endpoints + overview accounts +
  cc10 spec (13 cases).
- `d38432a` CC10 admin api: payout queue / decide / mark-paid /
  adjustment endpoints (SUPER|FINANCE) + platform-config wallet route.
- `e82e652` CC10 web (tenant): PlatformWalletPanel.
- `1b6138b` CC10 admin web: /payouts page + nav + Settings fee card.
- (this doc + package summary)

## What CC10 is
The tenant can accept payments through the PLATFORM's gateways
(the operator's SSLCommerz / bKash from the Admin Console platform
config). The money lands in the platform's merchant account; the
tenant's share — gross minus the platform fee — is credited to
the tenant's **Wallet**, from which the tenant requests payouts
that an admin approves and marks paid after actually sending the
money. The owner approved this scope in full on 2026-10-13,
including the platform holding tenant funds in a wallet with
admin-approved payouts. Built exactly to that scope: NO
auto-payouts, NO tenant-to-tenant transfers, NO spending wallet
balance on subscriptions/ads.

## Design choices (documented per the brief)
- **Enablement is a sibling model, not a TenantPaymentGateway
  row**: `PlatformPaymentEnablement { organizationId, provider,
  isEnabled, @@unique(org, provider) }` stores NO secret — the
  platform's credentials live only in the admin platform config.
  CC9's `TenantPaymentTransaction` is reused with
  `source: "own" | "platform"` (default `"own"`; existing rows
  are unaffected) and `gatewayId` is now nullable (platform
  transactions have no tenant gateway row).
- **Fee**: new `walletConfig` key in PLATFORM_CONFIG_KEYS (M33
  pattern) holding `{ feeBps }`; admin area `wallet` in
  updatePlatformConfig with integer 0–10000 validation, safe view
  in getPlatformConfig, `PATCH /admin/platform-config/wallet`,
  and a Settings card in the admin console. Unset/invalid ⇒
  feeBps **0** — a fee is never invented. The fee applied is the
  value current at the moment a payment is VERIFIED (snapshot
  refreshed on admin writes + scheduler tick, the M33 pattern).
- **Ledger shape at credit**: `payment_credit` (+gross, running
  balance) then `fee_debit` (−fee) ONLY when fee > 0 — so a 0-fee
  credit is exactly one ledger row (spec-pinned), and at 200 bps
  on 100000 minor the rows are +100000 → balance 100000, then
  −2000 → balance 98000 (net credit 98000, spec-pinned).

## Money discipline — how each rule is enforced
- **Credit only from verified confirmation**: initiation (own or
  platform) records `initiated` and never credits; the browser
  return never moves money. Only the CC9 trust chain — SSLCommerz
  IPN signature (with the credentials OF THE TRANSACTION'S
  SOURCE: platform IPNs verify against the platform store pass)
  + validation API VALID with tran/amount/currency/store match,
  or bKash execute/query `Completed` with exact amount — reaches
  `markVerifiedPaid`. For `source="platform"` that delegates to
  `WalletService.creditVerifiedPlatformPayment`, which runs the
  transaction transition + order evidence + wallet credit + ledger
  rows as ONE Prisma transaction, re-checking the status inside
  it: a re-delivered IPN is a no-op and cannot double-credit.
- **Holds**: available = balance − Σ(payout requests in
  `pending | approved`). Request creation validates inside a
  transaction, so two pending requests cannot jointly exceed the
  balance. Rejecting or cancelling frees the hold (the formula
  simply stops counting the row); approving re-validates against
  the CURRENT balance.
- **Mark-paid is the only exit**: requires status `approved` and
  a mandatory `payoutRef`; inside one transaction it re-checks
  `amount ≤ balance − other holds`, appends the single
  `payout_debit` row, decrements the balance, and marks the
  request paid — a second mark-paid refuses, so the debit can
  happen exactly once and can never overdraw even if the balance
  changed after approval (spec-pinned via an intervening admin
  adjustment).
- **No tenant credit path exists**: the tenant wallet surface is
  GET wallet, GET/POST payout-requests, POST cancel, and the
  enablement toggles. There is no endpoint — tenant or otherwise —
  that creates a ledger credit except the verified-payment path
  and the admin adjustment.
- **Admin adjustment**: the sole manual correction path. Note is
  mandatory, the acting admin's id is recorded on the ledger row
  (`createdById`) and in the audit log, and a result below zero
  is refused.
- Amounts are server-computed BigInt minor units end to end; the
  API crosses amounts as decimal strings. Payout `destination`
  is tenant-entered sensitive data, returned only to its own org
  and to the admin payout queue.

## Surfaces
- **Tenant API** (connections module guard stack, OWNER/ADMIN
  writes): `GET connections/platform-payments` (offer + enablement
  + current fee), `PUT connections/platform-payments/:provider/enabled`
  (refuses enabling a provider the platform hasn't configured),
  `POST connections/platform-payments/:provider/initiate-payment`,
  `GET connections/wallet` (balance / held / available / ledger),
  `GET|POST connections/payout-requests`, `POST
  connections/payout-requests/:id/cancel` (pending only). The
  public storefront initiation accepts `source: "platform"`.
- **Admin API** (`SUPER | FINANCE`): `GET
  admin/payout-requests?status=`, `POST
  admin/payout-requests/:id/approve|reject|mark-paid`,
  `POST admin/wallets/:organizationId/adjust`,
  `PATCH admin/platform-config/wallet`.
- **Tenant web**: the Connect Center Payment section's CC10
  "upcoming" note is replaced by the real `PlatformWalletPanel` —
  per-provider toggles driven by the API's offer (a provider the
  platform hasn't configured shows as unavailable, NOT toggleable),
  wallet card with the CURRENT fee % from the API (never
  hardcoded), ledger history, payout form (bKash/bank) and the
  request list with statuses and pending-cancel. The overview
  payment category now includes platform enablements as accounts.
- **Admin web**: new `/payouts` page (nav: Wallet Payouts) —
  cross-org queue with status filter, approve / reject (note
  prompt) / mark-paid (reference prompt), and the adjustment
  form; Settings gains the wallet fee card.

## Which providers the platform can carry — honestly
Only **SSLCommerz and bKash**: those are the platform checkouts
the codebase actually wires (M36/M39). Nagad has no platform API
checkout wired anywhere in this codebase, so it is never offered
as a platform gateway (the tenant's manual Nagad path is
unchanged); Rocket is a manual-number path, never a gateway.
Enabling or initiating an unoffered/unconfigured provider
refuses with a Bengali explanation — no fake checkout is produced.

## Specs (cc10, 13 cases, stubbed gateway client + platform
snapshot)
Enablement refusal when the platform hasn't configured the
provider; initiation refusal when not enabled / when platform
config disappears; platform txn shape (source, null gatewayId);
unverified IPN credits nothing (bad signature, unconfirmed
validation); verified IPN fee math + exactly-once (double
delivery no-op); fee 0 = single ledger row; bKash platform credit
only after execute `Completed` + exact amount; payout above
available refused; two pending jointly exceeding refused; cancel
frees hold; approve → mark-paid debits exactly once (second
refuses; missing payoutRef refuses); mark-paid overdraw guard
after a post-approval balance change; reject requires note and
frees hold; tenant cannot forge a credit (payout paths create
zero ledger rows; negative/zero amounts refuse); admin adjustment
requires note, records actor, cannot go negative.

## Gates (run 2026-10-13, sequentially)
- API jest FULL (NODE_OPTIONS=--max-old-space-size=4096):
  **285/285 suites, 2762/2762 tests PASS** (2749 at B4 + 13 cc10).
  The known cx3-debounce flake PASSED this run — no solo re-run
  needed.
- Web vitest FULL: **34 files, 234/234 PASS** (230 at B4 + 4 new).
- Admin vitest: pass-with-no-tests (exit 0, the admin app has no
  test files); admin `next build` green with the `/payouts`
  route; admin tsc 0.
- tsc api + web: **0 errors**. Prisma validate: **valid**.
- Fresh-Postgres migration sequence: **135/135 applied clean**
  (throwaway PG16, `prisma migrate deploy`; 0 failed/rolled back;
  WalletAccount / WalletTransaction / PayoutRequest /
  PlatformPaymentEnablement verified present; `source` added and
  `gatewayId` nullable verified).
- next build (web): **green**, `/dashboard/connections` route
  present.

## Honest limits
- **No live platform-gateway or payout proof exists or is
  claimed**: no real platform SSLCommerz store, bKash merchant
  account, or real payout was exercised from this sandbox — all
  gateway boundaries are spec-proven with stubbed clients at the
  injectable seam (the codebase pattern). Live verification with
  the owner's real platform merchant accounts AND a real payout
  is M30 territory.
- Migration `20261013240000_cc10_platform_wallet` is NOT run on
  any real DB; it is fresh-PG sequence-verified only (135/135).
  No CC migration (20261013210000–20261013240000) has run on the
  production DB.
- The fee is read from the platform-config snapshot (refreshed
  on admin writes and the scheduler tick — the M33 pattern), so
  a fee change applies to payments verified after the refresh,
  exactly like every other platform-config consumer.
- The buyer-facing shop "Pay online" button (own or platform)
  remains the UI follow-up already noted in B4 — the initiation
  APIs (dashboard + public storefront, both sources) are complete
  and spec-proven, but no shop button was added in this batch.
- Wallet balances are BDT-only in practice (WalletAccount carries
  a currency column defaulting to BDT; platform gateways settle
  BDT). Cross-currency wallets are not built.
- Holding tenant funds has legal/policy dimensions (the owner's
  conscious decision, recorded in the plan): the code enforces
  accounting discipline, not regulatory compliance — licensing /
  escrow obligations for the platform remain the operator's to
  settle before real money flows.
