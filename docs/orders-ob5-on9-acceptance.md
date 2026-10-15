# Orders Next — ON9 Acceptance (Orders Analytics v2 + Owner Digest)

Date: 2026-10-14 · Branch `orders-next` (base: ON8 final `978f7f9`) · **Local commits only — NOT pushed, NOT deployed. NO new Prisma model, NO migration** (digest sends are AuditLog rows, per spec).

Commits (oldest → newest): `30088a5` ON9 API + job · `b65b459` ON9 web · this doc (see git log).

## Metric definitions (as implemented — the single source is the header of `order-analytics.service.ts`)

- **Order date** = `placedAt ?? createdAt`. **Range** = Asia/Dhaka calendar days (`from`/`to` = YYYY-MM-DD; Dhaka is UTC+6 year-round, window = [from 00:00+06:00, to+1day 00:00+06:00); defaults: to = today (Dhaka), from = to − 29 days; from > to → 400 Bengali). Practice orders excluded everywhere.
- **SOLD bucket** = the EC33 predicate (`storefront/ec27-discovery.isSoldOrder`, the same one Customer-360 LTV mirrors): not cancelled/refunded/failed AND (status completed/delivered OR a shipment in delivered/partial_delivered). `revenueMinor` = Σ `totalMinor` over sold orders placed in range; `aovMinor` = revenue / **sold count**, null when the sold count is 0.
- **repeatCustomerRate**: among customers (customerId non-null) with ≥1 sold order in range, % with ≥2 sold orders in range; null when the denominator is 0.
- **cancellationRate** = raw-status `cancelled` orders / all orders placed in range. **cancelBreakdown is BY SOURCE** — the Order model has **no cancel-reason field**, so no reason taxonomy exists (stated in code, API payload `cancelBreakdownBasis: "source"`, and the web panel).
- **returnRate basis** = orders placed in range whose raw status is `returned` OR that have ≥1 ReturnRequest in `received`/`completed` (the real RMA machinery — a merely `requested` return does not count), over all orders placed in range.
- **topDistricts** (top 10, sold bucket): structured `Customer.address.district` (the ON11-confirmed Json) wins; else `parseBdAddress` over the order's address text, **medium/high confidence only** — low-confidence parses are excluded, never guessed.
- **Courier scorecard** (shipments BOOKED — `CourierShipment.createdAt` — in range, per provider): delivered/returned % use the **S5 decided denominator** (delivered+returned+cancelled via `classifyShipmentStatus`; in-flight has no outcome yet). **Delivered-timestamp basis + caveat:** CourierShipment has **no `deliveredAt` column and no persisted status-history table** (the A2 `shipment.status_changed` events are in-memory emissions), so `avgTransitDays` pairs booking `createdAt` → the shipment's **`updatedAt` while its status classifies as delivered** (the last status-sync stamp — an approximation a later poll can move; S5 refuses this basis and returns null, ON9 adopts it per spec, labelled, with `transitPairs` beside the average). `avgCodCollectLagDays` pairs that delivered basis → `codCollectedAt` (EC26: set only by reconciliation import / staff accept_sheet); pairs where collection precedes the delivered basis are excluded as impossible. Both averages are **null when there are no pairs** (`transitPairs`/`codPairs` expose the sample) — never 0 masquerading as data.
- **productReturnWarnings**: per linked productId — orders = distinct in-range orders containing it, returns = distinct such orders with a `received`/`completed` ReturnRequest entry for it (same basis as returnRate); warns at rate ≥ `RETURN_WARN_RATE` (25%) AND orders ≥ `RETURN_WARN_MIN_ORDERS` (10). Unlinked lines (productId null) are skipped.
- **stuckNow / slaBreachesNow** (current snapshot, org-wide): stuck = shipments in `TRANSIT_STATUSES` idle past the org's `FulfillmentSetting.stuckDays` (SLA_DEFAULTS fallback) — the **ON6** definition, counted whether or not the ON6 sweep has escalated them; SLA = non-terminal orders whose **OB3 `computeSlaStage`** reports breached. Both call/reuse the existing helpers — nothing re-derived.

## Owner digest

- `buildDigest(orgId, "yesterday"|"today")` for the Dhaka day: orders placed, sold-bucket revenue, **collected** = Σ `amountMinor` of APPROVED PaymentVerifications **created** that day (the model carries no reviewedAt/updatedAt — createdAt is its only timestamp; EC19 staff advances are created already-approved so for them it IS the collection moment; a later-approved inbox extraction counts on its creation day — stated caveat), **dueOutstanding** = org-wide Σ (total − Σ approved verifications) over delivered/completed orders (the EC19 `due_collection` math), stuckNow, slaBreachesNow, top district of the day.
- `sendDigest`: recipients = ACTIVE **OWNER** memberships. Email via `EmailProvider.send` — Bengali subject "গতকালের/আজকের অর্ডার সারাংশ — <brandName ?? org name>", plain-text Bengali body with ৳ amounts from minor. **SMS leg:** neither `User` nor `Organization` carries a phone field anywhere in the schema (audited), so the phone lookup returns null in practice and every owner's SMS result is `{ok:false, skipped:true, error:"no_phone_on_record"}` — no number is ever invented; the send path (`ShopAccountService.sendShopSms`) is wired for the day a real field exists. Per-recipient failure isolation throughout. **ONE AuditLog row per run** (action `owner_order_digest`, metadata = figures + per-recipient `{userId, channel, ok, skipped?, error?}`).
- **Job:** `JOB_TYPES` + `JOB_TEMPLATES` entry `owner_order_digest` (org target, 1440 min) + `executeJob` case → `runOwnerDigestJob` = `sendDigest(orgId, "yesterday")`. Per-org enablement is the org's ScheduledJob toggle, exactly like the other sweeps.
- **Endpoints** (`OrderAnalyticsController`, same prefix as OrdersController, registered FIRST so the literal segments win over `:orderId`; `@PermissionArea("orders")`): `GET orders/analytics?from&to` (read), `POST orders/digest/send-now` (write roles; runs "today", returns the run summary), `GET orders/digest/status` (last run from the latest `owner_order_digest` AuditLog row + `jobEnabled`/`jobInstalled` from the org's ScheduledJob rows of that type + owner email preview).

## Web

Orders page header gains a "📊 অ্যানালিটিক্স" button opening `on9-analytics.tsx` (same modal shell as ON8): range picker (৭ দিন / ৩০ দিন / কাস্টম দুটি date input), summary tiles (orders, revenue, AOV, repeat/cancel/return rates + cancel-by-source line), stuck/SLA snapshot chips, courier scorecard table (pair counts shown, nulls as "—"), top districts as proportional bars + figures, product return warnings table, and the digest card (last-send status + per-recipient results, owner email preview, "এখনই পাঠান" send-now with the run result, and the honest note that daily auto-send is the per-org `owner_order_digest` job in Jobs/স্বয়ংক্রিয় কাজ settings — no fake toggle). Payload shaping in `lib/orders-on9.ts` with vitest.

## Gates (builder-run; the coordinator runs the full gate)

- API specs: `on9-analytics.spec.ts` **14/14** (Dhaka boundary incl. placedAt-null fallback + from>to refusal, sold revenue + AOV null-at-zero, repeat math, cancel breakdown by source, scorecard percentages/pairs/nulls, snapshot counts, warning thresholds — 24% excluded, 33%-but-9-orders excluded, exactly-25%-with-12 included, digest figures, per-recipient isolation, no-phone SMS skip, exactly-one audit row, status endpoint, job body, cross-org isolation) — exit 0.
- Touched suites: `src/orders` + `src/automation` + `src/order-automation` **31 suites 387/387** — exit 0 (incl. a4 job-templates with the new template).
- API `tsc --noEmit` exit 0 · Web `tsc --noEmit` exit 0 · Web vitest (orders-on9 + on8 + on1 files) **28/28** (7 new ON9 tests) · Web `next build` exit 0.
- No schema change → no migration; the 163-migration sequence is untouched.

## Honest limits

- **Nothing is live-proven**: no real SMTP/SMS provider, courier, or store was exercised; digest correctness rests on the EmailProvider/sendShopSms contracts plus these specs. M30-style live verification is still owed.
- `avgTransitDays` rests on the `updatedAt` approximation named above — a courier sync poll after delivery moves the stamp and inflates that shipment's transit time. A real fix needs a persisted delivered-at (schema change, coordinator's call).
- The SMS digest leg can never fire until a real owner phone field exists somewhere (none does today) — every run records the honest `no_phone_on_record` skip.
- Analytics aggregates in JS over org-scoped `findMany` (the orders-area house pattern for queues/insights); very large orgs will want indexed SQL aggregation later — correctness first, per the package's other services.
- No screenshot QA of the new panel (needs the build deployed).
