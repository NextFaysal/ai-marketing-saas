# MX14 — On-site Notification Channel: Acceptance

Item: MX14 (Messaging Advanced, batch MB5). Base HEAD `d8e3d096`
(MB1–MB4 + MX12 + MX13). Worktree `~/workspace/ai-marketing-saas-mx`,
branch `messaging-advanced`. Local commits only — nothing pushed.

**Worker note (replacement worker):** the previous worker died in a
daemon restart mid-item, leaving coherent UNCOMMITTED partial work
(schema + migration + the messaging-service channel). This worker
audited the full diff piece by piece, KEPT what was sound (verified
against the brief, the MX12/MX13 precedents and the code), FIXED
nothing in it that proved wrong — no piece of the inherited service
code contradicted the brief or a spec pin — and built everything
that was still missing: the shop-side customer notification center
(API + account-area UI), the dashboard composer/report surface, and
the spec suites. Per-piece accounting is in the first section.

## Inherited partial diff — kept / fixed / discarded

| Piece | Verdict |
|---|---|
| `OnsiteNotification` model + `Broadcast.onsiteUrl` + channel comments (schema) | KEPT as-is. `deliveryId @unique` is the delivery link + resume anchor; `@@unique([broadcastId, customerId])` is the per-customer dedupe anchor. Matches the brief exactly. |
| Migration `20261019060200_mx14_onsite_channel` | KEPT as-is. Hand-verified column-by-column against the final schema (additive only: `Broadcast.onsiteUrl TEXT` + the new table with both uniques and both indexes). No schema change was needed during completion, so no regeneration was needed. |
| `messaging.dto.ts` (`onsiteUrl` on create/update, shape-only) | KEPT as-is. |
| `messaging.service.ts` (~+369 lines: `validateOnsiteUrl`, pref-address/masking, customer-only resolver, send branch, create/edit/clone/report/test-send gates, cost null, funnel) | KEPT, after verifying each block (see the shipped audit). Corrections needed: NONE in behaviour. Two honest limits of the inherited code are recorded below rather than silently "fixed" into a different design: (1) the segment resolver does not pre-validate the segment name against `RFM_SEGMENTS` (an unknown segment honestly resolves to zero customers — no fabricated audience); (2) workflow (non-broadcast) onsite sends carry `broadcastId = null`, so the (broadcastId, customerId) unique does not dedupe them — broadcasts, the MX14 surface, always carry one. |

## Step-0 audit (verified against the tree)

- **No shop-side customer notification center existed** (only
  `OrderNotification*` [transactional — NOT touched],
  `AgentNotification` [staff], `NotificationPreference`). MX14 is
  the smallest REAL version: one notification store
  (`OnsiteNotification`), authenticated customer list/mark-read
  API, and a Notifications tab in the existing shop account area.
  That scoping decision is recorded here per the brief.
- **Shop customer auth is REAL** (EC25): phone-OTP login minting
  30-day `ShopSession`s (SHA-256-hashed tokens, `x-shop-session`
  header); the account identity IS the org-scoped Customer row;
  every account surface resolves through
  `ShopAccountService.requireSessionCustomer` (org-first +
  session). MX14's shop endpoints sit behind exactly that — no
  unauthenticated surface was shipped.
- Quiet hours (MX3), the plan cap (MX1 recipient rows) and the
  resolver filter stages are channel-generic and sit in front of /
  behind the channel branches, so onsite inherits them; the specs
  below prove the quiet-hours and filter behaviour for onsite.

## Shipped

### 1. Channel `onsite` end-to-end (recipient-table engine; legacy snapshot free via the shared choke point)
- Every broadcast-facing hardcoded channel gate in
  `messaging.service.ts` now accepts `onsite` (compose-check,
  preview, create, preference-address validation, preference
  import). Non-broadcast channel sets (templates email|sms, AI
  drafts, MX10 opt-in forms, MX11 suppression suggestions,
  keyword campaigns) were deliberately left unchanged — the
  MX12/MX13 precedent.
- Create rules (all honest 400s at create): title required
  (`subject` carries the notification title) ≤ 120 chars, body
  ≤ 2000 chars (this channel's own store caps — no provider
  imposes one, and the doc/code say so), `onsiteUrl` shop-relative
  only (`validateOnsiteUrl`, the MX12 rule: must start with `/`,
  never `//`, ≤ 500), message templates refused, WhatsApp fields
  refused, MX8 personalization refused (dynamic blocks could
  overflow the capped title/body), any enabled cascade refused
  (verdict below), audience must be `customers` or `segment`.
  `onsiteUrl` on a non-onsite broadcast is a 400.
- Edit re-validates the merged row (title required, caps,
  shop-relative URL; explicit null clears the URL); clone and
  recurrence chaining copy `onsiteUrl`; both process loops
  (recipient-table and legacy snapshot) pass it into the shared
  `sendToRecipient` choke point, so the legacy engine supports
  onsite exactly as it did push/telegram.
- Test-send to a typed address is REFUSED with the honest reason
  (push precedent): a test would pollute a real customer's
  notification center; the suggested path is a real broadcast to
  a narrow customers audience.

### 2. Resolution — customers of the org only
- `resolveOnsiteAudienceInChunks`: `customers` = every Customer
  row of the org (id-ascending scan; dedupe is the shared
  `${type}:${id}` key, so a customer can never be emitted twice);
  `segment` = customers whose id is in the named RFM segment
  (the same `computeRfm` source every channel uses). Every other
  audience type is an honest 400 at create AND at resolve:
  leads/csv/custom/saved cannot name a notification-center
  account without fabricating an identity.
- NO contact address is required: the channel address IS the
  customer id, so a customer with no email/phone still receives
  the notification in their center (spec-proven). All resolver
  stages apply unchanged with channel `onsite`, address =
  customer id: suppression (opt-out), pending double-opt-in
  exclusion, topic choices, per-contact + org frequency caps,
  the customer-row unsubscribed column, previous-recipient and
  recent-days exclusions (the recent-days stage's address pick
  now reads the customer id for onsite — inherited diff, verified).

### 3. Send = create the notification (resume-idempotent)
- The onsite branch of `sendToRecipient` writes the linked
  `MessageDelivery` FIRST with `deliveryStatus: "delivered"` +
  `deliveredAt` stamped at creation, then creates the
  `OnsiteNotification` row (rendered title/body, the broadcast's
  `onsiteUrl`, `deliveryId` = that delivery). If the notification
  create fails, the just-written delivery is removed and the
  failure is recorded honestly through the shared catch — a
  "sent" never stands without its notification.
- Resume idempotency is anchored twice: a re-send first checks
  for an existing (broadcastId, customerId) notification and
  returns `sent` WITHOUT a second notification or delivery
  (spec-proven at the choke point), backed by the schema's
  (broadcastId, customerId) and deliveryId uniques; and the MX1
  recipient-row state machine never re-selects a non-pending row
  (spec-proven through prepare → partial process → process).
- Opt-out / pending are enforced again at the single-send guard
  (a skipped delivery records why; no notification is created —
  spec-proven). Plan-cap counting is MX1's unchanged recipient-row
  path.

### 4. Delivered-stage reasoning (the funnel decision)
For onsite, `delivered` is a REAL stage and the funnel returns
it (like WhatsApp, unlike push/telegram): the send's database
write places the notification row in the recipient's own
notification center inside this system — the row's presence
there is observed by the system itself, not assumed from a
provider's acceptance. `read` is equally real: the customer's
own open action in the shop account area stamps `readAt` on the
notification AND `readAt` / `deliveryStatus: "read"` on the
linked delivery, and the funnel counts exactly those rows.
`opened` stays `null` (no pixel exists) and clicks stay `null`
(opening follows the shop-relative URL directly in the shop UI;
no tracked-link wrap exists — the read stage is this channel's
engagement signal). Cost is `null` in preview and report: there
is genuinely no provider and no org-entered rate; the composer
and report say "no provider cost" in words — never an invented
0 rate.

### 5. Shop side — authenticated customer notification center
- API (`ShopAccountService` + `PublicShopController`, all behind
  the EC25 session via `requireSessionCustomer`):
  `GET :orgSlug/account/notifications` (own rows only,
  newest-first, cap 100, `unreadCount`),
  `POST :orgSlug/account/notifications/:id/read` (own row only —
  another customer's id answers the same 404 as a missing one;
  idempotent, keeps the first readAt; stamps the linked
  delivery's read fields),
  `POST :orgSlug/account/notifications/read-all`.
  A missing table (migration not run) answers the list with the
  honest empty shape instead of crashing the account area.
- Web: `storefront-account.ts` gains `ShopNotification` +
  fetch/mark helpers; the shop account page gains a 🔔
  Notifications tab with an unread badge/count, a mark-all-read
  action, unread styling, and click → mark-read then follow the
  stored URL verbatim (root-relative, the MX12 push
  service-worker semantics). No other account tab changed.

### 6. Dashboard composer (Messaging page, existing layout kept)
- Channel select gains "🏠 On-site"; the onsite branch shows
  Title (maxLength 120), the generic Body field, the optional
  shop-relative click URL, and an honest note (shop customers
  only — customers/segment audiences; real read tracking; no
  provider cost). The create payload sends `onsiteUrl`; the
  cascade block, A/B (except the Variant-B title label), AI draft
  block and template picker follow the push/telegram pattern
  (cascade + AI hidden with notes; A/B stays available).
- Edit: onsite broadcasts edit Title + onsiteUrl + Body with the
  server re-validating the merged row. Report card gains the
  onsite note (delivered/read are real, clicks null, no provider
  cost). The test-send row explains the narrow-audience path
  instead of an address input (server refuses too). Preview's
  no-cost note is onsite-specific.

### 7. Migration
`20261019060200_mx14_onsite_channel` (inherited, verified):
additive only — `Broadcast.onsiteUrl TEXT` + `OnsiteNotification`
table (deliveryId unique, (broadcastId, customerId) unique, two
indexes). Channel columns are plain Strings and gain `"onsite"`
with no DDL. `prisma validate` passes. NOT run on any real DB
(the coordinator's fresh-PG gate covers it).

## Cascade verdict — onsite does NOT join CASCADE_CHANNELS
`CASCADE_CHANNELS` stays `email|sms|whatsapp`; an onsite
broadcast with any enabled cascade is refused at create by
`parseCascadeConfig` (onsite is not a cascade channel and the
primary must be included). Reasons, from the code (the MX12/MX13
reasoning applied to this channel's facts):
- The cascade content model has slots for smsBody / email
  subject+body / whatsappTemplateId — no onsite slot (title +
  shop-relative URL), and inventing one changes a spec-pinned
  pure module's contract for a combination no surface can author.
- A cascade attempt is a per-recipient fallback decision between
  contact-address channels; an onsite "attempt" is a write into
  the customer's own center inside this system — it cannot fail
  in a way another channel could meaningfully "fall back" from,
  and falling back TO onsite from email/sms would silently
  change the message's nature (a stored notification is not a
  delivered message substitute).

## Specs + scoped gates
- `apps/api/src/messaging/mx14-onsite-channel.spec.ts` (NEW,
  14 tests): validateOnsiteUrl rules; create accept + 11 refusal
  shapes; edit/clone URL handling; customers-only resolution
  (incl. the no-contact-address customer, other-org exclusion,
  dedupe, address stamped at prepare); preview masking + null
  cost; RFM segment resolution; opt-out (address = customer id)
  + pending exclusion + preference-id validation; send creates
  notification + delivered delivery with the deliveryId link;
  funnel (delivered real, read real-0 → moves after a shop-side
  read in the shop spec, opened/clicks null); resume via partial
  process (no duplicates) AND via a direct choke-point re-send;
  single-send opt-out skip; quiet-hours deferral; test-send
  refusal.
- `apps/api/src/storefront/mx14-shop-notifications.spec.ts` (NEW,
  5 tests): own-only list (newest-first + unread count); 401
  without a session on all three operations; mark-read stamps
  notification + linked delivery and is idempotent; another
  customer's notification → 404 with nothing stamped; mark-all
  stamps only the session customer's rows/deliveries.
- Results: MX14 suites + MX12 + MX13 + EC25 regression —
  5 suites / 73 tests PASS. Messaging regression subset
  (ms1/ms2/ms5/ms7/mx1/mx2/mx3/core messaging) — 8 suites /
  149 tests PASS.
- `prisma validate`: PASS. API `tsc --noEmit`: the ONLY error is
  pre-existing on HEAD `d8e3d096` and unrelated to MX14
  (`customers/ec-cp6-erasure.spec.ts:40` — a fixture missing the
  `prefs` field; the file is untouched by this item). Web
  `tsc --noEmit`: PASS (clean).

## NOT BUILT (with reasons)
- **Onsite in MX10 opt-in forms / preference-center surfaces and
  MX11 suppression suggestions** — those surfaces are
  address-channel shaped (email/sms/whatsapp); the preference
  STORE itself fully supports onsite (manual add + bulk import +
  resolver + send guard, spec-proven), which is the enforcement
  that matters. No inbound/opt-in surface exists for a
  shop-account channel to hook.
- **Onsite journey/workflow step channel** — workflow step
  channels stay email|sms|whatsapp (the MX12/MX13 precedent);
  `sendToRecipient` itself supports onsite for any future caller.
- **A separate shop notifications page/route** — the brief's
  smallest real version is the account-area tab; the shop header
  has no notification bell (adding one is storefront design work
  beyond this item).
- **Push-style "gone" lifecycle** — there is no external
  subscription to die; a deleted/merged customer simply stops
  resolving (org-scoped customer scan + merged-customer handling
  in the shared resolver paths).
- **Live proof** — no real DB migration run, no live shop
  session exercised (M30-style owner verification, as with
  MX12/MX13).
