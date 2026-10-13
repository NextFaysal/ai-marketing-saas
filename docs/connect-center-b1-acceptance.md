# Connect Center B1 Acceptance — CC1 + CC2 (2026-10-13)

Package: Connect Center (plan: `Connect-Center-Plan-2026-10-13.md`, owner
approved in full 2026-10-13 14:07 +06, CC1–CC10 incl. Platform Payment +
Wallet). This document covers **Batch B1 only (CC1 + CC2)**.
Worktree: `~/workspace/ai-marketing-saas-cc`, branch `cc-package`,
base `d2e66fc` (ec-phase2 HEAD, EC13+EC15 included). **Local commits
only — NOT pushed** (owner's push rule).

## Commits (on top of d2e66fc)

| Hash | Subject |
|---|---|
| 11c5bd1 | CC2 schema: Integration.isDefault + migration 20261013210000_cc2_multi_account |
| c56c941 | CC1+CC2 api: connections module (overview, set-default, disconnect) + AppModule registration |
| 5b7d8cb | CC2: connectMessaging keyed by (org, provider, externalAccountId) + spec |
| e09366e | CC1 web: Connect Center page, nav entry, integrations banner |
| (this doc) | docs: B1 acceptance |

## CC1 — Connections overview API + Connect Center page

**API** — new module `apps/api/src/connections/` (controller/service/
module, registered in `AppModule`), same guard stack as the
integrations controller (`TenantGuard` + `RolesGuard`,
`@PermissionArea("integrations")`, writes OWNER/ADMIN):

- `GET organizations/:id/connections/overview` aggregates **real rows
  only** — no new source of truth, credential rows are never queried,
  so no secret can appear in the output (spec asserts the serialized
  payload contains no `encryptedData`):
  - `Integration` rows classified by provider as found in the wild:
    messaging = whatsapp/messenger/instagram/telegram/email/webchat;
    social = meta_social/tiktok_social/youtube_social;
    ads = meta/google_ads/tiktok; commerce = woocommerce/shopify;
    courier = steadfast/pathao/redx; anything else → `other`
    (surfaced, never dropped).
  - `SocialAccount` (social), `AdAccount` (ads), `Store` (commerce),
    `MessagingSenderConfig` (senders: one entry each for SMTP and
    SMS when actually configured, status `CONFIGURED`).
  - **Payment**: backed by the real Settings hub-payment fields on
    `BusinessProfile` (bkashNumber / nagadNumber / codAvailable) —
    when any is present, one `manual` entry lists exactly which
    methods exist; otherwise the category is `not_configured` with
    note `payment_manual_not_configured`. No gateway rows are
    invented (tenant gateway = CC9, platform gateway = CC10).
  - **AI/LLM**: there is **no per-org LLM store today**, so the
    category has zero accounts, always. Its status is
    `platform_managed` only when the operator's platform LLM config
    really exists in the platform-config snapshot, else
    `not_configured`. Per-org own-key arrives in CC8.
  - Per account: id, source, category, provider, displayName (store
    name resolved for store-linked integrations), externalAccountId,
    status, lastSyncAt, lastError, tokenExpiresAt, `expiringSoon`,
    `isDefault`, deepLink to the existing manage page, and a
    **health derived from stored fields only** (`deriveHealth`):
    non-connected status → `disconnected`; stored lastError →
    `error`; expired token → `error`; token expiring ≤7 days →
    `expiring`; connected with nothing wrong → `ok`; no status →
    `unknown`. Ad accounts prefer the AD3 platform-reported bucket
    (active → ok, disabled/restricted → error); an ACTIVE ad account
    never checked on the platform is honestly `unknown`, not `ok`.
  - Response also carries a summary (total / connected / error
    counts + per-category connected/total).

**Web** — new page `apps/web/src/app/dashboard/connections/page.tsx`
(Bengali UI, existing dashboard styling): summary strip, search/
filter (name/provider/external id/status, logic in
`apps/web/src/lib/connections.ts` with vitest coverage), category
sections with account cards (health pill, default badge, last sync,
token expiry, stored error text), Connect/Manage buttons
deep-linking to the **existing** flows (integrations, inbox, social
posts, ad accounts, messaging, settings#hub-payment). Sidebar nav
entry "🔗 কানেক্ট সেন্টার" (Settings group in the dashboard
layout). `/dashboard/integrations` gained a banner linking here;
nothing on that page was removed or changed functionally.

## CC2 — Multi-account hardening

- **`InboxService.connectMessaging` re-keyed** by
  `(organizationId, provider, externalAccountId)`. Inspection found
  it previously did a blind `integration.create` on every call:
  a second account already coexisted, but reconnecting the SAME
  account piled up duplicate rows. Now: a second WhatsApp number /
  Page (different external id) gets its own row and coexists;
  reconnecting the same account refreshes that row (status back to
  CONNECTED, lastError cleared) and replaces its sealed credential
  in place (update, falling back to create when no credential row
  exists). Audit action unchanged (`integration.messaging.connected`)
  with `metadata.reconnected` added. **No existing spec needed
  adaptation** — the full suite, incl. MS6's connect spec, passes
  unchanged.
- **Default selection**: `Integration.isDefault` (schema + migration
  `20261013210000_cc2_multi_account`, additive
  `BOOLEAN NOT NULL DEFAULT false`). New endpoint
  `PATCH organizations/:id/connections/:integrationId/default`
  (OWNER/ADMIN) sets the flag on the target and clears it on
  sibling rows **of the same org + category group** (e.g. setting a
  default WhatsApp clears a previous default Messenger — both are
  the "messaging" group; a courier default is untouched). Audit:
  `integration.default_set` with provider/category/cleared ids.
  Exposed in the overview and the page (⭐ ডিফল্ট badge + "ডিফল্ট
  করুন" button).
- **Per-account disconnect**: an integrations disconnect path already
  existed (`IntegrationsService.disconnect`, credential delete +
  status flip). The connections module adds
  `POST organizations/:id/connections/:integrationId/disconnect`
  with the same end state, scoped strictly to the target row —
  spec-proven: disconnecting one WhatsApp number leaves the other
  CONNECTED **with its credential intact**, and the disconnected
  row's default flag is cleared. Audit: `integration.disconnect`
  with `metadata.via = "connections"`.
- **Courier note**: `CourierService.saveIntegration` already
  replaces per (org, provider) — multiple couriers coexist by
  provider today, and the overview lists each. Multiple accounts
  of the **same** courier are out of scope for B1 (noted, not
  built); the courier client lookup (`findFirst` by provider) is
  single-account by design until a later batch changes it.

## Gates (all run on this worktree, 2026-10-13)

| Gate | Result |
|---|---|
| API jest (full) | **278/278 suites, 2704/2704 tests PASS** |
| Web vitest (full) | **33 files, 213/213 tests PASS** (209 base + 4 new) |
| API tsc `--noEmit` | **0 errors** |
| Web tsc `--noEmit` | **0 errors** |
| Prisma validate | **valid** |
| Migration sequence | **132/132 applied cleanly** to a fresh Postgres 16 (`prisma migrate deploy`, incl. the new CC2 migration last); `Integration.isDefault` verified boolean / NOT NULL / default false |
| Web `next build` | **green**; `/dashboard/connections` route present in build output |

New specs: `apps/api/src/connections/connections.service.spec.ts`
(overview aggregation + health + empty-org honesty + setDefault
scoping + single-row disconnect + AI platform-managed honesty),
`apps/api/src/inbox/cc2-multi-account.spec.ts` (second WhatsApp
coexists; same-number reconnect refreshes in place; channel
separation), `apps/web/src/lib/connections.test.ts` (4 tests).

One infrastructure note: the first full-jest attempt aborted with a
V8 OOM while a `next build` ran concurrently on this 2-core/8 GB
sandbox; re-run **solo** it passes completely (278/278). Not a code
failure.

## Honest limits — NOT done in B1

- **Connect forms still live on the existing pages.** The Connect
  Center links to them; embedding the actual connect flows here is
  B3 (CC5–CC7) and the own-app/platform-app choice is B2 (CC3/CC4).
- **Health is derived from stored fields, not live pings.** A row
  can read `ok` while the provider-side token died minutes ago —
  the stored lastError/tokenExpiresAt are all this batch consults.
- **Default/disconnect buttons on the page act only on
  Integration-backed accounts.** SocialAccount / AdAccount / Store /
  sender / payment entries are managed on their own pages (their
  rows have no isDefault and their own disconnect semantics).
- **Telegram / Email channel connects** (`TelegramService.connect`,
  email channel service) still create a fresh row per call like
  connectMessaging used to — multiple bots/inboxes coexist, but
  reconnecting the same bot can duplicate; keying them the same
  way belongs with CC7 in B3.
- **No live-provider proof.** Everything above is unit/fake-Prisma
  + build proven. No real Meta/WhatsApp/Woo/courier account was
  connected through the new page; M30 live verification is still
  owed, and migration `20261013210000_cc2_multi_account` has **not**
  run on any real DB (deploy: migrate deploy + Dokploy Redeploy,
  on the owner's instruction only).
- No GitHub push (standing rule).
