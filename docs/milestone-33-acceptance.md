# Milestone 33 Acceptance — Dynamic Platform Configuration

Date: 2026-10-10. Owner direction: "এই SaaS প্রোডাক্ট যত পারা যায়
dynamic করতে হবে" — the operator configures platform-level
integrations from the Admin Console; tenants keep configuring
their OWN accounts (WooCommerce stores, courier credentials, ad
accounts, channel tokens) in their own dashboards, unchanged.
No schema change (the M26 SystemSetting store carries the new
keys). API tests: 340 pass (8 new in
`apps/api/src/admin/phase-m33.spec.ts`).

## What became dynamic (Admin Console → Settings → Dynamic Platform Config)
Stored in SystemSetting (`llmConfig`, `metaAppConfig`,
`smtpConfig`, `smsConfig`); secrets AES-256-GCM sealed, NEVER
returned by any API (safe view = source + non-secret fields +
`secretConfigured` booleans). Resolution order everywhere:
**admin setting → env → default**. A process snapshot
(`common/platform-config.ts`) is loaded at boot, refreshed on
every admin write and on the 60s scheduler tick, so edits take
effect with NO restart.

1. **LLM** — provider/model/API key. `LlmFactory` reads the
   effective config and rebuilds its provider instance when the
   config fingerprint changes. A **Test** button performs a REAL
   minimal completion; the dev adapter is reported as "no real
   LLM", never as a pass.
2. **Platform Meta App** — App ID, App Secret, Ad Library token,
   Graph version. Consumers: Ad Library token resolution
   (platform → env → org integration token), the Graph version
   override in the shared Graph helpers AND both Meta clients
   (messaging + publishing), and the messaging app-secret
   fallback below.
3. **SMTP** — host/port/user/pass/from; `EmailProvider` rebuilds
   its transport when the config changes. Test button sends a
   real email and returns the SMTP message id.
4. **SMS (SSL Wireless)** — sender id/API token/API URL;
   `SmsProvider` reads the effective config per send. Test button
   sends a real SMS (gateway SUCCESS only).

## Tenant-side change (one, deliberate)
Messaging connect: the per-tenant **App Secret is now optional**.
A tenant connecting under the operator's platform Meta app omits
it; webhook signature verification then falls back to the
platform secret (the integration's own secret always wins).
With NEITHER available, connecting is refused with an explanatory
400 — an unverifiable webhook is never stored. The tenant inbox
form labels the field accordingly.

## Stays in env, by design (documented in the UI)
DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, ports, ADMIN_IP_ALLOWLIST
— boot secrets. ENCRYPTION_KEY decrypts everything stored above,
so it cannot itself live in the database.

## Real bug found by the live run (fixed in this milestone)
`InboxService.connectMessaging` let `MetaMessagingClient.verifyToken`'s
plain Error escape as a bare **500**. It now returns a clean 400
with Meta's own message. Proven live before/after (below).

## Live evidence (sandbox, 2026-10-10)
- PATCH platform-config without TOTP → 403 (the M28 SUPER gate
  covers the new mutations automatically). After TOTP enrolment
  the same PATCH → 200.
- LLM set to OpenAI with a deliberately bad key: GET
  platform-config shows `source: admin, secretConfigured: true`
  and the key string appears NOWHERE in the payload.
- Test-LLM: engaged the real provider path and reported honestly
  (30s timeout — see limits). Tenant AI chat with the bad key
  configured produced NO dev-template answer (it hung on the real
  provider call); after clearing the admin config (`source: none`)
  the same chat answered instantly via the labeled dev adapter.
  The swap works live, in both directions, without a restart.
- Meta fallback: with no platform secret, connecting WhatsApp
  without an appSecret → 400 "An app secret is required…". After
  the admin set a platform secret, the same request passed the
  gate and reached Meta, which judged the (fake) token itself:
  400 "Meta token verification failed (400): Invalid OAuth access
  token - Cannot parse access token" — after the 500→400 fix.
- SMTP test with an admin-set host: a real send was attempted and
  failed honestly with the gateway/proxy response verbatim (see
  limits). All test configs were cleared afterwards; every area
  reports `source: none` on the demo again.
- Demo state note: the demo owner has TOTP enrolled again (from
  this verification); the enrolled secret for the sandbox is kept
  at /tmp/totp-secret.txt, and the CLI break-glass resets it
  (docs/admin-first-login-and-totp-recovery.md).

## Honest limits
- The sandbox egress cannot reach api.openai.com at all (direct
  curl: connection timeout) and blocks SMTP ports (the proxy
  answers "Outgoing email (SMTP) is turned off"). So a SUCCESSFUL
  real LLM completion and a delivered test email could not be
  demonstrated from this sandbox — what is proven is the full
  dynamic wiring (config → snapshot → provider → real attempt →
  verbatim failure surface) plus the unit-tested success paths
  (stubbed provider responses). On any normal network (the
  owner's VPS), Session 5 of the M30 sprint closes both with the
  owner's real key — now enterable in the Admin Console instead
  of env files.
- Per-org Meta Ads tokens, WooCommerce keys and courier
  credentials remain tenant-entered by design (the owner's model:
  tenants hold their own platform accounts; the operator holds
  the platform app, the AI key, and the sending infrastructure).
