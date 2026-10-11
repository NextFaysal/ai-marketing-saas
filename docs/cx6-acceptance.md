# CX6 — Tracking Card + All-Customer Updates + Auto-Sync Job — Acceptance

**Status: DELIVERED (local commit only — NOT pushed).**
Migration: `20261012130000_cx6_tracking_token` (adds `CourierShipment.trackingToken TEXT` + unique index; applies via `prisma migrate deploy` on the owner's server — the sandbox has no Postgres, so it is written but not applied locally).

## 1. Public tracking page

- Token on the shipment row (ReportShare/M59 pattern): `trackingToken String? @unique`, minted lazily by `CourierService.ensureTrackingToken` — `randomBytes(24).toString("base64url")` — on the first customer update, manual share, or tenant link request (`POST organizations/:id/courier/shipments/:shipmentId/tracking-link`). One collision retry; persistent failure sends without a link rather than breaking the update.
- API: `GET public/tracking/:token` (no auth — the unguessable token is the credential). Unknown token → 404.
- Payload = stored facts only: provider, tracking code, the courier's status string **verbatim**, invoice, order number, `bookedAt` (row createdAt), `statusAt` (row updatedAt), `lastCheckedAt`, and white-label branding (brandName/logoUrl/primaryColor). **No recipient name/phone/address is ever served** — a public link must not leak customer PII (asserted by a deep key scan in the spec).
- Web: `apps/web/src/app/t/[token]` mirrors the public report page (`/r/[token]`). The Bengali stepper is rendered by the EXISTING `lib/courier-status` mapping (the same one the inbox P2 widget uses — reused, not forked): known statuses step, returned/cancelled get their banners, an unmapped status shows the courier's own words with no guessed step. The timeline has exactly two honest entries — বুক হয়েছে and the current stored status with its recorded time. No scan events are invented. Delivery-partner phone/link: the providers store none in our data, so none is shown (the field exists only if stored data ever has it — it does not today).

## 2. Notify upgrade — tracking card + all-customer channels

`syncShipment`'s `notifyCustomer` (and the booking-time call) now compose the tracking CARD:

```
🚚 <provider> কুরিয়ার
<headline — the existing NOTIFY/shipped/booked Bengali sentence>
অর্ডার: <externalNumber>
Tracking: <code>
স্ট্যাটাস: <raw status>
লাইভ ট্র্যাকিং: <WEB_URL>/t/<token>
কোনো সমস্যা হলে এই Tracking কোডটি জানিয়ে আমাদের মেসেজ করুন।
```

**Channel precedence (documented, implemented, spec-tested): conversation first → SMS → email.**

1. The order's linked chat conversation (existing `sendAutomatedMessage`, tag `courier_update`).
2. Else SMS via `SmsProvider` to the customer's phone (falling back to the shipment's recipient phone), normalized to the 880 form.
3. Else email via `EmailProvider` to the customer's email.

**Dedupe (one notification per status transition, across ALL channels):** `lastNotifiedStatus` remains the single stamp, written ONLY after a confirmed send on whichever channel won. A status already stamped is never re-sent on another channel. If no channel reaches the customer (e.g. SMS unconfigured and no email), **nothing is stamped**, so a later sync can retry when a channel exists. An unconfigured SMS/SMTP is skipped silently (one server log line) — it never throws into the sync path and never fails a booking/sync. The booked pseudo-state machine is unchanged: `null → booked card stamps "booked" → first real movement sends the shipped card`, `in_review/pending` first statuses stay silent, exactly as before.

Manual `shareTracking` (inbox) appends the same `লাইভ ট্র্যাকিং:` link (token shared with the automated updates — one link everywhere) and returns it as `trackingLink`.

## 3. Scheduled auto-sync job — the deferred item is CLOSED

New job type **`courier_auto_sync`** (JOB_TYPES + JOB_TEMPLATES + `executeJob` case), org-scoped template, **default interval 60 minutes**. The Automations web form option entry was also written, but it is deliberately NOT in this commit: while CX6 was being staged, the parent track was mid-repair on that exact page (the owner's d39f02a automations modernization was merged as `d851b40` and parts of it were being backed out in the shared index). The entry sits in the working tree on the pre-modernization page version and lands with that repair; the job itself is fully creatable via the templates API (`JOB_TEMPLATES` → createJob) regardless. It runs the existing `CourierService.syncAll`: newest 200 shipments, terminal ones excluded, **sequential** `syncShipment` per shipment (the courier-politeness behaviour the manual sync already had), per-shipment failures isolated and counted in the run result (`{ checked, synced, changed, errors[] }`). This closes the long-deferred "scheduled courier auto-sync" item from Inbox P2.

## Tests

`apps/api/src/courier/cx6-tracking.spec.ts` (12 tests): unknown token 404; page payload = stored facts only + zero recipient PII keys; token mint-once + reuse; org-scoped tenant link (other org → 404); precedence conversation > SMS > email (fake providers at the send seams); card text contains the link + tracking code; cross-channel dedupe; SMS-unconfigured → email fall-through; both unconfigured → silent, no stamp, no throw; booked → shipped → dedupe sequence; pending-first-status silence; job registration (type + template, 60 min); syncAll batching with one provider failure isolated and counted.

**Known pre-existing failure (NOT CX-caused):** `courier.spec.ts` "sync updates the status and notifies the chat customer once" sees 2 inbox calls instead of 1 in the working tree. The extra call is the booking-time card sent by the PARALLEL AG1 track's **uncommitted** `bookShipment → notifyCustomer({ booked: true })` call, which does not exist at HEAD and is not in this commit — in the committed tree, booking sends nothing and the test's premise holds (verified on a clean checkout of the commit). CX6's notifyCustomer deliberately honours the `{ booked }` option so that uncommitted work keeps functioning in the shared tree.

## Evidence ceiling (stated plainly)

Sandbox has no Postgres and no live courier/SMS/SMTP credentials: all sends are proven ONLY via fake providers at the send seams; no real SMS, email, or chat message was sent or is claimed. The public page was verified by payload specs + web build, not by a live browser fetch against a running stack. The migration applies on the owner's server via `prisma migrate deploy`.
