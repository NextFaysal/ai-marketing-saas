# OU11 — Payout automation with the LEGAL GATE encoded (One-Umbrella OB6)

Branch `one-umbrella`, base `c8c3c236` (OU12 + OU9 complete — not redone).
Local commits only, NO push. Migration claim: **20261024030000**
(`20261024030000_ou11_payout_legal_gate`).

## Step-0 audit (code only, before building)

### Wallet payout lifecycle (`apps/api/src/connections/wallet.service.ts`, CC10/CC23/CC26)
- States: `PayoutRequest.status` = pending → approved → paid; pending/approved →
  rejected; pending → cancelled (tenant). While pending|approved the amount is HELD:
  available = balance − Σ held.
- The ledger debit happens in exactly ONE place: `adminMarkPaid` — inside one DB
  transaction it re-checks status (paid → refuse; non-approved → refuse), re-validates
  the balance against other holds, appends the `payout_debit` WalletTransaction,
  decrements `WalletAccount.balanceMinor`, and sets status=paid + `payoutRef`.
  Exactly-once rests on that in-transaction status check; there is no separate
  idempotency-key column — `payoutRef` is the admin-supplied external reference.
- Four-eyes enforcement point: `adminMarkPaid`, BEFORE the transaction — when
  `walletConfig.payoutFourEyesThresholdMinor` (platform-config snapshot) is set and the
  payout is at/above it, the admin recorded in `approvedById` (persisted separately at
  approve time by `adminDecidePayout`, CC23) may not mark it paid.
- `runPayoutSweep` (CC26) only CREATES pending requests from a schedule — it never
  approves, pays, or writes a ledger row, so it is not a disbursement path and is
  correctly outside the gate.
- Credits enter only via `creditVerifiedPlatformPayment` (verified platform payment,
  idempotent). Manual correction = `adminAdjustWallet` (note + acting admin required).

### Platform-level config (where a legal-gate record belongs)
- Platform config lives in `SystemSetting` key/value JSON, read through the
  `platform-config.ts` snapshot (refreshed on admin writes + scheduler tick, ~30s
  worst case) — right for fees/thresholds, WRONG for a legal gate: a gate must not
  ride a stale cache. OU11 therefore uses a dedicated DB record (`PayoutLegalGate`,
  singleton `scope="platform"`) read from the database on EVERY enforcement call.
- Admin patterns: `AdminController` routes are tier-gated with `@AdminTier(...)`
  (SuperAdminGuard); money routes are SUPER/FINANCE; platform-config writes are
  SUPER-only. `WalletService` is injected into AdminController from ConnectionsModule.
  Audit pattern: `AuditService.log` inside the services (platform-level acts log with
  no organizationId).

### AffiliatePayout lifecycle (EC32, `apps/api/src/affiliates`)
- `AffiliatePayout` is a BOOKKEEPING record: `recordPayout` documents money the
  merchant paid the partner OUTSIDE the system; creating it flips covered APPROVED
  CommissionEntries to paid, FIFO oldest-first, against the cumulative payout pool.
  Guard: amount ≤ outstanding approved. "Paid" on this side means entries flipped —
  the system never sent money and no code claimed it did. There was no approval
  workflow or execution concept on this side before OU11.

### bKash disbursement surface — NOT evidenced
- Tenant/platform bKash clients (`tenant-gateway.client.ts`, platform config) wire
  tokenized CHECKOUT only: token grant, create payment, execute, query, refund,
  search transaction. There is NO disbursement / B2C / payout endpoint anywhere in
  the codebase, and no OU4/OU5 evidence doc evidences one (OU5's evidence covers
  checkout + refunds; the standing record agrees: bKash disbursement was never
  evidenced). Per the verify-first rule, OU11 builds NO provider disbursement
  client. The v1 rail is the bank-instruction rail below.

## Shipped (per commit)

- **d3a106da OU11-A — schema + migration 20261024030000.** `PayoutLegalGate`
  (legalConfirmedById/At, legalReference, legalNote, automationEnabled default
  false + enabledBy/At) and `PayoutExecution` (one execution per subject;
  `payoutRequestId` unique for wallet subjects, partnerId + affiliatePayoutId for
  affiliate subjects, destination snapshot, `instructionRef` unique, bankReference /
  failureReason write-back, issued/confirmed/failed actor + timestamps) +
  `Organization.payoutExecutions` back-relation. No existing table altered.
- **b7a4a8b5 OU11-B — legal gate + wallet rail.**
  `connections/payout-legal-gate.ts`: `readPayoutLegalGate` (DB read, fail-closed),
  `payoutLegalGateState`, `assertPayoutAutomationAllowed` — refuses with distinct
  messages for (a) no confirmation recorded, (b) confirmation present but switch off.
  WalletService gate acts (controller-gated SUPER, all audited):
  `recordPayoutLegalConfirmation` (reference REQUIRED; recording never enables),
  `revokePayoutLegalConfirmation` (clears confirmation AND forces the switch off),
  `setPayoutAutomationEnabled` (enabling without a confirmation refuses).
  Wallet rail: `issuePayoutInstruction` (gate first; APPROVED requests only; one row
  per request — duplicate issue returns the same instruction, re-issue after failure
  reuses the row), `confirmPayoutExecution` (gate first; bank reference required;
  completes ONLY through `adminMarkPaid`, so four-eyes / overdraw / exactly-once all
  remain the existing code's; duplicate confirm converges on stored truth with no
  second debit), `failPayoutExecution` (reason required; request stays approved, no
  ledger row, retryable), `buildPayoutInstructionCsv` (the export the operator takes
  to the bank; its face states the system has sent no money).
  **Manual mark-paid is deliberately NOT gated** — stated in code comments, the gate
  module doc, the admin UI, and proven by spec.
- **84c79149 OU11-C — admin routes.** `GET /admin/payout-legal-gate` (SUPER/FINANCE
  read); `POST /admin/payout-legal-gate/confirm|revoke|automation` (SUPER only);
  `GET /admin/payout-requests/:id/execution`,
  `POST …/execution/instruction|confirm|fail`, `GET …/execution/instruction.csv`
  (SUPER/FINANCE, same tier as mark-paid; the gate is re-checked in the service on
  every call regardless of tier).
- **8de41ec8 OU11-D — affiliate payouts ride the same rail + gate.** AffiliatesService
  asserts the gate FIRST on issue/confirm/fail. Issue draws only on APPROVED
  outstanding (pending commission never counts) and open instructions reserve their
  amounts (no joint overdraw); destination contract per method. Confirm creates
  exactly ONE AffiliatePayout through the SAME bookkeeping as EC32 `recordPayout` —
  the FIFO flip was extracted to a shared `applyFifoFlip` used by both, so there is
  no second flip to drift; duplicate confirm returns the stored payout and creates
  nothing; outstanding is re-validated at confirm (a manual payout in between leaves
  the execution open and truthful). Fail records the reason, creates/flips nothing,
  frees the reservation. `recordPayout` behaviour unchanged and NOT gated. Tenant
  routes under the existing WRITE_ROLES floor + DTOs.
- **ec824f01 OU11-E — admin web.** Wallet Payouts page gains the LegalGateCard
  (state badge, recorded confirmation detail, SUPER confirm form with required
  reference, automation ON/OFF, revoke; card text states plainly that the record
  does not replace the review and manual mark-paid is ungated) and per-approved-row
  OU11 actions (Bank Instruction, Instruction CSV, Execution Confirm/Fail via
  ConfirmModal). FINANCE sees the card; the API refuses FINANCE writes verbatim.

## Specs — what is proven
- `connections/ou11-payout-legal-gate.spec.ts` — **12/12**: reference-required
  recording; recording never enables; enable-without-confirmation refuses; revoke
  clears + forces off + audits; gate state (a) and (b) refuse issue AND confirm AND
  fail creating/debiting nothing; closing the gate mid-flight stops the next
  confirm; manual mark-paid pays with the gate fully closed; instruction only from
  approved; duplicate issue = same row/ref; confirm = exactly ONE payout_debit with
  the bank ref as payoutRef, duplicate confirm no second debit; four-eyes at
  completion (approver blocked at/above threshold, second admin completes);
  failure = reason recorded, request stays approved, no debit, re-issue + confirm
  succeeds, confirmed execution cannot be failed.
- `affiliates/ou11-affiliate-payout-execution.spec.ts` — **8/8**: gate (a)/(b)
  refusal on issue/confirm/fail; manual recordPayout ungated; approved-only
  executable + reservation math; destination contract; exactly one AffiliatePayout
  + FIFO flip on confirm, duplicate confirm creates nothing; failure truthful +
  fully retryable; confirm-time outstanding re-validation.
- Regression: full `src/connections/` **389/390**, `src/affiliates/` **35/35**,
  `src/admin/` **244/245** (see known failures below).

## Gates
| Gate | Result |
|---|---|
| OU11 wallet spec | ✅ 12/12 |
| OU11 affiliate spec | ✅ 8/8 |
| API jest — connections (all 30 suites) | ✅ 389/390 (1 known failure ↓) |
| API jest — affiliates | ✅ 35/35 |
| API jest — admin | ✅ 244/245 (1 known failure ↓) |
| API tsc (`tsc --noEmit`) | ✅ clean |
| Admin tsc | ✅ clean |
| Admin `next build` | ✅ green |
| Fresh-Postgres full migration run | ✅ **222/222 applied** on a fresh PG16 cluster (221 at OU12 + OU11's 20261024030000); `PayoutLegalGate` + `PayoutExecution` verified present with unique indexes + org FK |
| Prisma validate | ✅ schema valid |

Known failures, both pre-existing and base-proven, neither touched by OU11:
- `cc26-payout-automation.spec.ts` sweep slot test — fails identically with the
  BASE (c8c3c236) wallet.service restored: the spec's fake stamps createdAt with
  the real clock while the slot day is pinned to 2026-10-15, so on any later date
  the second sweep reads below_threshold instead of already_created_for_slot.
- `adx3-nav-counts.spec.ts` — the standing known failure from the task brief.

## NOT BUILT
- **No bKash (or any provider) disbursement client** — no disbursement API is
  evidenced; building one would be fabrication. If an official bKash disbursement
  API is ever evidenced, it slots in behind the same gate + execution record as a
  second rail; the bank-instruction rail remains the fallback.
- **No automatic/scheduled execution** — the sweep still only creates pending
  requests; nothing auto-issues or auto-confirms instructions. Issuing and
  confirming are deliberate admin acts (the automation the gate governs is the
  instruction+confirmation flow itself).
- **Tenant-web UI for affiliate executions** — the affiliate execution API is
  complete (tenant routes, WRITE_ROLES); the merchant dashboard gains no new panel
  in this batch. The admin-side wallet/gate UI is built (OU11-E).
- **No change to manual processes** — admin mark-paid, EC32 recordPayout, wallet
  adjustments, and the four-eyes threshold config behave exactly as before.
- **No live proof** — nothing here has run against the real database or a real
  bank; the migration is proven fresh-PG only (see checklist).

## Owner checklist (all owner actions — the code records, it does not replace)
- [ ] **Obtain the legal review itself**: have a lawyer review holding tenant
      funds in the platform wallet (the Connect Center program's open legal item)
      and produce a memo/opinion that can be referenced.
- [ ] After deploy, a SUPER admin records the confirmation in Admin Console →
      Wallet Payouts → Legal Gate card (reviewer/law-firm name or memo reference).
- [ ] Separately turn the automation switch ON in the same card (recording alone
      enables nothing).
- [ ] Deploy path as always: explicit push instruction → Dokploy Redeploy (the
      20261024030000 migration runs on the real DB — back up first).
- [ ] Live-verify with ONE small real payout end-to-end: approve → issue
      instruction → execute at the bank → confirm with the bank reference →
      check the wallet ledger shows exactly one payout_debit.
- [ ] Decide who holds FINANCE tier for execution confirm, keeping four-eyes in
      mind for amounts at/above the configured threshold.
