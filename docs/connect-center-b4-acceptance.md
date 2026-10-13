# Connect Center B4 (CC8+CC9) — Acceptance (2026-10-13)

Branch `cc-package`, worktree `~/workspace/ai-marketing-saas-cc`. Local commits
only — NO push. Base: B3 HEAD `720162c`.

## Commits
- `c1d1199` CC8 api: per-org LLM config (OrgLlmConfig) + LlmFactory.forOrg
  resolver + wiring into the org-scoped AI paths + llm-config endpoints +
  overview AI account + cc8 spec. (The schema commit also carries the CC9
  table definitions; their migration lands in the CC9 commit below.)
- `c4ceb41` CC9 schema: migration `20261013230000_cc9_tenant_payment`
  (sequence #134: OrgLlmConfig + TenantPaymentGateway +
  TenantPaymentTransaction) + TenantGatewayClient.
- `2776902` CC9 api: gateway config CRUD + checkout initiation + public
  IPN/callback with the verified-only trust chain + overview payment
  accounts + cc9 spec.
- `6b6cb56` CC8+CC9 web: sender forms, own-LLM card, Payment section in the
  Connect Center.
- (this doc)

## CC8 — Senders + AI keys in the Center

### Senders
No backend was duplicated: the Connect Center's `SenderConnectPanel` calls
the EXISTING MS4 endpoints (`GET/PUT organizations/:id/messaging/senders`,
`PUT …/senders/email`, `PUT …/senders/sms`, `POST …/senders/email/test`)
with byte-identical body shapes to the Messaging page (builders pinned by
vitest). Tenant SMTP keeps its real-handshake verify-before-save; SMS keeps
its honest "no pre-verification exists — the first real send is the proof"
note. The Messaging page itself is untouched and keeps working.

### Own LLM key — audit first
How LLM resolution worked before CC8: `LlmFactory.getProvider()` builds ONE
provider from the platform-config snapshot (Admin Console → env), cached by
fingerprint. NO call site carried an organizationId into the factory — the
services have the org id, the factory never saw it.

What was built (the maximal honest version):
- **Model `OrgLlmConfig`** (TenantAppConfig pattern, one row per org):
  provider (`openai|anthropic|gemini`), optional model, sealed
  `{ apiKey }` (`encryptJson`), status, isEnabled, lastVerifiedAt/lastError.
- **Config API** in the connections module (same guard stack, OWNER/ADMIN
  writes): `GET/PUT/DELETE organizations/:id/connections/llm-config`.
  Verify-before-save is a REAL minimal completion through the existing
  provider client (`LlmVerifyClient` → `buildLlmProvider(...).complete(...)`);
  a provider error is surfaced as a clean 400 and NOTHING is saved. On
  success the row is `verified`. The key is never returned (the view does
  not even read it).
- **Resolver**: shared reader `resolveOrgLlmConfig` (defensive — missing/
  disabled/undecryptable ⇒ null) + `LlmFactory.forOrg(organizationId)`:
  tenant config wins for that org; otherwise the platform provider,
  unchanged. Tenant providers are cached per org, keyed by a hash
  fingerprint of the key (never the key). `providerForOrg()` helper keeps
  spec fakes that only expose `getProvider()` working.
- **Overview**: the AI category now shows the own-LLM row as a real account
  when one exists; otherwise the previous `platform_managed` /
  `not_configured` states remain.

### LLM wiring — wired vs NOT wired (no silent partial coverage)
WIRED through `providerForOrg` (org id in scope at the call site):
- AI Assistant chat — `chat.service.ts` send + stream (2 sites)
- Inbox AI — `inbox.service.ts`: autopilot reply, handover summary,
  translate, conversation summary, next-action, reply draft, ghost
  complete, tone rewrite (8 sites)
- `ai-instructions.service.ts` unanswered-question drafts (1 site)
- Messaging MS9 AI copy + subject drafts (via `messagingAiProvider(orgId)`)
- CX8 Vision (`vision.service.ts`), AI Reports (`reports.service.ts`),
  Creative Studio (`creative-studio.service.ts`), Proposals product-copy
  (`proposals.service.ts`), Social AI captions (`social-ai.service.ts`)

NOT wired (still resolve the PLATFORM provider — listed deliberately):
- `campaigns.service.ts` — 2 AI sites (ad-copy generation paths; their
  call chain does not carry a single org context at the factory call
  in the same way and was left untouched rather than half-converted)
- `competitors.service.ts` — 3 sites, plus `review-miner.ts` and
  `video-deconstructor.ts` (they receive the factory without an org
  parameter in their current signatures)
- `workflows.service.ts` — 1 site (workflow AI step executes inside a
  job context; org threading there is a separate change)

These paths behave exactly as before CC8 (platform LLM). Wiring them is a
mechanical follow-up now that `LlmFactory.forOrg` exists.

## CC9 — Tenant's OWN payment gateway

### Reuse
The platform payments code (M36 SSLCommerz + M39 bKash, SaaS subscription
billing) was inspected first. `TenantGatewayClient` mirrors its wire
discipline exactly (same endpoints/payloads/token cache) parameterized by
the TENANT's credentials, and the IPN signature check reuses the exported
`verifyIpnSignature` from `payments.service.ts` verbatim. Money settles
DIRECTLY to the tenant's merchant account — the platform never holds it
(CC10 is the separate platform-payment/wallet batch and appears in the UI
only as a clearly-marked upcoming note).

### Models (migration `20261013230000_cc9_tenant_payment`, sequence #134)
- `TenantPaymentGateway` { organizationId, provider, encryptedData
  (sealed JSON creds), status, isEnabled, lastVerifiedAt, lastError,
  `@@unique([organizationId, provider])` }
- `TenantPaymentTransaction` { organizationId, gatewayId, orderId,
  provider, amountMinor (BigInt), currency, status
  (initiated|verified_paid|failed|cancelled), providerTxnId, valId,
  ipnPayload (the verified payload, kept as evidence), timestamps }

### Per-provider verification truth table
| Provider | Config verify | Status saved | Checkout initiate | Confirmation that marks paid |
|---|---|---|---|---|
| bKash (tokenized) | REAL grant-token call with the tenant's creds | `verified` (failure ⇒ nothing saved, bKash's error shown) | `/checkout/create` → real bkashURL | Callback ⇒ server-side EXECUTE (fallback QUERY) must say `Completed` + exact amount + currency |
| SSLCommerz | NONE exists — the validation API needs a val_id from a real transaction | `configured` (+ `no_pre_transaction_check` note) | Session init → real GatewayPageURL | IPN ⇒ signature (tenant store pass) + validation API `VALID` + tran_id / amount / currency / store_id exact match |
| Nagad | No merchant-API credential check is wired in this codebase | `configured` (+ same honest note) | REFUSED honestly — no Nagad API checkout is wired; the manual Nagad-number path remains | — |
| Rocket | — | — | — | NOT an API gateway: refused by the config API with a pointer to the existing BusinessProfile manual path (Settings → payment note). Never presented as a gateway. |

### Checkout + confirmation paths
- Dashboard: `POST organizations/:id/connections/payment-gateways/:provider/initiate-payment`
  { orderId } (OWNER/ADMIN). Storefront: `POST public/tenant-payments/initiate/:orgSlug`
  { orderId, orderNumber, provider } — the order number must match the
  order row (tracking-lookup discipline).
- Initiation records a `TenantPaymentTransaction` `initiated` and returns
  the gateway's real redirect URL. It NEVER marks the order paid.
  Practice orders, zero-amount orders, disabled gateways and
  already-verified-paid orders refuse.
- Public IPN/callback (`public/tenant-payments/…`, no tenant guard — trust
  comes from the verification chain, M36/M39 pattern). The browser return
  only redirects with an informational flag.
- On verified confirmation ONLY: transaction → `verified_paid` (idempotent
  — verified payload stored in `ipnPayload`, val_id kept), and the order
  records `paymentMethod = provider`, `isCod = false`, and a merchant-only
  internalNote evidence line (written exactly once; the transaction row is
  the payment source of truth — Order has no dedicated paid-flag field).
- Specs (cc9, 14 cases, stubbed gateway client) pin: (a) bad-signature IPN
  and unconfirmed validation change nothing; bKash callback alone changes
  nothing; (b) amount mismatch refuses (both gateways); (c) verified IPN
  marks paid exactly once, re-delivery is a no-op and blocks re-initiation;
  (d) failed bKash config verify saves nothing; (e) secrets (store pass,
  bKash password/app secret, Nagad private key) never appear in any view.
  Plus the cc8 spec (8 cases): LLM verify failure saves nothing, sealed at
  rest, tenant provider wins in `forOrg`, platform fallback intact.

### Web
Connect Center Payment section (`PaymentGatewayPanel`): per-provider forms
with the per-provider honest verification notes above, enable/disable,
delete, status from the dedicated endpoint; the overview payment category
now includes the gateways as real accounts (display name carries
যাচাইকৃত/কনফিগার করা). Rocket = manual-path card linking to Settings.
CC10 platform gateway + Wallet = dashed "আসছে — এখনো চালু নয়" note only,
no working-looking control.

## Gates (run 2026-10-13, sequentially)
- API jest FULL (NODE_OPTIONS=--max-old-space-size=4096): **284/284 suites,
  2749/2749 tests PASS** (2727 at B3 + 8 cc8 + 14 cc9). The known
  cx3-debounce flake PASSED this run — no solo re-run needed.
- Web vitest FULL: **34 files, 230/230 PASS** (224 at B3 + 6 new).
- tsc api + web: **0 errors**. Prisma validate: **valid**.
- Fresh-Postgres migration sequence: **134/134 applied clean** (throwaway
  PG16, `prisma migrate deploy`; 0 failed/rolled back; new tables verified
  present).
- next build: **green**, `/dashboard/connections` route present.

## Honest limits
- **No live gateway proof exists or is claimed**: no real SSLCommerz store,
  bKash/Nagad merchant account, SMTP server or LLM key was exercised from
  this sandbox — all gateway/LLM boundaries are spec-proven with stubbed
  clients at the injectable seam (the codebase pattern). Live verification
  with the owner's real merchant accounts is M30 territory.
- Migration `20261013230000_cc9_tenant_payment` is NOT run on any real DB;
  it is fresh-PG sequence-verified only (134/134).
- Nagad has config storage only — no checkout, no confirmation path; the
  UI and API both say so instead of implying one.
- The shop frontend renders no "Pay online" button yet: the initiation
  APIs (dashboard + public storefront) are complete and spec-proven, but
  the buyer-facing button on the shop success page and a staff "collect
  payment" button on the order page are UI follow-ups, not built here.
- LLM org-wiring is partial BY DESIGN and listed in full above — the
  campaigns/competitors/workflows paths still use the platform LLM.
- CC10 (platform payment + Wallet) was NOT built in this batch — UI shows
  it only as an upcoming note.
