# Connect Center Advanced — Batch B8 Acceptance (CC17 + CC18 + CC19)

Branch `cc-advanced`, worktree `~/workspace/ai-marketing-saas-adv`, base B7 HEAD `764846c`.
Local commits only — **no push** (owner's standing rule). Migrations **not run on any real DB**.

## What was built

### CC17 — Labels, groups, per-member access
- **Schema** (migration `20261013330000_cc17_labels_groups_access`): `label String?` +
  `groupName String?` on Integration and SocialAccount, `groupName String?` on AdAccount
  (its `label` already existed from AD6 — same semantics), `Membership.deniedConnections Json?`.
- **Grouping model decision**: a free-text `groupName` on the account rows themselves —
  deliberately **no separate Group entity**. A group is just a shared string (brand/branch);
  renaming = editing the accounts, deleting = clearing the field. Nothing else in the system
  references groups, so an entity would have been ceremony.
- **Label/group editing**: `PATCH connections/targets/:source/:targetId/meta`
  (sources `integration | social_account | ad_account`, OWNER/ADMIN), service-validated with
  AD6 discipline (trim, ≤60 chars, empty clears to null), audited `connection.meta_updated`.
  The overview returns label/groupName for all three sources; an Integration/SocialAccount
  label becomes the display name. The web renders accounts under group headings with a
  "গ্রুপ ছাড়া" (ungrouped) section last, plus a group filter.
- **Per-member access**: the deny-list lives in its **own** `Membership.deniedConnections`
  column — deliberately NOT inside `permissionOverrides`, whose M72 `normalizeOverrides`
  strips non-area keys and would have silently eaten it. Helpers in
  `common/permission-catalog.ts`: `normalizeDeniedConnections`, `isConnectionDenied`.
  M72 semantics hold: the list never applies to OWNER memberships.
  `GET connections/member-access` returns ACTIVE members + the deniable targets;
  `PUT connections/member-access/:userId` (OWNER/ADMIN) replaces the list wholesale,
  refusing OWNER targets and any id that is not a real account of the org. Audited.

### CC18 — Sync controls
- `Integration.syncPaused Boolean @default(false)` (same CC17 migration).
- **Enforcement**: `IntegrationsService` (Woo products/orders/customers/reviews) and
  `ShopifyService` (products/orders/customers) check the flag at entry: a paused sync does
  not run, records a **COMPLETED SyncJob with zero counts and `error = "sync_paused"`** (so
  the per-connection history shows the skip), and returns the AD5-style marker
  `{ skipped: true, reason: "sync_paused", jobId }`. Scheduled store syncs reach the same
  service methods through the automation job runner, so they inherit the gate.
  The email channel sync (`email_sync` job → `EmailChannelService.syncOrganization`) has no
  SyncJob rows; it returns the same skip marker as the job result instead.
  Manual HTTP triggers (`integrations.controller` sync endpoints) refuse **up front** with
  a clear Bengali 400 — the staff member is told to resume first.
- **Web**: pause/resume toggle + sync history (kind, status, counts, error, times) inside
  the account detail (AccountInsights), a ⏸ badge on paused cards, and the manual re-sync
  actions stay available (the API refusal explains a paused attempt).
- **Schedule decision (documented, not faked)**: the job system supports per-org job
  enablement + template intervals only — there is no per-integration cadence anywhere in
  the codebase. So B8 exposes pause + manual sync only; no per-connection schedule UI was
  built, and the UI says exactly why on the sync-control block.
- Ad accounts keep AD5's `syncDisabled` (no second flag): the overview now surfaces it and
  the card links to the ads page where it is managed.

### CC19 — Payment center depth
- **Environments** (migration `20261013340000_cc19_payment_depth`):
  `TenantPaymentGateway.environment` (`live | sandbox`, default `live`) with the unique
  widened to (organizationId, provider, environment); `TenantPaymentTransaction.environment`
  likewise. A tenant can now hold a Live set and a Sandbox set per provider.
- **Production is live-only, explicitly**: every CC9/CC10 production resolution passes
  `environment: "live"` (own initiate, platform flows unaffected — platform txns are always
  live), and verification resolves credentials **by the transaction's own environment**
  (`resolveCredsForTxn`), so a sandbox IPN verifies against sandbox creds and a live IPN
  against live creds — never crossed. The row's environment comes **only** from an
  explicit `environment` in the save: the CC9-era `sandbox: true` checkbox keeps its
  original CC9 meaning (a flag inside the creds — those credentials point at the
  provider's sandbox hosts) on the live row, so every CC9 flow behaves exactly as before;
  a sandbox SET exists only when the CC19 UI explicitly saves one (which forces its
  creds' sandbox flag on). This distinction is spec-pinned both ways.
- **Sandbox test initiation**: `POST connections/payment-gateways/:provider/test-initiate`
  (OWNER/ADMIN, sslcommerz|bkash only) creates a transaction against the sandbox set with
  the sentinel order id `sandbox-test`, environment `sandbox`, default ৳100 (cap ৳1,000),
  clearly labelled `test: true` everywhere it surfaces.
  **Hard safety rule, spec-pinned**: `markVerifiedPaid` refuses all money effects for
  sandbox transactions — the txn row records the verified test outcome + payload as
  evidence (audit `tenant_payment.test_verified`), but **no order transitions and no
  wallet credit can ever result**, for own and platform sources alike.
- **Transaction history + IPN viewer**: `GET connections/payment-transactions`
  (status/source/environment filters) and `GET connections/payment-transactions/:txnId/ipn`
  return the stored verified evidence with credential-shaped keys redacted by name at any
  depth (`redactSensitiveKeys`: passwd/password/secret/sign/token/auth/key patterns →
  `"***"`). The raw stored row never leaves the service unredacted.
- **Wallet statement export**: `WalletService.getStatement` computes opening (balanceAfter
  of the last ledger row before the range, else 0), the period's entries, and closing —
  from `WalletTransaction` rows alone. Tenant downloads (`GET connections/wallet/statement.csv`
  / `.pdf`, date range, date-only `to` = whole day) and admin per-org export
  (`GET admin/wallets/:organizationId/statement.csv|pdf`, SUPER|FINANCE) share the same
  builders. CSV is lossless (full notes). PDF reuses the courier `pdf.ts` writer; its
  WinAnsi fonts cannot render Bengali, so the PDF carries the ASCII-safe columns and states
  on its face that full notes live in the CSV — nothing is mangled silently.
- **Buyer "Pay online"** (storefront success page): renders only when the shop's public
  `GET public/tenant-payments/:orgSlug/payment-options` returns at least one option — an
  option exists only for an enabled own **live** gateway or a tenant-enabled +
  platform-offered platform provider (sandbox sets are never buyer options). Clicking calls
  the existing public initiation API and redirects to the real gateway URL; a refusal is
  shown verbatim — never a fake success. Returning with `?payment=verifying` shows the
  honest "being verified" note (browser return is never proof).
- **Staff "Collect payment"** (dashboard order detail): offers only paths that really exist
  (enabled own live gateways; offered+enabled platform providers), starts the same
  initiation APIs, shows the real gateway URL to copy/share, and lists the order's real
  transaction rows with live status. It never marks anything paid.

## Enforced vs only displayed

| Surface | Enforced (server refuses) | Displayed only |
|---|---|---|
| Member deny-list | Inbox human sends: `sendReply`, `sendTemplate`, `sendImageReply`, `sendMediaReply`, `sendProductCard`, and `sendDraft` (delegates to sendReply) — refused with 403 **before** any message row is created. Social: post `createPost`, `schedulePost`, manual `publishNow` for the post's account. | The matrix itself (it writes the list; enforcement lives in the send/publish paths). |
| Sync pause | Woo + Shopify sync services (all kinds), scheduled store syncs via the same methods, email channel sync (marker), manual HTTP triggers (400 up front). | The ⏸ badge/history (rendered from the real flag + real SyncJob rows). |
| Sandbox gateways | Live-only production resolution; per-environment credential resolution at verification; `markVerifiedPaid` sandbox guard (no order transition, no wallet credit). | Sandbox badges/labels in the Center and history. |
| Wallet statement | — (read/export only; no new credit path exists) | The export itself — figures are the ledger's own chain, not recomputed. |

**Not enforced / not covered (honest list)**:
- Deny-list does not gate: reading conversations, assigning conversations, AI/auto-replies
  and other system sends (they have no human actor to deny), scheduled social sweeps (the
  post's creator was checked at create/schedule time), comment replies, broadcasts
  (Messaging page senders are org-level configs, not connection targets), ad-account usage
  (ad accounts are deliberately not deniable targets in v1 — the matrix lists Integration +
  SocialAccount rows only).
- Sync pause does not gate: webhook-driven ingestion (Woo/Shopify webhooks keep recording —
  pausing sync is about pull syncs), courier status sync (no Integration row), Meta ad sync
  (AD5 `syncDisabled` is its mechanism, surfaced not duplicated).
- The IPN viewer's redaction is by key NAME; a gateway that embedded a secret inside a
  free-text value field (not a credential-shaped key) would not be caught by it. Payloads
  stored today are the gateways' own POST bodies, which carry signatures/keys as named
  fields — those are covered and spec-pinned.

## Tests

- New API suite `cc17-cc19.spec.ts` (20 tests): deny-list primitives + M72 OWNER semantics;
  meta trim/length/source validation + overview label preference; matrix listing +
  id validation + OWNER refusal; inbox refusal before any message row (allowed member and
  OWNER pass the guard untouched); paused-sync recorded skip (service), manual-trigger
  refusal (controller), email-sync marker; statement opening/entries/closing from ledger
  fixtures (Jan/Feb/empty ranges) + CSV figures + real PDF bytes; IPN redaction at depth;
  live/sandbox coexistence + legacy flag mapping; production initiation binds the LIVE row;
  test initiation's sentinel + environment; a fully verified sandbox SSLCommerz IPN
  (real signature + validation chain) leaving the order byte-identical with zero wallet
  calls; history filters + IPN viewer redaction.
- Web lib tests (+9): group filing with ungrouped last, group filter incl. the ungrouped
  sentinel, meta/pause source rules, OWNER matrix rule, paused sync label, txn status
  labels, Pay-online visibility (empty/null options → no button), option labels.

## Gates (all run sequentially on the final tree, HEAD `cad3bb5` + this doc)

- **API jest FULL: 312/312 suites, 3064/3064 tests — ALL PASS.** No flake appeared in
  the clean run (the known `cx3-debounce` intermittency did not trigger).
  Getting there took two full runs, recorded honestly:
  run #1 (pre-fix tree) failed 14 tests in 2 suites — 9 in `cc9-tenant-payments` and 5 in
  `social/social.spec`. Both were real bugs in THIS batch, not flakes:
  (1) the first putGateway mapping sent CC9-era `sandbox: true` saves to the sandbox ROW,
  breaking CC9's semantics (the flag is a creds property on the primary set) — mapping
  corrected to explicit-environment-only and pinned both ways;
  (2) the new social deny guard crashed on partial Prisma fakes without a `membership`
  delegate — both guards are now defensive reads (failure = no deny-list to enforce).
  After the fixes: connections folder 9/9 suites, cc9 + cc17-cc19 35/35, social.spec green,
  then the full run above.
- **Web vitest FULL: 36/36 files, 256/256 tests PASS** (B7 was 247; +9 B8 lib tests).
- **tsc: API 0 errors, web 0 errors. Prisma schema valid.**
- **Fresh-Postgres migration sequence: 149/149 applied clean** (147 from B7 + the 2 B8
  migrations), 194 public tables, throwaway DB dropped after. (The sandbox PG cluster's
  postgres TCP password had to be re-set to the documented value before the gate could
  connect — local sandbox state only.)
- **next build: green.**

Commits (local only, no push): `2db3ecb` schema+migrations · `88ecbd0` API ·
`e87de09` specs+web · `cad3bb5` gate fixes · this doc.

## Honest limits

- **No live payment proof**: no real SSLCommerz/bKash sandbox or live account was used —
  sandbox behaviour is proven against the stubbed gateway boundary + the real signature /
  validation logic, not against the providers' sandbox servers. M30 (owner live
  verification) is still owed for the whole payment stack, CC9/CC10 included.
- **Migrations not run on any real DB** — the two B8 migrations are proven only in the
  fresh-Postgres full sequence (see Gates).
- Statement PDF is ASCII-columns only by design (see above); CSV is the complete record.
- The member deny-list covers the send/publish surfaces listed above only — see the
  enforced-vs-displayed table for everything it deliberately does not gate.
- Nothing in this batch creates a new money path: the statement is read/export, the IPN
  viewer is read-only, sandbox initiation is fenced off from orders and the wallet by the
  `markVerifiedPaid` guard.
