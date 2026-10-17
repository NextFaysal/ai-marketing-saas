# OU12 — Subscription auto-charge + backup restore (OB6 section)

- **Package:** OU12 from the OU0–OU12 One-Umbrella package (owner approved in full 2026-10-16). Plan item: *"Shop recurring subscription-এ saved-token auto-charge (bKash tokenized — verify-first); Org backup-এর restore এন্ডপয়েন্ট (আজ export-only)।"*
- **Base / branch:** `one-umbrella` at `f46b5e7e` (OB5 head). Local commits only; no push.
- **Headline verdict, stated plainly:** **No auto-charge was wired, and no restore endpoint was built — because Step-0 proved neither is honestly buildable from what exists in this repo.** OU12 ships (A) consent capture + honest labelling for shop subscriptions, and (B) backup *verification* (the honest, read-only subset of restore) instead. The evidence for both decisions is below; nothing in the UI or API claims a charge will happen or that a restore is possible.

---

## Step-0 audit (code only)

### 1. Shop `CustomerSubscription` machinery (EC24c)

- **Schema** (`packages/db/prisma/schema.prisma`, `model CustomerSubscription`): `organizationId, customerId, productId, variantSku, qty, unitPriceMinor (snapshot), discountPercent (snapshot), status (active|paused|cancelled), nextRunAt, lastOrderId, createdFromOrderId, failureCount`. **No consent field of any kind, no saved payment token / agreement field, no payment-method field.**
- **Creation path:** staff ONLY. The service header states it verbatim: *"There is deliberately NO storefront self-serve signup and NO payment-gateway auto-charge: a subscription is a staff-created schedule…"* (`apps/api/src/subscriptions/subscriptions.service.ts`). The only creation surface is the dashboard page `apps/web/src/app/dashboard/commerce/subscriptions/page.tsx` (staff form) → `POST /organizations/:id/subscriptions`. **The shop customer never sees a subscription flow and never consents to anything anywhere in the product** — a customer-facing consent would have no surface to live on today.
- **Sweep** (`SubscriptionsService.runDueForOrg`, job `commerce_subscription_sweep`): due = active + `nextRunAt <= now`, cap 100/run. On success it creates a normal renewal order through the ONE shared path (`IntegrationsService.upsertOrder`, source `"subscription"`) with `paymentMethod: "cod"`, `isCod: true`, `shippingMinor: 0` — i.e. **payment is COD/manual, the order is `pending`, nothing is charged or marked paid**. On failure: `failureCount++`, `subscriptions.renewal_failed` audit, `nextRunAt` NOT advanced; at 5 consecutive failures the subscription auto-pauses (`subscriptions.auto_paused` audit). Price/discount are creation-time snapshots.

### 2. bKash tokenized — is a CHARGE path integrated anywhere?

The repo contains **two different bKash worlds**, and the distinction is the whole OU12 decision:

**(a) Tenant/shop payments — initiation only, NO agreement, NO charge.**
`apps/api/src/connections/tenant-gateway.client.ts` (`TenantGatewayClient`) exposes exactly: `bkashGrantToken`, `bkashCreatePayment` (mode `"0011"`), `bkashExecutePayment`, `bkashQueryPayment`, `bkashRefundPayment`, `bkashSearchTransaction`. **There is no agreement create/execute/cancel method and no mode-`"0001"` (agreement) charge method.** `TenantPaymentsService.startBkashPayment` uses the mode-0011 hosted checkout only. The shop checkout (`storefront`) likewise knows only COD + manual bKash/Nagad advance claims. **No tenant-credential tokenized charge path exists.**

**(b) Platform billing — a full tokenized charge path DOES exist, but it is platform-bound.**
`apps/api/src/payments/payments.service.ts` (Billing Package B4): `startAutoRenew` (`/checkout/agreement/create`) → `handleBkashAgreementCallback` (`/checkout/agreement/execute`, agreement id stored SEALED in `AutoRenewAgreement`) → `cancelAutoRenew` (`/checkout/agreement/cancel`) → **`chargeAutoRenew`: `/checkout/create` with `mode: "0001"` + `agreementID`, then `/checkout/execute`, activating ONLY on `transactionStatus === "Completed"`** through the normal `PlanCheckout` + `activate()` path. It is wired to the `auto_renew` job (`apps/api/src/automation/automation.service.ts`) and spec-covered with a stubbed gateway (`apps/api/src/payments/b4-autorenew.spec.ts`).

Why (b) does **not** make shop auto-charge "integrated":

1. **Different payer, different merchant, different money.** In (b) the payer is the tenant ORG paying the PLATFORM for its SaaS plan, using the **platform's own** bKash merchant config (`effectiveBkashConfig`) and the platform seal. A shop renewal would charge a shop CUSTOMER, settling to the **tenant's** merchant account with the **tenant's** credentials — the direction is the tenant-gateway world (a), which has no agreement machinery at all.
2. **Different subject models.** `AutoRenewAgreement` is `@unique` per organization, keyed to the platform `Subscription`/`PlanCheckout` lifecycle. There is no per-customer agreement storage, no shop-side agreement callback route, and no customer identity in the bKash agreement flow for shops.
3. **Never live-verified, by its own admission.** The B4 header comment: endpoint shapes *"must be confirmed against the platform's real merchant sandbox before production use (no live bKash merchant exists in development)"*. Even the platform path is mocked-only proof.

**Conclusion:** wiring shop auto-charge would mean *building a new, unverified tenant-side payment integration* (new client methods, new per-customer agreement storage, new public callback, new charge discipline) and passing it off as "wiring an existing path". Under the standing verify-first / no-fake-features rules, OU12 therefore takes the brief's fallback branch for the shop scope: consent capture + honest labelling (Part A below). The platform-billing charge path is recorded here in full so the coordinator/owner can see it was found, weighed, and not hidden.

### 3. Org backup — what a READY backup contains; does anything round-trip?

- **There is no `OrgBackup` model.** A backup is a `DataExport` row with `kind: "backup"` plus the `OrgBackupPreference` row (enabled flag + `lastBackupAt`), driven by the `org_backup_sweep` job (`DataExportsService.runBackupSweepForOrg`: weekly when enabled, retention = newest 4 READY backups, older ones' files deleted + rows marked `expired`).
- **A READY backup's file** (`DataExportsService.generate` → `buildOrgDataBundle` in `apps/api/src/organizations/org-data-export.ts`) is one JSON document `{ manifest, data }` stored via the media store at `data-exports/<orgId>/<exportId>.json`, 7-day download TTL. `data` keys: `organization, businessProfile, members (membership rows + user summaries), products, orders, customers, leads, conversations, campaignPlans, integrations, subscription (SaaS plan), payments (SaasPayment), supportTickets, orderItems, mediaAssets`. The manifest records per-table row counts + a `truncated` flag (200,000-row-per-table ceiling, honestly reported).
- **No restore/import machinery for the bundle exists anywhere.** The `imports` module is CSV-only for products/orders (plus lead CSV) with a completely different format (major units, header aliases) — it cannot read the bundle. The Organization-Next audit (2026-10-16) independently recorded "org data export (import missing)".
- **The bundle does not round-trip by design:**
  1. `integrations` export as a **safe subset only** (`id, provider, status, externalAccountId, lastSyncAt, createdAt`) — *credential tables are NEVER included* (builder's own words), so connections can never be recreated from the file.
  2. `mediaAssets` are **metadata only** — no file bytes exist in the bundle.
  3. `members` reference **global `User` rows**; the bundle holds id/email/name/status summaries — no passwords, no way to recreate accounts.
  4. `payments` / `subscription` are **SaaS billing records of truth** — recreating them would fabricate financial history; the `organization` row itself carries live state (`creditMinor`, verification status).
  5. **Every id is the source org's own.** Restoring into the same org collides on primary keys; restoring into a new org would need a full id-remapping import engine (orders→customers/products, orderItems→orders/products, memberships→users, …) that does not exist.
  6. A bundle can be **truncated** (manifest flag) — even a perfect importer could silently restore a partial shop.

**Conclusion:** the brief's conditional applies — *"If the export does NOT round-trip by design, do NOT build a fake restore."* Part B below builds only the honest subset.

---

## Shipped — Part A: auto-charge consent capture (NO charging)

Commits: `a40cd57e` (schema+API), `831dda16` (web).

- **Migration `20261024000000_ou12_subscription_autoconsent`**: `CustomerSubscription.autoChargeConsentAt TIMESTAMP(3) NULL`, `autoChargeConsentMethod TEXT NULL`, `autoChargeConsentNote TEXT NULL`. All three NULL together = no consent on record; existing rows and behaviour untouched.
- **Capture at creation** (`CreateSubscriptionDto` + `SubscriptionsService.create`): staff may pass `autoChargeConsentGiven: true` + `autoChargeConsentMethod` (`phone_call | in_person | written | message`) + optional note. Resolution rules (service-enforced, spec-pinned): given=true **requires** a valid method, and the timestamp is the **server's** `new Date()` — clients never supply it; a method/note supplied **without** given=true is refused as contradictory input; invalid consent refuses the whole creation (no half-recorded rows).
- **Capture/withdraw later**: `POST /organizations/:id/subscriptions/:subscriptionId/auto-charge-consent` (OWNER/ADMIN/MARKETING_MANAGER, same write roles as the rest of the controller). Withdrawal (`given: false`) clears all three fields. Cancelled subscriptions refuse consent recording. Audit: `subscriptions.autocharge_consent_recorded` / `subscriptions.autocharge_consent_withdrawn`; creation audit metadata now carries `autoChargeConsentGiven` (+ method).
- **Honest labelling**: every serialized subscription carries `autoCharge: { consentGiven, consentAt, method, chargingActive: false, statusLabel }` where `statusLabel` is `"auto-charge ready — চার্জিং এখনো চালু নয়"` when consent exists, else `"no_consent"`. `chargingActive` is a literal `false` in code.
- **Sweep untouched**: `runDueForOrg` never reads the consent fields. Spec-proven (below) that a due, consented subscription still produces exactly the same COD `pending` order, with zero network calls.
- **Web** (`dashboard/commerce/subscriptions`): create form gains a consent block — checkbox + required method select + optional note — under a plain warning: *"সম্মতি রেকর্ড হলেও চার্জিং এখনো চালু নয় — … কোনো টাকা স্বয়ংক্রিয়ভাবে কাটা হবে না।"* List + mobile cards show the amber badge **"auto-charge ready — চার্জিং এখনো চালু নয়"** with method + timestamp, or "অটো-চার্জ সম্মতি নেই" when absent; a "সম্মতি প্রত্যাহার" action withdraws consent via the API.

## Shipped — Part B: backup verification (NOT a restore)

Commits: `6d17133b` (schema+API), `7b158f97` (web).

- **Migration `20261024010000_ou12_backup_verification`**: `DataExport.backupVerifiedAt TIMESTAMP(3) NULL` + `backupVerification JSONB NULL`.
- **Endpoint**: `POST /organizations/:id/data-exports/:exportId/verify-backup` — **OWNER-only** (`@Roles("OWNER")`, stricter than the controller's usual OWNER/ADMIN), body `{ confirmSlug }` which must equal the organization's slug exactly, checked **before the stored file is read** (spec-proven: wrong slug → 400, zero store reads, nothing recorded). Foreign-org export ids 404 exactly like missing ones (download parity).
- **The check** (`DataExportsService.verifyBackup`, read-only): row status must be `ready`, not past expiry, `fileRef` present; stored bytes present; bytes parse as JSON; `manifest` + `data` present; **per-table row counts in `data` match the manifest** (arrays by length; singleton objects count 1); truncated tables listed; sections present listed; **non-restorable sections listed with reasons** (the `OU12_NON_RESTORABLE_SECTIONS` constant: integrations / mediaAssets / members / payments / subscription / organization).
- **Record**: result JSON stored on the export row (`backupVerifiedAt` + `backupVerification`) and audited as `data_export.backup_verified` with `{ ok, problems, truncatedTables, restoreSupported: false }`. The response also carries `restoreSupported: false` and a Bengali `restoreNote` stating this is a file-integrity check, not a restore.
- **Why no pre-restore safety export**: that step exists to protect data a restore would overwrite. Verification overwrites nothing — its only writes are the export row's own verification record and the audit entry (spec-proven read-only against org data). The step belongs to a real restore, which is NOT BUILT.
- **Web** (Settings → "ডেটা ও ব্যাকআপ" card): each ready export gains a "ব্যাকআপ যাচাই" action opening an inline exact-slug confirmation; the result renders inline (ok / problems / truncated tables), and each row shows its last recorded verification (time + outcome) from the API row. A plain note in the card states verification is not a restore and no restore exists for the export bundle, with the reasons.

---

## NOT BUILT — with evidence

1. **Shop subscription auto-charge (the charge itself)** — NOT BUILT. Evidence: Step-0 §2 — the tenant gateway client has no bKash agreement/charge method (initiation only, mode 0011); the one integrated tokenized charge (`PaymentsService.chargeAutoRenew`, mode 0001) is bound to platform billing (platform credentials, platform seal, org-level `AutoRenewAgreement`, SaaS `Subscription`/`PlanCheckout`), is mocked-only even there, and its own header requires sandbox confirmation before production use. Building the shop variant = a new unverified payment integration, not wiring. **What would unblock it:** a tenant-side bKash agreement lifecycle (agreement create/execute/cancel on `TenantGatewayClient`), per-customer sealed agreement storage, a public shop callback route, charge results recorded through the tenant payment transaction machinery with the subscriptions sweep's existing failureCount/auto-pause discipline — plus a real bKash merchant sandbox verification pass (M30-style, owner accounts) before any live claim.
2. **Backup restore endpoint** — NOT BUILT. Evidence: Step-0 §3 — no bundle import machinery exists; the bundle structurally cannot round-trip (credentials never exported, media metadata-only, global-user references, billing records of truth, source-org ids, possible truncation). Any "restore" shipped on this format would either fail on keys or fabricate records. **What would unblock it:** a separately designed restore format/engine (id-remapping import with per-table conflict policy, credential re-entry flows, media re-upload), which is a package of its own — ORG16 (bundle import/restore) in the Organization-Next plan covers this territory and is the natural home; it must not be duplicated here.
3. **Customer self-serve consent flow** (shop-facing) — NOT BUILT: there is no storefront subscription surface at all (EC24c is staff-created by design); consent is staff-attested with a recorded method instead. No customer notification on consent/renewal was added (none exists in v1 machinery).
4. **Platform-billing auto-renew changes** — untouched by design: B4 already implements consent + charge for the SaaS plan with its own discipline; OU12 does not modify it.
5. **Live proof of any kind** — none claimed: no real bKash merchant, no live backup file, no deployment. All OU12 live checklist items remain **unchecked / owner-owed** (Dokploy redeploy after an owner-authorized push, per-org `commerce_subscription_sweep` enablement unchanged, M30).

---

## Gates (serial, one at a time)

| Gate | Result |
|---|---|
| API jest — subscriptions (existing EC24c + OU12) | ✅ 2 suites, 16/16 |
| API jest — data-tools (AB8 + OU12) | ✅ 2 suites, 28/28 |
| API jest — automation (imports both touched modules for the sweeps) | ✅ 14 suites, 83/83 |
| API tsc (`tsc --noEmit`) | ✅ clean |
| Web vitest | ✅ 111 files, 905/905 |
| Web tsc | ✅ clean |
| Web build (`next build`) | ✅ green |
| Fresh-Postgres full migration run | ✅ **221/221 applied** on a fresh PG16 cluster (219 at OB5 + the 2 OU12 migrations); new consent columns on `CustomerSubscription` and verification columns on `DataExport` confirmed present |

Known pre-existing failures on base `f46b5e7e` (per the OB5 record): `cc26`, `adx3-nav-counts`, `gb9-public-docs` — none of the touched suites are in that set, and all touched/adjacent suite groups above are fully green.

## Migration claims

- `20261024000000_ou12_subscription_autoconsent`
- `20261024010000_ou12_backup_verification`

(Fresh-PG union after OU12: **221 migrations**.)

## Live checklist (all unchecked — owner-owed)

- [ ] Push authorized by owner + Dokploy Redeploy (migrations 20261024000000 + 20261024010000 run on the live DB).
- [ ] Create a subscription with consent in production; confirm the badge reads "auto-charge ready — চার্জিং এখনো চালু নয়" and a renewal still arrives as a COD order.
- [ ] Run backup verification on a real production backup export (OWNER, slug confirm); confirm the recorded result on the row.
- [ ] bKash tenant agreement/charge sandbox verification — only if/when the owner commissions the full auto-charge build (NOT BUILT #1).
