# Messaging Power — Batch B3 Acceptance (MS5 Composer v2 + MS6 WhatsApp Template Hub)

Date: 2026-10-13 · Worktree: `~/workspace/ai-marketing-saas-ms` (branch `ms-package`) · Base: B2 HEAD `b3aed18`
Commits: `aed0c4f` (MS5 schema) · `ed59a03` (MS5 composer) · `84bf279` (MS5 specs) · `a3d46aa` (MS6 schema) · `de1981a` (MS6 client + hub) · `b8e742a` (MS6 specs) · `8057da9` (MS5+MS6 web)
Local commits only — **not pushed** (owner-only push rule).

## Gate (baseline B2 → B3 final)

| Check | B2 baseline | B3 final |
|---|---|---|
| API jest | 218 suites / 1996 tests | **220 suites / 2054 tests, all pass** (+58: MS5 36, MS6 22) |
| API `tsc --noEmit` | clean | clean |
| Web vitest | 140/140 | **148/148** (+8: web sms-segments + composer-blocks mirrors) |
| Web `tsc --noEmit` | clean | clean |
| Next build | green | green |
| Prisma validate | valid | valid |

During development the MS6 worker's first inbox+messaging area run hit one `cx3-debounce` failure — the known pre-existing flake recorded since the CX package; it passed standalone (18/18) and the full final run above is green with zero failures.

## MS5 — Composer v2

1. **Real snapshot vars (the `vars: {}` gap is fixed).** `SnapshotEntry.vars?` is built at
   prepare time (`buildSnapshotVars`): customer vars from a chunked customer lookup plus
   DB order aggregates (`computeOrderAggregates`) and a new `computeLastOrders`
   (chunk 100, non-cancelled orders, latest first) for `lastOrderNumber` /
   `lastOrderTotal` (`(minor/100).toFixed(2)`, `""` when there are no orders — never
   invented); lead vars from the lead row; csv vars `{name: "", address}`. The send path
   passes `entry.vars ?? {}` into personalization; WhatsApp `{name}` substitution is
   unchanged and additionally resolves any `{key}` from vars. `GET messaging/variables`
   serves the canonical `TEMPLATE_VARIABLES` (customer: name, firstName, lastName, email,
   phone, lastOrderNumber, lastOrderTotal, ordersCount; lead: name, email, phone,
   stage, source, value; csv: name, address). Specs pin: no orders ⇒ `ordersCount: 0`
   and empty last-order values; csv vars carry no name.
2. **HTML email.** `MessageTemplate.htmlBody` + `Broadcast.htmlBody` (migration
   `20261013140000_ms5_composer`). Creating an sms template with htmlBody, updating a
   non-email template with htmlBody, or creating an sms/whatsapp broadcast with
   htmlBody ⇒ 400. Template-sourced broadcasts copy subject/body/htmlBody from the
   template. Sending renders text + HTML, with the unsubscribe footer appended to
   **both** parts (and to neither when token signing fails — never a broken footer).
   Empty htmlBody reproduces the old text-only behaviour exactly (spec pins the
   ABSENCE of the `html` key). No server-side sanitization is applied — the HTML is
   the merchant's own authored content; the web preview is sandboxed (below).
3. **Product / coupon blocks.** `GET messaging/composer/products` returns ACTIVE
   products (real rows) with display prices (`formatPriceMinor`: BDT ⇒
   `৳1,250.00`, en-IN grouping, 2 dp) and ready text/HTML snippets. **Product URL
   determination (evidence-based): a real per-product URL exists** — `Product.slug`
   is a real per-product slug (`ProductsService.getPublicProductBySlug`), the web
   `/checkout/[slug]` route is a single-product checkout, the dashboard products page
   already builds `${origin}/checkout/${p.slug}`, and inbox social-comments uses the
   same. So: slug present ⇒ snippet URL = `${webBaseUrl()}/checkout/${slug}`; no
   slug ⇒ `url: null` and the snippet carries name + price only — **no fabricated
   link** (spec-pinned). The endpoint response also carries the additive `url`
   field. Coupon snippets are pure text (`কুপন কোড: CODE — label` / HTML-escaped
   HTML variant). **There is still no tenant discount/coupon store** — a coupon
   block is text only; the composer UI states this in Bengali next to the insert
   button (the system does not validate, redeem or track the code).
4. **Test sends.** `POST broadcasts/:id/test-send` and `POST templates/:id/test-send`
   (WRITE_ROLES, audited `broadcast.test_send` / `template.test_send`) send ONE
   message through the same resolved sender path with vars `{name: "Test"}`.
   Broadcast tests carry explicit markers (`[TEST] ` subject prefix + 🧪 banner in
   text and HTML; SMS gets the banner) and run WITH the broadcastId so the footer
   and delivery record are realistic — recorded as recipientType `test`,
   recipientId null. **Spec-proven: the broadcast row, snapshot and counters are
   byte-identical before/after a test send.** Template tests send the template's
   own content with no broadcastId (no footer, no link rewriting — it is not a
   broadcast).
5. **Link tracking (LOCKED RULE).** `MessagingSetting.linkTrackingEnabled`
   (schema default **true**, migration above) has exactly two behaviours:
   **OFF ⇒ authored links go out verbatim on every channel — no UTM, no wrapper,
   no rewriting of any kind** (spec-pinned). **ON ⇒** on the **broadcast path
   only** (email text + HTML parts and SMS bodies; **never workflows, never
   WhatsApp**), authored http(s) links gain UTM parameters (`utm_source=<channel>`,
   `utm_medium=broadcast`, `utm_campaign=<broadcast name slug>` — existing params
   are never duplicated or overwritten) and are wrapped in an HMAC-signed redirect
   token (same pattern as the unsubscribe token, purpose `"msg-link"`). The wrapped
   URL is the API URL directly, `${API_PUBLIC_URL}/public/messaging/redirect/:token`
   (the web `/r/[token]` route is already taken by public reports). The public
   redirect verifies the token, records a `MessageLinkClick` (org, broadcast,
   recipient when known, target URL) and 302s; a tampered token gets a Bengali
   400 and records nothing. Delivery recording tolerates csv/test recipients
   (recipientId null when the snapshot entry has no real id).
6. **Compose-check.** `POST messaging/compose-check` (advisory only — never blocks
   a send) returns Bengali warnings: SPAM_WORD (EN + BN word lists), CAPS_SUBJECT
   (≥10 letters, >60% caps), MANY_LINKS (>3), MISSING_SUBJECT (email), SMS_PARTS
   (>3 parts, part count in the message, via the shared sms-segments module),
   BODY_TOO_LONG (>10,000 chars).
7. **Web composer.** Broadcast + template forms gained: HTML body field with a
   **sandboxed** live preview (`<iframe sandbox="" srcDoc=…>` — no scripts can
   run), variable chips per audience entity (data fetched from
   `GET messaging/variables`, the same constant the API builds vars from),
   product picker inserting the API-built snippets, coupon insert (web mirror of
   the API snippet format + the honest no-redemption note), per-row test-send
   boxes for broadcasts and templates with verbatim results, debounced
   compose-check warnings, a live SMS parts/encoding line (web mirror of
   sms-segments, marked as a mirror, vitest-pinned), and the link-tracking
   toggle in the consent/settings card with honest copy (OFF ⇒ links exactly as
   authored; ON ⇒ SMS part count can grow).

## MS6 — WhatsApp Template Hub

8. **Schema** (migration `20261013150000_ms6_whatsapp_templates`):
   `WhatsAppTemplate` gains `metaTemplateId`, `status`, `qualityRating`,
   `components` (Json), `lastSyncedAt`; `Broadcast` gains `templateComponents`
   (Json). All additive.
9. **Meta client.** `MessagingSecrets.wabaId?` added. `sendWhatsAppTemplate`
   gained an optional `rich` argument (`headerTextParams`, `headerMedia`
   image/video/document link, `buttonParams` url/quick_reply) building
   components in header → body → buttons order; **when `rich` is absent or
   empty the request body is byte-identical to the pre-MS6 shape** (spec-pinned;
   all existing meta-messaging + inbox specs pass unchanged). New
   `listMessageTemplates(wabaId, after?)` (fields name, language, category,
   status, quality_score, components, id; limit 100; cursor paging) and
   `createMessageTemplate(wabaId, payload)`; Meta errors are thrown verbatim.
10. **WABA ID setting.** `ConnectMessagingDto.wabaId` (whatsapp only, stored in
    the encrypted credential); `PATCH organizations/:orgId/inbox/whatsapp-waba`
    (OWNER/ADMIN) updates it on the connected whatsapp integration (decrypt →
    set/delete → re-encrypt; audit `integration.whatsapp.waba_updated`).
    `listMessagingIntegrations` exposes `wabaId` for whatsapp rows (defensive
    decrypt ⇒ null on failure; the access token is never exposed). When no WABA
    ID is set, sync/submit refuse with Bengali guidance: "WABA ID সেট করা নেই —
    WhatsApp Manager / Meta Business Settings থেকে WhatsApp Business Account ID
    সংগ্রহ করে Inbox-এর WhatsApp সেটিংসে বসান।"
11. **Sync.** `POST inbox/whatsapp-templates/sync` (OWNER/ADMIN) collects ALL
    pages first (max 10 pages, `truncated` flag); any Meta error ⇒ verbatim
    400 and **nothing is written**. Upserts by (org, name, language) with
    metaTemplateId / status / qualityRating (`quality_score.score`) / category /
    components / bodyText (from the BODY component, case-insensitive) /
    lastSyncedAt. **NOT_ON_META marking happens only after a complete,
    untruncated sync** — a truncated or failed sync never marks anything.
    Returns `{synced, created, updated, notOnMeta, truncated}`; audit
    `whatsapp_templates.sync`.
12. **Submit.** `POST inbox/whatsapp-templates/submit` (OWNER/ADMIN) validates
    locally BEFORE any Meta call (Bengali 400s): name `/^[a-z0-9_]{1,512}$/`,
    category MARKETING|UTILITY|AUTHENTICATION, example values count must equal
    the max positional `{{n}}` index in the body, a text header with `{{1}}`
    requires a header example, an image header requires a Resumable Upload
    `headerHandle`, buttons ≤10 with text ≤25 chars and http(s) URLs for URL
    buttons. The create payload uses Meta's UPPERCASE component format (BODY
    examples as `example.body_text: [[…]]`). **Meta is called FIRST; the local
    row is stored only on Meta success**, with status = Meta's returned status
    or `PENDING` when absent. A Meta rejection ⇒ verbatim 400, nothing stored.
    Audit `whatsapp_templates.submit`.
13. **Rich broadcast sends.** `CreateBroadcastDto.templateComponents`
    (`headerMediaUrl`, `headerTextParams`, `buttonParams`) is validated
    (http(s) media URL; non-whatsapp channel + templateComponents ⇒ 400),
    stored on the broadcast (both A/B variants), and the WhatsApp sender builds
    rich params per recipient — `{name}`/vars substitution applies to header
    text params and button text/payloads; rich is passed only when non-empty so
    legacy sends stay byte-identical. `headerMediaUrl` is sent as an **image**
    header (documented limit: video/document headers are not expressible
    through this field).
14. **Web hub.** Messaging page "WhatsApp Templates (Meta)" card: template list
    with status badges (a null status is labelled "শুধু লোকাল — Meta-তে যাচাই
    হয়নি", never dressed up as approved) and quality badges, WABA ID field
    with where-to-find guidance, Sync button with result counts (incl. the
    truncated explanation), and a create/submit form (name, language,
    category, body + example values, text/image headers incl. the honest
    header-handle explanation, URL/quick-reply buttons). The broadcast form's
    WhatsApp section gained header media URL, header text params and button
    param rows, sent as `templateComponents` only when filled. The Inbox
    template registry now shows the same status/quality badges.
15. **Meta documentation sources (verified 2026-10-13 from Meta's public
    docs):**
    - Template fundamentals — https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview — create via `POST /{waba-id}/message_templates` `{name, category, language, parameter_format?, components}`; names ≤512 chars, lowercase alphanumerics + underscores; create returns id + status; only APPROVED templates are sendable.
    - Template components — https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components — create uses UPPERCASE component types; a media header example requires `header_handle` from the Resumable Upload API; BODY examples are required when the text has parameters (`example.body_text: [[…]]`, positional); BUTTONS URL/PHONE_NUMBER/QUICK_REPLY with button text ≤25 chars.
    - Send-time template components (lowercase) — https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/interactive-message-templates/ — header text `{type:"text", text}`, header image `{type:"image", image:{link}}`, URL button `{type:"button", sub_type:"url", index, parameters:[{type:"text", text:<suffix>}]}`, quick-reply `{sub_type:"quick_reply", parameters:[{type:"payload", payload}]}`.
    - List/fields/paging/`quality_score` shape — Graph API reference for the WhatsApp Business Account `message_templates` edge (fields incl. name, language, category, status, `quality_score{score: GREEN|YELLOW|RED|UNKNOWN}`, components, id; cursor paging). The reference page itself is JS-rendered; the field set was corroborated via public doc mirrors — recorded here rather than overstated as a direct read.
16. **Messenger broadcast assessment (documented decision: NO Messenger
    broadcast ships in B3).** Facts from Meta's public documentation,
    checked 2026-10-13:
    - Messenger's standard messaging window is 24 hours from the user's last
      message; message tags are for non-promotional use only.
    - **Recurring Notifications** (the marketing-messages opt-in programme)
      were **deprecated on February 10, 2026**, with access limited to
      existing partners from September 1, 2025 — Meta announcement:
      https://developers.facebook.com/blog/post/2022/05/19/introducing-recurring-notifications-automated-messages/
    - The replacement is the **Marketing Messages API for Messenger** (FAQ:
      https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq), which sends to individual
      users using per-user opt-in tokens (`notification_messages_token`
      delivered via the `messaging_optins` webhook:
      https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messaging_optins/). This system does not collect such tokens,
      and one-time notification tokens are single-use per topic.
    - **Conclusion:** there is no policy-supported Messenger *marketing
      broadcast* path available to this system today. No send path was built
      and no fake opt-ins are stored. Revisit only if/when the product starts
      collecting Messenger marketing opt-in tokens through a real opt-in
      surface.

## Deviations (with reasons)

- **MS5 A/B:** htmlBody exists only on variant A; variant B's htmlBody is null
  and there is no `abHtmlBody` input (the brief defined no B-HTML field; B
  keeps the pre-MS5 shape).
- **MS5 template test-send** carries no `[TEST]` prefix/banner — the brief
  specified markers only for broadcast test sends; a template test sends the
  template's real content so the merchant sees exactly what recipients get.
- **MS5 spec touch:** `ms2-preferences.spec.ts` changed by exactly one line
  (the settings exact-shape expectation gained `linkTrackingEnabled: true` —
  the shape genuinely grew).
- **MS5 updateTemplate:** the htmlBody channel check is literal — providing
  htmlBody on update of a non-email template ⇒ 400.
- **MS5 snapshot vars:** order-aggregate/last-order reads are defensive
  (a failed read degrades to the no-orders shape), per the B1/B2 pattern.
- **MS6 sync pagination:** a further page is walked when an `after` cursor
  exists AND (`paging.next` present OR the page returned rows) — Meta's docs
  give both signals; either alone risks an infinite walk or a false
  "complete" that would wrongly mark rows NOT_ON_META.
- **MS6 sync update:** when Meta omits `id`, an existing row keeps its stored
  metaTemplateId rather than being nulled.
- **MS6 sync audit** omits `entityId` (the AuditService type marks it
  optional; `null` is not assignable).
- **MS6 integrations list** includes the credential relation for all three
  providers (the sanctioned simplest path); only whatsapp rows are decrypted,
  defensively, and only `wabaId` is exposed.

## Honest limits

- Migrations `20261013140000_ms5_composer` and
  `20261013150000_ms6_whatsapp_templates` are hand-written additive SQL and
  have **NOT been run on any real database**; prisma validate passes, nothing
  more is claimed. Deploy still needs migrations + `prisma generate` and a
  manual Dokploy redeploy.
- **No live provider proof exists** (M30 still owed): HTML email, link
  redirect, WhatsApp sync/submit and rich sends are proven against
  fake-prisma/fake-fetch specs only. The first real Meta sync/submit and the
  first tracked broadcast are live-verification items for the owner.
- Authored HTML email is sent as authored (no server-side sanitizer); only
  the composer's preview is sandboxed. Merchants must paste only their own
  trusted HTML — stated in the UI copy.
- `headerMediaUrl` is sent as an image header only; video/document template
  headers cannot be expressed through the broadcast form in this batch.
- Creating an image-header template requires a Resumable Upload handle from
  Meta — the app does not yet upload media to Meta, so the submit form asks
  for the handle and refuses honestly without it.
- Click tracking counts redirect hits; it does not prove the recipient read
  the message, and email open tracking remains out of scope (MS7 territory).
- Messenger broadcast: not shipped, by policy — see §16 above.
