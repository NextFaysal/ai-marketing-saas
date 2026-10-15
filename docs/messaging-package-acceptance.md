# Messaging Power Package (MS1–MS10) — Final Acceptance

The Messaging Power package is **complete**: all ten items (MS1–MS10) are
built, spec-proven and gated on branch `ms-package`
(worktree `~/workspace/ai-marketing-saas-ms`, base master `5b73021`).
**Local commits only — nothing has been pushed.** Integration into master
and any push are separate, owner-triggered steps (see Integration notes).

## MS1–MS10 status

| Item | What shipped | Batch acceptance |
|---|---|---|
| MS1 Async send engine + scheduling | Snapshot-based chunked engine, pause/resume/cancel/retry, schedule + sweep recovery | [messaging-b1-acceptance.md](messaging-b1-acceptance.md) |
| MS2 Consent / opt-out / suppression | MessagePreference + MessagingSetting, frequency cap, unsubscribe tokens, STOP/START hook | [messaging-b1-acceptance.md](messaging-b1-acceptance.md) |
| MS3 Audience builder v2 | Shared resolver for all audience types, saved + CSV audiences, order aggregates | [messaging-b2-acceptance.md](messaging-b2-acceptance.md) |
| MS4 Per-tenant senders & providers | Sealed per-org SMTP/SMS config, verify-before-save, domain health, honest cost estimates | [messaging-b2-acceptance.md](messaging-b2-acceptance.md) |
| MS5 Composer v2 | Real per-recipient vars, HTML email, link tracking + open pixel groundwork, test sends | [messaging-b3-acceptance.md](messaging-b3-acceptance.md) |
| MS6 WhatsApp template hub | WABA ID, Meta sync/submit, rich template sends, honest NOT_ON_META | [messaging-b3-acceptance.md](messaging-b3-acceptance.md) |
| MS7 Delivery lifecycle + analytics | Webhook lifecycle, per-broadcast report, deliveries pagination + CSV export | [messaging-b4-acceptance.md](messaging-b4-acceptance.md) |
| MS8 Messaging ↔ Automation bridge | Recurring broadcasts, journey presets through the real WorkflowsService | [messaging-b4-acceptance.md](messaging-b4-acceptance.md) |
| MS9 AI for messaging | AI copy/subject drafts (returned only), deterministic send-time + segment suggestions | [messaging-b5-acceptance.md](messaging-b5-acceptance.md) |
| MS10 Management polish | Broadcast edit/clone/delete/archive, paged + searchable lists, template management UI | [messaging-b5-acceptance.md](messaging-b5-acceptance.md) |

## Final gate (package level, B5)

- API jest: **224 suites / 2132 tests — two consecutive full runs, both
  fully green** (package start baseline was 1915/214 at master `5b73021`;
  B5 alone added 41 tests: MS9 18 + MS10 23).
- API tsc clean · Web vitest 148/148 · Web tsc clean · Next build green ·
  Prisma validate valid.
- The known pre-existing `cx3-debounce` timing flake appeared once in an
  intermediate neighbouring-suites run during B5 (standalone 18/18 green;
  both full gate runs green). Its root cause remains open and is NOT a
  messaging defect.

## Deploy checklist (in order)

1. **Run all NINE migrations** (none has been run on any real DB):
   1. `20261013100000_ms1_broadcast_engine`
   2. `20261013110000_ms2_messaging_preferences`
   3. `20261013120000_ms3_saved_audiences`
   4. `20261013130000_ms4_sender_config`
   5. `20261013140000_ms5_composer`
   6. `20261013150000_ms6_whatsapp_templates`
   7. `20261013160000_ms7_delivery_lifecycle`
   8. `20261013170000_ms8_recurring_journeys`
   9. `20261013180000_ms10_broadcast_archive`
2. **Prisma generate** after the migrations.
3. **Enable the per-org `broadcast_send_sweep` automation job** for each org
   that should send scheduled/recurring broadcasts and recover stale
   "sending" rows automatically (manual sends work without it).
4. **Set `WEB_URL` and `API_PUBLIC_URL`** correctly in production — the
   unsubscribe page link (WEB_URL), the tracked-link redirect and the open
   pixel (API_PUBLIC_URL) are built from them; unset values fall back to
   localhost and those links will not work for recipients.
5. **Enter the WABA ID** per org (Messaging page → WhatsApp Templates) —
   Meta template sync/submit refuse honestly without it.
6. **Manual Dokploy Redeploy** after the (owner-triggered) push, as usual.

## Integration notes

- `ms-package` is based on master `5b73021`. Master has since gained AP7c–e
  and other work — **integration is a separate careful pass, NOT part of
  this package**, and no push is authorized by this document.
- Migration series `2026101310xxxx`–`20261013180000` does **not** collide
  with EC's `2026101300xxxx`–`050000` series or AP7's `20261013000000`.
- The package touched the messaging module, the inbox webhook status path
  (MS7, best-effort and ChannelMessage-first), the workflows registration
  port (MS8) and the dashboard messaging page — expect the integration pass
  to review those seams against master's newer inbox/AP work.

## Honest NOT-done / limits

- **Messenger broadcast — not built, by policy evidence:** Meta deprecated
  Recurring Notifications (2026-02-10) and the Marketing Messages API needs
  per-user opt-in tokens this system does not collect. No fake opt-ins were
  created. (B3 acceptance has the sources.)
- **SMS delivery reports — unavailable:** SSL Wireless documents no DLR
  query API (send-only docs), so no polling was built; the SMS funnel
  honestly ends at sent/clicked. Tenant-gateway (BulkSMS/Alpha) DLR is
  likewise out of scope. (B4 acceptance has the evidence.)
- **BulkSMS BD adapter is DOC-UNVERIFIED** (the provider's own doc page
  404s; the adapter follows public mirrors and is flagged as such).
- **Email "delivered" does not exist over SMTP** — reports show null for
  that stage rather than a fabricated number; opens come only from the
  HTML pixel and **undercount** in production (mail clients block remote
  images; text-only mail has no pixel by design).
- **Revenue in reports is labelled association, not attribution**
  (recipient customers' orders within 7 days post-send).
- **No live proof anywhere in this package (M30 still owed):** no real
  SMTP/SMS/Meta/LLM account has exercised any of MS1–MS10. Everything is
  proven against fake-prisma/fake-fetch specs. WhatsApp delivered/read
  awaits real Meta webhooks; Meta template sync/submit awaits a real WABA;
  AI drafts await a real LLM key (until then the labelled dev-template path
  is what runs); recurrence is fixture-time-proven, not live-scheduler-proven.
- **Snapshot scale note:** `Broadcast.recipientSnapshot` is one Json column
  bounded by the per-send plan cap (max 5000 recipients) — a deliberate,
  documented trade-off from MS1, unchanged by this package.
- **cx3-debounce flake root cause remains open** (pre-existing; see above).
