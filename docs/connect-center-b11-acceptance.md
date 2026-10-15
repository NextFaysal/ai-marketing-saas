# Connect Center Next — B11 Acceptance (CC24 + CC25 + CC26)

**Status:** CODE-COMPLETE, local commits only on branch `cc-next` — NOT pushed.
**Base:** `c6de9f5` (B10.5). **Final HEAD:** see the commit list at the bottom.
**Migration:** `20261013370000_cc24_cc25_cc26_b11` (one migration for the batch; never run on any real DB — fresh-Postgres proven only).

## What was built

### CC24 — Gateway refunds (`payment-refunds.service.ts`, `tenant-gateway.client.ts`)

- New model `PaymentRefund` (org, tenantPaymentTransactionId, orderId, provider, source own|platform, environment, amountMinor, status initiated → processing → refunded | failed, gatewayRefundRef, gatewayStatusRaw verbatim, requestedById, verifiedAt).
- New gateway calls on the tenant client, same wire discipline as the payments that use them:
  - SSLCommerz: `GET {base}/validator/api/initiateRefund.php` (bank_tran_id, refund_amount in major units, store creds) and `GET {base}/validator/api/refundStateAPI.php` (refund_ref_id) — the M36 platform client's endpoint shapes, resolved with the TRANSACTION's own creds (tenant store for own-source, platform app creds for platform-source, via the new public `resolveCredsForTransaction`).
  - bKash: `POST /checkout/payment/refund` and `POST /checkout/payment/search` under the existing tokenized flow (per-attempt grant token, app creds from the same resolution payments use).
- **Initiation is never proof.** Initiation records `initiated`/`processing` with the gateway's ref. Only a gateway-confirmed status moves a refund to `refunded`, through `POST refunds/:refundId/refresh` (also reused, failure-isolated, by the list endpoint). The transition is exactly-once: re-refreshing a `refunded` row is a no-op.
- On the verified transition, in ONE DB transaction: the order's `Order.refundedMinor` cumulative advances (this is the EC5 field — the gateway refund LINKS to it instead of duplicating it; when fully refunded the order's paymentStatus/status mapping mirrors EC5's refund-push code exactly, including its exception list), and — platform-source only — a Wallet `refund_debit` ledger row on the tenant's account.
- Cumulative cap: verified + in-flight (initiated/processing) refunds for one transaction may never exceed the paid amount; partial refunds allowed; the cap is spec-pinned including the concurrent case.
- Honest refusals (Bengali): Nagad (no refund API is wired anywhere in this tree), sandbox transactions (their ids are not real gateway records), unpaid/failed transactions, SSLCommerz transactions with no recorded `bank_tran_id` (older rows), zero/negative amounts. A gateway refusal or transport error leaves the row `failed` with the gateway's raw answer stored verbatim.

### CC25 — Settlement reconciliation (`settlements.service.ts`)

- New models `SettlementImport` + `SettlementRow`.
- **CSV-import-only v1.** Neither gateway exposes a wired bulk settlement API in this tree; no fetch is fabricated. The service doc comment, the UI copy and this doc all say so.
- Parser: header-NAME detection (column order tolerated), reusing the platform's shared `parseCsv`. Two shapes:
  - SSLCommerz settlement export — requires a `Tran ID` column (or `Bank Tran ID`); amount from `Amount`; status from `Status`/`Validation Status`.
  - bKash statement export — requires a `TrxID` column (or `Payment ID`); amount from `Amount`/`Debit`; status from `Transaction Status`/`Status`.
  - A lone generic `Transaction ID` column is read as the DECLARED provider (both gateways emit it). A file whose headers match neither shape — or whose other shape's marker columns contradict the declared provider — is rejected with an honest error and NOTHING is stored (spec-pinned).
- Matching: by externalRef against the transaction's providerTxnId, valId, and the refs recorded inside its verified IPN payload (`bank_tran_id` for SSLCommerz, executed/queried `trxID` for bKash) + exact amount, restricted to `verified_paid` rows of the same org + provider + source. Verdicts: `matched` | `amount_mismatch` (carries the real transaction id) | `missing_in_system` | `duplicate` (second occurrence of a ref within the same file, carrying the first occurrence's matched id). Rows whose ref or amount cannot be parsed are counted in `skippedCount`, never guessed.
- `missing_in_report` is computed on read (never stored): verified transactions of the import's provider+source absent from the file; bounded by periodFrom/periodTo against `updatedAt` when a range was given, unbounded otherwise (documented in the service; the UI asks for the range).
- Scope: tenant-scoped for BOTH sources (the tenant reconciles their own gateway and what the platform reports). Admin cross-org reconciliation is out of scope for v1.

### CC26(a) — Payout destinations + schedule (`wallet.service.ts`, automation)

- New models `PayoutDestination` (details JSON is the tenant's own business data, stored as entered; LIST views mask every identifier-shaped value beyond its last 4 via one shared `maskIdentifier`; a single read returns details unmasked for the edit form) and `PayoutSchedule`. `PayoutRequest` gains nullable `destinationId` + `createdBySystem` (default false).
- Requests against a saved destination snapshot its method + details onto the request (the admin payout flow is unchanged) and record `destinationId`; the free-form CC10 path keeps working byte-for-byte. Destination validation is the same `assertDestinationDetails` both paths share. The CC23 payout step-up (TOTP + four-eyes) still runs FIRST for human requests; system requests never bypass anything because they are only ever `pending`.
- New per-org automation job `wallet_payout_sweep` (template 1440 min, like the other sweeps; enable per org like every sweep). Its run, per org: Dhaka calendar day (Intl parts; day-key helpers imported from the CRM follow-ups module so "the slot" is one definition) → schedule enabled? → today matches weekly dayOfWeek / monthly dayOfMonth (1..28)? → no system request already created for this slot (idempotency by scanning the slot's `createdBySystem` rows) → destination resolves (schedule's, else default) → available balance (balance − pending/approved holds, the existing availability math) ≥ threshold. Then it creates ONE pending request for the FULL available balance with `requestedById: "system"` — it NEVER approves, pays, debits or holds. Skip reasons are returned per org for the job run log.

### CC26(b) — Payment links (`payment-links.service.ts`)

- New model `PaymentLink`: token stored ONLY as `sha256(token)` (token = 32 random bytes, hex). The plaintext (and the full `/pay/<token>` URL) is returned exactly once, in the creation response; list views carry status/metadata only. Spec reads the stored row and asserts the plaintext appears nowhere in it.
- **Live-only:** links resolve through the live public payment options, so a sandbox-only path can never back a link (documented; creation refuses any (provider, source) the shop's public options do not currently offer — the exact same gate the buyer shop page uses).
- Creation refuses: practice orders, zero-total orders, orders with a verified payment already, unknown orders. Expiry 1h–30d (default 72h).
- Public surface: `GET /public/payment-links/:token` returns status, shop name (the organization's name), order number, amount due, currency, provider, source, expiry — NO internal ids, NO hash, NO secrets (spec-asserted). `POST /public/payment-links/:token/initiate` validates (active, unexpired; expired settles lazily) and then calls `TenantPaymentsService.initiatePublicPayment` — literally the same code path as `TenantPaymentsPublicController.initiate`, so the IPN discipline is identical.
- Spending: `markVerifiedPaid` gained a failure-isolated `markLinkUsed` hook (both the platform and own branches) that flips the matching active link (org + order + provider + source) to `used` inside the verified transition — exactly-once semantics preserved; a forged IPN spends nothing (spec-pinned). A used/revoked/expired link can never initiate again.
- Buyer page: `apps/web/src/app/pay/[token]` — summary + Pay button riding the public endpoints; honest used/expired/revoked/not-found states; the page itself never claims success (gateway redirect + server verification language).

## Design decisions (documented per the task)

1. **Negative wallet balance on platform refunds (deliberate).** The original platform payment already credited the tenant (minus fee) and may since have been paid out. A verified gateway refund claws the money back from the platform, so the tenant's wallet is debited the GROSS paid amount even if that takes the balance negative. The negative balance is a platform receivable: it stays visible in the wallet view, blocks new payout availability through the ordinary math, and future platform credits offset it first. Spec-pinned (balance −20,000 after a full-balance payout + refund).
2. **Order refund evidence reuses EC5's `Order.refundedMinor`** rather than a parallel Connect-Center counter — one cumulative number for store-push refunds and gateway refunds alike. (Consequence, stated plainly: the total mixes both kinds; per-source detail lives on the PaymentRefund rows.)
3. **Full-refund order status mapping mirrors EC5 verbatim**, including its exception list (orders already completed/cancelled/refunded/returned keep their status, paymentStatus still flips to `refunded`).
4. **SSLCommerz refund keyed on `bank_tran_id` from the verified IPN payload.** Transactions whose verified payload never recorded one (e.g. bKash-executed rows or pre-CC24 data) refuse honestly instead of guessing a ref.
5. **bKash refund search identifies the REFUND trx, not the original.** The search response's `originalTrxId`/`refundTrxId` pair is how the verified status is matched; a search that only echoes the original payment does not confirm anything.
6. **Settlement `missing_in_report` is computed, never stored** — it depends on the period question being asked, and storing it would freeze one answer into the row.
7. **Payout sweep creates for the FULL available balance** (not threshold-sized chunks) — one request per slot mirrors how a human files; threshold is the trigger, not the amount.
8. **Link ↔ transaction binding is by (org, order, provider, source)** at verified-payment time, not by storing a transaction id on the link — initiation may be retried (each attempt is a new transaction row), but only a verified one spends the link.
9. **`PayoutSchedule.destinationId` clears on destination delete** (nullable pointer, no cascade trap); the sweep then falls back to the default destination, and with none it skips honestly.

## Gates (run sequentially on the final HEAD; numbers read from the output tails directly)

- **API jest (full):** 333/334 suites, 3376/3377 tests. The ONE failure is the known pre-existing `cx3-debounce` flake (this run: the "fire" combined-text case) — proven by two solo re-runs on this HEAD: 18/18 and 18/18. New B11 specs: CC24 10/10, CC25 8/8, CC26a 9/9, CC26b 8/8.
- **Web vitest:** 332/332 (41 files).
- **tsc:** api 0, web 0, admin 0.
- **Prisma validate:** OK.
- **Fresh-Postgres FULL sequence:** 157/157 migrations applied clean on a throwaway DB (156 prior + `20261013370000`), 210 tables (204 + the 6 B11 tables); throwaway DB dropped afterwards.
- **Monorepo build:** green (`pnpm build`, web build includes the new `/pay/[token]` route).
- `apps/web/tsconfig.tsbuildinfo` / `apps/admin/tsconfig.tsbuildinfo` churn from gate runs was restored; tree clean at the final commit.

## Honest limits

- **No live gateway proof for anything in B11** — no real SSLCommerz/bKash refund was initiated or verified, no real settlement file from a merchant account was imported, no real buyer paid through a link. All gateway behavior is spec-proven against stubbed clients using the documented/M36 wire shapes. M30 live verification is still owed in full.
- The migration has **never run on any real database** (fresh-PG sequence only).
- Deploy setup owed: enable the per-org `wallet_payout_sweep` job for orgs that want scheduled payout requests (and the schedule only files requests — admin approval + the actual money movement remain the CC10/CC23 flow).
- The bKash `search` endpoint's refund-identification fields (`originalTrxId`/`refundTrxId`) follow bKash's documented response shape; if a live account answers differently, the refund stays `processing` (never falsely `refunded`) and the raw answer is preserved on the row for diagnosis.
- Settlement CSV shapes are the documented exports; a merchant exporting a customized report with renamed headers will get the honest unrecognized-shape refusal, not a silent empty import.

## Commits (local only — NOT pushed, per the standing owner-only push rule)

- `d0882d4` CC24 gateway refunds (+ the batch schema/migration)
- `97d4d6e` CC25 settlement reconciliation
- `5db4d01` CC26a payout automation
- `28729d9` CC26b payment links
- `47016b5` B11 web panels + public /pay page
- (this doc)
