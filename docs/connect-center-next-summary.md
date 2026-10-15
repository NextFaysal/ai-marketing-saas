# Connect Center Next — Package Summary (CC21–CC30)

Branch `cc-next`, built on integration-4 `3d4eb4b` (SU × CC
Advanced merged line). Local commits only — **nothing in this
package is pushed or deployed**, and none of its migrations has
run on a real database. Plan:
`~/workspace/goals/ai-marketing-saas-platform-build/files/Connect-Center-Next-Plan-2026-10-14.md`.

## Status table

| Item | Batch | Commits | Migration | Evidence |
|---|---|---|---|---|
| CC21 Auto-healing — commerce webhooks | B10 | `da89ecd` | `20261013360000_cc21_cc23_b10` | `cc21-healing.spec.ts`; caps 1/sweep + 3/day from recorded audit rows; `Integration.autoHealEnabled` opt-out; result re-verified from the stored webhook record |
| CC21(a) Meta token auto-refresh | B10.5 | `88cb495` (+ docs `29dae74`, correction `c6de9f5`) | — (same B10 migration) | `cc21a-meta-token-healing.spec.ts` — 15 cases; Graph `fb_exchange_token` via appSource-resolved app creds (own TenantAppConfig / platform M33); stored-expiry window only; failure leaves the credential byte-identical |
| CC22 Health analytics | B10 | `8a9b9ab` | — | `cc22-analytics.spec.ts`; real ConnectionHealthCheck rows only; zero-check accounts return explicit nulls |
| CC23 Security step-up | B10 | `02a2bd7` | `20261013360000_cc21_cc23_b10` (`PayoutRequest.approvedById`, `TenantPaymentTransaction.ipnEvents`) | `cc23-security.spec.ts`; tenant TOTP step-up (M35 verifier) on gateway delete/disable, app-config delete, payout create; admin four-eyes via `walletConfig.payoutFourEyesThresholdMinor` (null = off); IPN anomaly alert ≥3 rejected/24h, one per org per day |
| CC24 Gateway refunds | B11 | `d0882d4` | `20261013370000_cc24_cc25_cc26_b11` | `cc24-refunds.spec.ts` — 10 cases; initiation never proof — only a gateway-confirmed status moves a refund to `refunded` (exactly once); platform-source refunds debit the Wallet (may go negative = platform receivable, documented); Nagad/sandbox refuse honestly |
| CC25 Settlement reconciliation | B11 | `97d4d6e` | `20261013370000_cc24_cc25_cc26_b11` | `cc25-settlements.spec.ts` — 8 cases; CSV-import-only v1 (stated in service + UI); header-shape detection; matched / amount_mismatch / missing_in_system / duplicate verdicts; missing_in_report computed on read with real transaction ids |
| CC26(a) Payout automation | B11 | `5db4d01` | `20261013370000_cc24_cc25_cc26_b11` | `cc26-payout-automation.spec.ts` — 9 cases; destinations CRUD (masked beyond last 4), weekly/monthly schedule (Asia/Dhaka) creates ONE pending system request per slot — it never approves, pays or debits |
| CC26(b) Payment links | B11 | `28729d9` | `20261013370000_cc24_cc25_cc26_b11` (`PaymentLink`, sha256-only token storage) | `cc26-payment-links.spec.ts` — 8 cases incl. the full link → initiate → IPN ride; live-only; public page exposes shop/order/amount only; the link turns `used` only inside `markVerifiedPaid` |
| CC27 Deny-list completion | B12 | `f6c213a` | `20261013380000_cc27_deny_completion` | `cc27-deny-completion.spec.ts` — 27 cases; actor-rule table (gated + honestly-not) in the B12 acceptance |
| CC28 Own-app completion | B12 | `4f3ddb3` | — (TenantAppConfig.platform is a string; google/linkedin needed no migration) | `cc28-own-app-completion.spec.ts` — 20 cases; Google/LinkedIn tenant apps, Meta secret rotation without reconnect, token-paste appSource |
| CC29 Courier multi-account | B12 | `4f30906` | `20261013390000_cc29_courier_multi_account` (`CourierShipment.integrationId`) | `cc29-courier-multi-account.spec.ts` — 14 cases; fingerprint-keyed accounts (no courier returns a stable account id — per-courier identity source table in the B12 acceptance); booking records its account; per-account status sync |
| CC30 Connection insights + sync cadence | B13 | `457e5dd`, `ca14b6c`, `3bcb98a`, `73b899a` (+ docs) | `20261013450000_cc30_sync_cadence` (`Integration.syncIntervalMinutes`) | `cc30-cadence.spec.ts` — 12 cases; `cc30-usage-deliverability.spec.ts` — 14 cases; see `connect-center-b13-acceptance.md` |

Acceptance docs: `connect-center-b10-acceptance.md` (B10 + the
B10.5 addendum), `connect-center-b11-acceptance.md`,
`connect-center-b12-acceptance.md`,
`connect-center-b13-acceptance.md`.

## The Next package's full migration list

In application order (the SU migrations `20261013400000`–
`20261013440000` belong to integration-4 and sit between CC29
and CC30 in the full sequence — CC30's number was chosen above
them deliberately):

1. `20261013360000_cc21_cc23_b10` — `Integration.autoHealEnabled`,
   `PayoutRequest.approvedById`, `TenantPaymentTransaction.ipnEvents`
2. `20261013370000_cc24_cc25_cc26_b11` — `PaymentRefund`,
   `SettlementImport` / `SettlementRow`, `PayoutDestination`,
   `PayoutSchedule`, `PaymentLink`, payout-request destination fields
3. `20261013380000_cc27_deny_completion` — CC27 deny-completion fields
4. `20261013390000_cc29_courier_multi_account` — `CourierShipment.integrationId` + index
5. `20261013450000_cc30_sync_cadence` — `Integration.syncIntervalMinutes`

Full tree sequence after B13: **160 migrations** (155
integration-4 + 4 above + CC30's), verified end-to-end on a
fresh Postgres at every batch gate.

## Gate history (per batch, final HEADs)

| Batch | API jest | Web vitest | tsc (api/web/admin) | Fresh-PG |
|---|---|---|---|---|
| B10 (`94cc3af`) | serial 329/329 suites, 3327/3327 | 332/332 | 0/0/0 | 156/156 |
| B10.5 (`88cb495` + docs) | 329/330 suites, 3341/3342 — sole failure the known cx3-debounce flake, proven by solo re-runs on this HEAD AND on the pristine base (see the corrected addendum, `c6de9f5`) | 332/332 | 0/0/0 | 156/156 |
| B11 (`71bcc4d`) | 333/334 suites, 3376/3377 — cx3 flake, proven 18/18 ×2 solo | 332/332 | 0/0/0 | 157/157 |
| B12 (`eedf4b8`) | 337/337 suites, 3438/3438 | 332/332 | 0/0/0 | 159/159 |
| B13 (closing HEAD) | 339/339 suites, 3464/3464 — all pass, run twice on the final code state (no cx3 flake, no OOM) | 332/332 | 0/0/0 | 160/160 |

No batch in this package ever shipped a red gate: every
non-green full run was decomposed to the pre-existing
cx3-debounce flake or a sandbox worker-OOM, each proven by solo
re-runs recorded in the batch acceptance.

## Deploy checklist

### Migrations
- [ ] Run the FULL sequence on the production database in
      order (through `20261013450000_cc30_sync_cadence`) via the
      normal deploy path — none of the Next migrations has ever
      run on a real DB.

### Per-org job enables (Automations — per org, from templates)
- [ ] `connection_health_sweep` — drives CC12 monitoring, CC14
      WhatsApp health refresh, CC21 webhook auto-healing, CC21(a)
      Meta token refresh and the CC23 IPN-anomaly watch.
      Nothing in B10/B10.5 runs without it.
- [ ] `wallet_payout_sweep` — drives CC26(a) scheduled payout
      requests (creates pending requests only; approval stays
      human).
- [ ] The store-sync templates (`woo_*` / `shopify_*`) for each
      store that should sync on a schedule — CC30 cadences only
      gate jobs that exist.
- [ ] (Pre-existing, still owed from earlier packages: the
      social / commerce sweeps from the SU + EC checklists.)

### Admin setup (Admin Panel → Platform Config / Settings)
- [ ] `walletConfig.feeBps` — the platform fee for CC10 platform
      payments (0 = no fee; set deliberately, it is read at
      verification time).
- [ ] `walletConfig.payoutFourEyesThresholdMinor` — CC23
      four-eyes decision: leave unset (off) OR set the amount
      (minor units) at/above which the approving admin cannot
      also mark the payout paid.
- [ ] Platform gateway configs (SSLCommerz / bKash) if platform
      payments (CC10) are offered — refunds (CC24) and
      settlements (CC25) for platform-source payments ride these.
- [ ] Google platform app: client id/secret for the Google pack
      + LinkedIn platform app (`linkedinAppConfig`) — and the
      redirect URIs registered in each provider console (below).
- [ ] Meta / TikTok platform apps remain as configured for
      CC3/CC4 + CC21(a) token exchange (the exchange resolves the
      SAME app credentials the connection was made with).

### Redirect URIs to register in provider consoles
- [ ] Platform Google app + platform LinkedIn app: the
      platform callback URIs (see the B9/B12 acceptances for the
      exact paths) — required before Google pack / LinkedIn
      connects work live.
- [ ] Tenant-facing note (below) covers the OWN-app equivalents.

### Tenant-facing notes
- [ ] **TOTP enrolment nudge (CC23):** step-up only binds users
      who HAVE TOTP enabled; users without it proceed with a
      `stepUpUnavailable` notice. Announce 2FA enrolment
      (Settings → TOTP) as the way to get step-up protection on
      gateway delete/disable, own-app delete and payout creation.
- [ ] **Own-app redirect URIs (CC28):** a tenant connecting
      through their OWN Google or LinkedIn app must register the
      platform's OAuth callback URI in their own provider
      console first — same discipline as the Meta own-app path.
- [ ] **Own Meta app secret rotation (CC28)** takes effect for
      webhook verification immediately; existing tokens keep
      working (documented in the B12 acceptance).

## M30 live-verification list — Next features (all still owed)

Nothing in CC21–CC30 is live-proven. Each item below needs the
owner's real accounts, in a session like the earlier M30 runs:

- [ ] **CC21(a) Meta token exchange:** a real Meta connection
      whose stored token is inside the expiring window — watch
      the sweep exchange it (audit + timeline rows), the expiry
      move, and messaging keep working on the new token. Also
      one deliberate failure (revoked app) proving the old
      credential survives byte-identical and alerts fire.
- [ ] **CC21(b) webhook healing:** break a real store's webhook
      subscription (Woo + Shopify) and watch the sweep
      re-register within caps; opt one connection out and prove
      it is detected-but-not-repaired.
- [ ] **CC24 a real gateway refund end-to-end:** SSLCommerz and
      bKash, full + partial — initiation, gateway-confirmed
      status transition exactly once, `Order.refundedMinor`
      applied, and (platform source) the Wallet `refund_debit`.
- [ ] **CC25 a real settlement CSV from each gateway**
      (SSLCommerz + bKash): import, verdicts against real
      verified transactions, a deliberate amount mismatch.
- [ ] **CC26(b) a payment-link payment:** create a link for a
      real order, pay it as a buyer, link turns `used` via the
      verified IPN only; expired/revoked links refuse.
- [ ] **CC26(a) a scheduled payout:** destination + schedule on
      a real wallet — the sweep creates the pending request;
      a human still approves and marks paid.
- [ ] **CC23 step-up + four-eyes with real authenticators:**
      tenant TOTP enforced on gateway delete; admin four-eyes
      refusing a same-admin mark-paid above the threshold.
- [ ] **CC28 own-app connects:** a tenant's own Google app and
      own LinkedIn app through connect → refresh; Meta secret
      rotation without reconnect.
- [ ] **CC29 two accounts of one courier:** book + status-sync
      under each account's own credentials.
- [ ] **CC30 cadence on a real store:** set a cadence, watch a
      scheduled cycle skip inside the window (job result shows
      `sync_interval`, no SyncJob row) and run after it; manual
      sync unaffected.
- [ ] **CC12/CC22 with real traffic:** alerts and health
      analytics once real Doctor runs exist.
