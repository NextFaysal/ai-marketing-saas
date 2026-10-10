# Milestone 7 Acceptance Checklist - Inbox & Leads/CRM

- [x] Prisma models: ChannelConversation, ChannelMessage, MessageDraft,
      Lead, LeadActivity + migration 20261010060000. Schema total: 42 models.
- [x] Messaging connection: WhatsApp/Messenger connect verifies the token
      with Meta BEFORE saving; secrets (access token, app secret, verify
      token, phone number id / page id) stored AES-256-GCM encrypted in
      IntegrationCredential and never returned by any API.
- [x] Webhook endpoint /webhooks/meta/:integrationId:
      GET hub verification against the stored verify token;
      POST requires a valid X-Hub-Signature-256 HMAC (timing-safe compare),
      otherwise 403. Raw-body HMAC uses the same rawBody pipeline as
      WooCommerce webhooks (main.ts).
- [x] Inbound processing is idempotent: ChannelMessage is unique on
      (conversationId, externalId), so Meta retries count as duplicates,
      never double messages. Unread count, preview and last-message time
      update only for genuinely new messages.
- [x] Delivery statuses only ever move forward (sent -> delivered ->
      read) and only apply to outbound messages; failed is recorded.
- [x] Contact resolution: WhatsApp conversations match an existing
      Customer by phone (last-10-digits comparison); unmatched new
      contacts auto-create a Lead (source = channel) with an activity
      entry, so no enquiry is lost.
- [x] Sending has exactly one path (InboxService.sendReply): a row is
      created as "queued" and becomes "sent" only when the platform
      API returns a message id (wamid / Messenger message_id).
      Otherwise the row is "failed" with the platform error and the API
      throws, so the UI says "NOT sent". Client unit tests assert that
      a 200 response without a message id is a failure.
- [x] AI draft replies are suggestions only. suggestDraft creates a
      MessageDraft (status "suggested"); nothing is sent until a human
      calls sendDraft (optionally with edited content), which marks the
      outbound message sentByAiDraft=true. Real-LLM drafts are prompted
      to use only the provided business knowledge; the dev-template
      draft uses the actual matched product price/stock from the
      database or an honest "we will confirm" text - never an invented
      price or policy.
- [x] Leads/CRM API: create/list/search, stage pipeline
      (new/contacted/qualified/proposal/won/lost) with per-stage count
      and value, open-pipeline value excludes lost, stage changes and
      notes logged to LeadActivity, convert-to-customer matches by
      email/phone or creates a Customer (source "lead"), idempotently.
- [x] Web: Inbox page (conversation list with unread badges, thread,
      status chips, reply box, AI Draft panel with approve/edit/dismiss,
      honest failure display, connection form with webhook setup
      instructions) and Leads page (pipeline board by stage with inline
      stage change, KPI cards, create form, detail panel with activity
      history, note entry and convert button).
- [x] Tests: 111 total passing (API 103, contracts 7, worker 1).
- [x] Builds: all packages + API + Next.js pass.
- [ ] Live end-to-end test needs the user's Meta app: create the app,
      connect a WhatsApp test number / Page, set the webhook callback
      and verify token, subscribe to "messages", then send a test
      message. WhatsApp free-form replies are also subject to Meta's
      24-hour customer service window; outside it, template messages
      are required by Meta policy (template sending is a later phase).

## Known limitations
- Messenger contact names are not in the webhook payload (Meta does not
  send them); conversations show the PSID until a name is known from
  another source. WhatsApp provides the profile name.
- Media messages are stored with their type and no content; media
  download/display arrives with a later media phase.
- Assignment exists at the data/API level; the assignee picker UI comes
  with the team phase polish.
