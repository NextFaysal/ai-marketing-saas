# Inbox Next-Gen — Priority 2 (Sales Boost) Acceptance

Scope: audit items 4 (smart folders), 5 (bulk actions), 7 (product
showcase cards), 9 (courier tracking widget) from
`docs/inbox-nextgen-audit.md`, building on P1's media machinery
(`docs/inbox-nextgen-p1-acceptance.md`). **No schema changes.**
Local commits only — nothing pushed (owner's push rule).

## 1. Smart folders (audit item 4)

Folder chips above the conversation list: **সব / 👤 আমার ইনবক্স /
📥 অনির্ধারিত / ⏰ SLA Breach / ⭐ VIP বড় অর্ডার**, each with a
SERVER-SIDE count from `GET …/inbox/conversations/counts` (the
list itself is capped at 100, so page-derived counts would lie).
The list accepts `?folder=sla|vip`; mine/unassigned reuse the
existing `assignee` filter (the chips drive the same state as the
assignee dropdown — one source of truth).

**Folder/filter interaction:** the folder AND-composes with every
other active filter (search text, channel, status, assignee,
tag, unread, spam, sort). Switching to SLA/VIP does not clear the
other filters; the assignee-based folders are the assignee filter.

**SLA breach — precise definition (shared by the list filter,
the count, and the card badge so they can never drift):**

> `firstResponseAt IS NULL` AND `status IN (open, pending)` AND
> `createdAt < now − InboxSetting.slaFirstResponseMinutes`
> (default 60 when no settings row exists).

This is the team report's existing "current breach" rule widened
from `open` to `open + pending` (a pending thread that never got a
first reply is still a breach — stated here so the widening is a
decision, not an accident). The chip tooltip prints the threshold
minutes. The per-card ⏰ badge is display-only, derived from the
same fields client-side.

**VIP / বড় অর্ডার — threshold source:** a conversation is VIP
when its LATEST linked order (`Order.conversationId`, newest
first) has `totalMinor >= InboxSetting.escalationThresholdMinor`
— the U3 high-value/escalation threshold is REUSED; no second
threshold was invented. If the threshold is unset/≤0 the folder
is honestly empty (count 0, `vipThresholdMinor: null` in the
counts payload) and the web shows an empty state explaining the
threshold comes from inbox settings. The chip tooltip shows the
threshold amount when set. The id resolution scans the org's
3,000 most recent conversation-linked orders (the same honest
scan-and-reduce shape the U6 tag suggestions use).

## 2. Bulk actions (audit item 5)

`POST …/inbox/conversations/bulk` `{ ids, action, assignedUserId?,
tag? }` — actions `close | assign | tag-add | mark-read`, ids
capped at **25** (deduped; empty/over-cap/invalid → 400 before any
work). Each id runs through the SAME code path as a single update
(`updateConversation` for close/assign/tag-add — identical
validation, CSAT-on-close, assignee notification — and the same
mark-read update), so bulk semantics can never drift from single
semantics. Response: `{ results: [{id, ok, error?}], succeeded,
failed }` — one bad id never fails the batch; a foreign-org id
surfaces as that item's "not found" error (org-scoped lookup, no
existence leak). Audit: exactly ONE batch entry
(`inbox.conversations.bulk`, metadata `{bulkAction, requested,
succeeded, failed}`) on top of the per-item effects, per the
phase spec. Web: ☑️ বাল্ক toggle → checkboxes on cards (card click
toggles selection instead of opening), bulk bar with assign picker
(real members list, incl. unassign), tag input (suggestions from
tags present on loaded conversations), পঠিত and বন্ধ করুন; the
result notice states সফল X / ব্যর্থ Y, failure reasons are shown,
and failed ids stay selected for retry.

## 3. Product showcase cards (audit item 7)

`POST …/inbox/conversations/:id/messages/product { productId,
caption? }`. The caption is composed from REAL catalog fields
(`product-card.ts`): `🛍️ {name}` / `দাম: {formatMinor(price)}` /
`স্টক: Nটি আছে` or `স্টক: আপাতত শেষ` / optional agent caption /
the order line. The product's image is fetched server-side from
its catalog `imageUrl` (https only), magic-byte sniffed and capped
exactly like P1 uploads, then sent through P1's `sendMediaReply`
— no parallel send path.

**Honesty rules (enforced + tested):**
- No image URL / unfetchable / not-an-image (nothing sent yet) →
  fall back to a TEXT message carrying the same composed card
  copy (the server-side counterpart of the picker's text snippet);
  response `sentAs: "text"`.
- A PLATFORM rejection inside the media send (e.g. no connected
  integration) propagates verbatim, the image row is marked
  failed, and NO text fallback masks it.
- Messenger/Instagram attachment uploads carry no caption → the
  image goes first, then the card text as a follow-up message;
  if that follow-up fails the response says `sentAs: "image",
  captionDelivered: false` — never a silent partial.
- The web notice distinguishes all three outcomes from the
  server's own `sentAs`.

**Per-channel truth table** (inherits P1's delivery table):

| Channel | Image delivery | Caption carriage | `sentAs` |
|---|---|---|---|
| WhatsApp | Graph media upload → media_id | native caption param | `image+caption` |
| Messenger | attachment upload | none → follow-up text msg | `image+text` (or `image` + `captionDelivered:false`) |
| Instagram | attachment upload | none → follow-up text msg | `image+text` (or `image` + flag) |
| Telegram | Bot API sendPhoto/… | native caption | `image+caption` |
| Email | SMTP attachment | caption = mail body | `image+caption` |
| Webchat | stored row, token route | caption = message content | `image+caption` |

**Webchat widget:** the visitor-safe projection (`WebchatService.
listMessages` + the realtime visitor stream) gains ONE field —
`product: { name, priceText } | null` — parsed server-side from
the composed card caption (marker: outbound image whose first
line is `🛍️ …` and which carries a `দাম: ` line). No product ids,
SKUs or stock leak. The widget renders such messages as a card
(image + the caption text) with an **🛒 অর্ডার করুন** button that
sends `আমি "{name}" অর্ডার করতে চাই` as a normal visitor message
— the existing chat order flow / agent picks it up from there.
The dashboard picker keeps "টেক্সট বসান" (existing snippet) and
gains "🃏 কার্ড পাঠান" (composer text rides as the caption).

## 4. Courier tracking widget (audit item 9)

The context-panel shipment badge is now a per-shipment widget:
provider + tracking code, COD amount when the shipment row
carries one (`codAmountMinor`), `সর্বশেষ যাচাই: …` from
`lastCheckedAt` ("এখনো যাচাই হয়নি" when never synced), a
**🔄 এখনই আপডেট করুন** button calling the EXISTING
`POST …/courier/shipments/:id/sync` then refreshing the panel
(provider errors surface verbatim), and the thread header's
existing share-tracking action is unchanged. The context payload
now projects the shipment's `id`, `consignmentId`,
`codAmountMinor` and `lastCheckedAt` alongside the previous
fields.

**Status mapping** (`apps/web/src/lib/courier-status.ts`,
unit-tested) — `CourierShipment.status` is the courier's own
free-form string; normalized (lowercase, spaces/hyphens →
underscores) and mapped:

| Stored status | Widget |
|---|---|
| `created`, `booked` | stepper step 0 — বুক হয়েছে |
| `in_review`, `pending` | stepper step 1 — রিভিউ / পেন্ডিং |
| `in_transit` | stepper step 2 — পথে আছে |
| `out_for_delivery` | stepper step 3 — ডেলিভারির পথে |
| `delivered` | stepper step 4 — ডেলিভার্ড |
| `partial_delivered` | step 4 + "আংশিক ডেলিভার্ড" note |
| `returned` | terminal banner (red) — NOT a stepper step |
| `cancelled` / `canceled` | terminal banner (grey) — NOT a stepper step |
| anything else | courier's words verbatim, NO stepper (no guessing) |

**Deferred (follow-up, by design):** no scheduled/auto courier
sync job in this phase — sync stays manual via the button, as
scoped. A periodic sync worker is the natural next step.

## Verification

- API: `tsc` clean; full suite **676 tests / 97 suites green**,
  incl. 19 new P2 tests (`nextgen-p2.spec.ts`): folder
  where-clauses + counts (incl. threshold-unset emptiness and
  latest-order VIP semantics), bulk matrix (close/assign/tag-add/
  mark-read, foreign-id isolation, 25-cap, one batch audit entry),
  card compose/parse round-trip, product send outcomes (webchat
  image+caption with real MediaStore write, text fallbacks,
  unmasked Messenger rejection, org-scoped 404), visitor
  projection marker.
- Web: `tsc` clean; `next build` green; web tests **33/33**
  (5 new for the courier status mapping).
- **Live HTTP check: NOT done.** At verification time this
  sandbox has no Postgres and no Docker (VM replacement wiped the
  stack), so the API could not be booted against a real database.
  Endpoint behaviour is proven at the service layer by the tests
  above; a live pass remains owed when the stack is restored.
  The widget/page changes are build-verified, not pixel-QA'd in a
  real browser.
- Collision discipline: the Team track's uncommitted M73 work in
  the shared inbox files was preserved throughout — P2 changes
  were staged as handcrafted hunks only; their files remain
  modified-but-unstaged, their untracked spec/migration untouched.
  No schema change was needed or made. **Nothing was pushed.**
