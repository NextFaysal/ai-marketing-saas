# Milestone 46 (Unified Inbox U4) — New Channels (Acceptance)

Built 2026-10-10 from `docs/unified-inbox-plan.md` Phase U4.
Schema **103 models** (migration `20261010460000_m46_channels`:
ChannelConversation.subject for the email lane).

## What was built

- **Channel adapter contract** (`inbox/channels/channel-adapter.ts`):
  verify-before-save + confirmed-send semantics for every new
  channel. Meta keeps its proven path; webchat stays in-process.
- **Telegram bot channel (fully real)** — `TelegramService` +
  `TelegramAdapter` over the official Bot API:
  - Connect: the bot token is verified with Telegram (`getMe`)
    BEFORE anything is stored; credentials are AES-GCM encrypted
    and never returned. Webhook registration is attempted against
    `PUBLIC_API_URL` and its real outcome is reported in the
    response (registered or the exact reason not).
  - Inbound: `POST /webhooks/telegram/:integrationId`, checked
    with the per-integration secret token (timing-safe compare);
    messages land through the new shared
    `InboxService.ingestExternalMessage` — dedupe by message id,
    unread/realtime, then the whole intelligence pipeline
    (classification, U2 assignment, order bot, U3 autopilot).
  - Outbound: `deliverText` dispatches through
    `ChannelSendService`; a send counts only with Telegram's
    `message_id`.
- **Email lane (fully real)** — `EmailChannelService`
  (imapflow + mailparser + nodemailer):
  - Connect verifies a real IMAP login AND a real SMTP handshake
    before saving; failure of either refuses the connection.
  - Sync (scheduler job `email_sync` or the manual button) pulls
    UNREAD mail into the inbox as channel "email" conversations
    (one per sender, subject kept on the thread), deduplicated
    by Message-ID, flagged Seen only after storing.
  - Replies go out through the tenant's own SMTP with Re:
    subject + In-Reply-To threading; a send counts only with an
    SMTP messageId.
- **TikTok**: the partner-gated reality, implemented honestly —
  a clearly labeled development adapter whose verify/send refuse
  with the actual reason, plus `GET /inbox/tiktok/status`
  returning the application pack (steps to real access, and the
  TikTok-ads→WhatsApp/Messenger route that works today). The
  tenant UI shows the same steps. Nothing about TikTok is
  presented as working.
- **YouTube comments**: NOT built in this phase — it needs a
  per-channel Google OAuth consent flow (API keys cannot read or
  reply to comments on the owner's channel), which belongs with
  the Google ads OAuth work; the adapter contract is ready for
  it. (Stated plainly rather than shipping a fake lane.)
- Web UI: an "আরও চ্যানেল" card in the inbox — Telegram token
  connect with the bot name + webhook outcome, email IMAP/SMTP
  connect + manual sync, TikTok status with the application
  steps; `email_sync` added to the tenant automation job list.

## Verification
- **API tests: 463 pass (68 suites)** incl. 7 new U4 tests:
  Telegram getMe verification + Telegram's own 401 surfacing,
  connect stores decryptable credentials and reports the webhook
  outcome honestly, webhook wrong-secret rejection + one-time
  ingest + non-text ignore, send returns the platform message
  id; email dual verification (SMTP failure saves nothing),
  IMAP sync parsing a real RFC822 message into a threaded
  ingest with flags set; TikTok adapter refusal + pack shape.
- **Live boundary proof on the sandbox** (fresh DB after a VM
  replacement): a bogus Telegram token got Telegram's real
  "Unauthorized" back as a clean 400; a bogus email host failed
  with the real TLS error from the actual IMAP attempt; the
  TikTok status endpoint returned the pack; **zero** telegram/
  email integration rows existed afterwards — failed
  verifications store nothing.

## Not claimed / still open
- No real Telegram bot or mailbox was connected (needs the
  owner's bot token / mailbox — M30-style verification): the
  code paths are unit-proven and proven to the real services'
  auth boundary.
- Email sync covers UNREAD mail only (no historical backfill)
  and one conversation per sender (subject from the first mail).
- Sandbox note: adding the two mail libraries required working
  around an overlay-filesystem chown restriction on pnpm state
  files (group ownership normalized to 0:0 first) — environment
  quirk, recorded here so the next install is not a mystery.
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
