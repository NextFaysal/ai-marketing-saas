# Connect Center B2 Acceptance — CC3 + CC4 (2026-10-13)

Package: Connect Center (plan: `Connect-Center-Plan-2026-10-13.md`,
owner approved in full 2026-10-13 14:07 +06, CC1–CC10). This
document covers **Batch B2 only (CC3 + CC4)** — the two app paths:
a tenant connects through the **platform's** app (the pre-B2
behaviour, still the default everywhere) or through **their own**
developer app. Worktree: `~/workspace/ai-marketing-saas-cc`,
branch `cc-package`, on top of B1 HEAD `1918fa5`. **Local commits
only — NOT pushed** (owner's push rule).

## Commits (on top of 1918fa5)

| Hash | Subject |
|---|---|
| d095e92 | CC3 schema: TenantAppConfig + Integration.appSource + SocialAccount.appSource; migration 20261013220000_cc3_tenant_app_config |
| f06498e | CC3 api: app-config endpoints (Meta verify-before-save, TikTok honest "configured"), sealed secrets, overview appSource + ownAppConfigMissing, shared resolver + specs |
| 342ee09 | CC4 api (messaging): connectMessaging appSource — own requires the CC3 Meta config, tenant secret sealed into the credential; default flow unchanged + spec |
| 0ca1dfe | CC4 api (social): TikTok OAuth appSource — state-bound choice, same-app callback exchange, appSource on account + integration, own-app token refresh + spec (SP8/SP9 green) |
| 327020f | CC3+CC4 web: Connect Center "নিজের অ্যাপ" section + app-source connect entry points + badges; inbox form app-source select |
| (this doc) | docs: B2 acceptance |

## CC3 — Tenant's OWN app configs

**Model** — `TenantAppConfig` (schema + migration
`20261013220000_cc3_tenant_app_config`, #133 in the sequence):
`organizationId`, `platform` ("meta" | "tiktok"), `appId` (Meta
app id / TikTok client key), `encryptedSecret` (the `{ appSecret }`
payload sealed with the existing AES-256-GCM `encryptJson`, the
MessagingSenderConfig/IntegrationCredential pattern), `status`,
`lastVerifiedAt`, `lastError`, timestamps;
`@@unique([organizationId, platform])`, FK to Organization
(CASCADE). The same migration adds
`Integration.appSource String @default("platform")` and
`SocialAccount.appSource String @default("platform")` — every
pre-CC3 row reads "platform", which is exactly how those
connections were made. Verified live in the gate: table, unique
index, FK and both column defaults present in a fresh Postgres.

**API** — in the connections module (same guard stack as B1:
TenantGuard + RolesGuard, PermissionArea "integrations", writes
OWNER/ADMIN):

- `PUT organizations/:id/connections/app-configs/:platform` —
  verify-before-save:
  - **Meta**: a REAL Graph API call first — new injectable
    `MetaAppClient.verifyApp()` does
    `GET /{graphVersion}/{appId}` with the app access token
    (`appId|appSecret`); Meta returns the app node only when both
    halves are correct. Success → saved with status **"verified"**
    + `lastVerifiedAt`. Failure → **nothing is saved** and Meta's
    own error message is the 400's message. Production path is
    the real call; specs stub the client (codebase pattern).
  - **TikTok**: saved with status **"configured"**, honestly
    unverified (decision + evidence below).
  - Re-saving replaces the single (org, platform) row in place.
  - Audited (`tenant_app_config.saved`, platform + status only —
    never the secret).
- `GET organizations/:id/connections/app-configs` — appId,
  platform, status, lastVerifiedAt, lastError, and a
  `verificationNote` per row. **The secret is never read here, so
  it can never be returned** (spec asserts the serialized views,
  the audit log and the list contain neither plaintext nor
  ciphertext).
- `DELETE organizations/:id/connections/app-configs/:platform` —
  removes the config (audited). Connections made with it keep
  their stored tokens and keep working; the overview flags them
  (below).

**TikTok verification decision (with code evidence).** TikTok
offers NO credential-check endpoint usable without a user
authorization code. The existing TikTok client
(`apps/api/src/social/tiktok.client.ts`) confirms the surface:
its only token-endpoint operations are
`exchangeCode` (requires an OAuth `code`) and
`refreshAccessToken` (requires a user's `refresh_token`); every
other endpoint needs a creator access token. A bare
(clientKey, clientSecret) pair cannot be validated against any of
them — inventing a "verified" state would be fabrication. So a
TikTok config saves as **"configured"** with
`verificationNote: "verified_at_first_connect"`: the first OAuth
connect IS its verification (the code exchange succeeds or fails
with TikTok's own error). The spec pins this by arming the
verifier stub to throw if anything even attempts to verify a
TikTok save. Meta, which DOES have the app-token lookup, is
verified before save and marked "verified" — the two statuses
are deliberately different words for different truths.

**Overview exposure** — every Integration and SocialAccount entry
in the B1 overview now carries `appSource` ("platform" | "own")
and `ownAppConfigMissing` (true when an own-source connection's
TenantAppConfig has been deleted — its stored tokens still work,
but verification/refresh can no longer resolve the own-app
secret). The web account cards show the badge
(প্ল্যাটফর্ম অ্যাপ / নিজের অ্যাপ) and, for the missing case, an
amber explanation. AdAccount/Store/sender entries carry no
appSource — those rows have no own-app path.

**Shared reader** — `connections/tenant-app-config.ts`
exports `resolveTenantAppConfig(prisma, orgId, platform)`:
finds the row, decrypts, returns `{ appId, appSecret, status }`
or null (missing table/row/decrypt failure all read as null,
platform-config precedent). Both CC4 flows consume it.

## CC4 — App-source aware connect flows

**Messaging (WhatsApp / Messenger / Instagram)** —
`InboxService.connectMessaging` accepts `appSource`
(DTO: `@IsIn(["platform","own"])`, optional):

- `appSource: "own"` requires a saved Meta TenantAppConfig;
  absent → a clear Bengali 400 ("নিজের Meta অ্যাপ কনফিগার করা
  নেই — আগে কানেক্ট সেন্টারে…") and **no row is created** — it
  never silently downgrades to the platform app.
- Secret resolution order (preserved/extended exactly as
  specified): explicit per-call `appSecret` → tenant app config
  (when own) → platform config check (the pre-CC4 refusal when
  none exists is unchanged). The winning secret is sealed into
  the IntegrationCredential as before — which means webhook
  signature verification (existing code prefers the stored
  secret via `resolveMessagingAppSecret`) verifies own-app
  connections against the tenant's app secret with no webhook
  code change.
- The Integration row (create AND reconnect-update), the return
  value, `listMessagingIntegrations` and the audit metadata all
  carry `appSource`. Default (absent) = "platform"; the CC2 and
  MS6 suites pass unchanged.

**TikTok OAuth (social)** — `SocialOAuthService.tiktokConnectUrl`
takes `appSource` (controller: `GET …/social/accounts/tiktok/
connect-url?appSource=own`):

- "own" resolves the tenant's TikTok config (absent → the honest
  Bengali 400 `OWN_TIKTOK_NOT_CONFIGURED_MSG`, no state minted),
  builds the authorize URL with the **tenant client key**, and
  binds `{ appSource: "own" }` into the `SocialOAuthState`
  payload. Scopes are `user.info.basic,video.upload` — the
  tenant app's audit state is not ours to declare, so
  `video.publish` is not requested for own apps.
- The callback reads the source back from the consumed state's
  payload and exchanges the code with the **same** app
  (`tiktokCredsFor`); a config deleted mid-flow yields an honest
  `social_error` redirect and no account.
- `appSource` is recorded on **both** the resulting SocialAccount
  and its Integration (the task allowed either; both are written
  because token refresh keys off the account while the Connect
  Center overview reads both tables — one truth, two readers).
- **Token refresh follows the source**: `ensureAccessToken` for
  an own-app TikTok account refreshes with the tenant app's
  credentials (the platform secret would be rejected for that
  grant); a deleted own config is terminal with an actionable
  Bengali message, mirroring the removed-platform-config case.
- Platform default is unchanged (SP8/SP9 specs pass as-is);
  `serializeAccount` now also exposes `appSource`.

**YouTube / Google — platform-only, deliberately.** CC3 built
own-app configs for meta + tiktok only (the plan's scope); there
is no Google TenantAppConfig to connect YouTube through, so the
YouTube OAuth flow is untouched and no own-app claim is made for
it anywhere in the UI. Likewise there is no Meta *OAuth redirect*
flow in this codebase to parameterize — Meta Page social connect
is the SP1 token-paste flow, and the Meta app-source story is the
CC3 verified config + the messaging path above.

**Web** — Connect Center page gains the **"🛠️ নিজের অ্যাপ"**
section:

- Two config cards (Meta / TikTok) showing current App ID +
  honest status (যাচাইকৃত vs "কনফিগার করা হয়েছে — যাচাই প্রথম
  কানেক্টে হবে"), with verify-before-save forms whose error
  surface is the API's real message, and delete with the
  keep-your-tokens warning. The TikTok card prints the exact
  callback URL the tenant must register in their own app
  (`{api}/social/oauth/tiktok/callback`).
- App-source connect entry points: WhatsApp/Messenger/Instagram
  via our app → Inbox; via own app → Inbox with
  `?appSource=own` when a Meta config exists, else an anchor to
  the Meta form. TikTok via either app starts the real OAuth
  from here (connect-url + browser redirect); without an own
  config it routes to the TikTok form instead.
- The Inbox connect form gains the matching select ("কোন অ্যাপ
  দিয়ে কানেক্ট?"), preselected from the `?appSource=own`
  deep-link; choosing own shows that the secret comes from the
  Connect Center config, not the form. Existing deep-links and
  the Social Posts page flows are untouched (TikTok there stays
  platform-default).

## Gates (all run on this worktree, 2026-10-13)

| Gate | Result |
|---|---|
| API jest (full) | **281 suites / 2722 tests: 2721 PASS** — the single failure is the **pre-existing cx3-debounce flake** (see note) |
| Web vitest (full) | **33 files, 215/215 tests PASS** (213 B1 + 2 new) |
| API tsc `--noEmit` | **0 errors** |
| Web tsc `--noEmit` | **0 errors** |
| Prisma validate | **valid** |
| Migration sequence | **133/133 applied cleanly** to a fresh Postgres 16 (`prisma migrate deploy`, CC3 last); `TenantAppConfig` table + unique index + FK and `Integration.appSource` / `SocialAccount.appSource` (TEXT, NOT NULL, DEFAULT 'platform') verified via information_schema |
| Web `next build` | **green**; `/dashboard/connections` route present |

New specs: `apps/api/src/connections/cc3-app-config.spec.ts`
(Meta verify success/failure + sealed-at-rest + secret-never-
returned + upsert + TikTok configured-honesty + delete→overview
flag), `apps/api/src/inbox/cc4-app-source.spec.ts` (own without
config → 400/no row; own with config → tenant secret sealed, row
marked; per-call secret wins; default unchanged; bogus source
refused), `apps/api/src/social/cc4-tiktok-own-app.spec.ts`
(tenant key in authorize URL + state binding; callback exchanges
with tenant creds; account + integration land "own"; mid-flow
config deletion → honest error; own-app refresh uses tenant
creds; platform default unchanged), plus 2 web tests for the
app-source helpers.

**Gate infrastructure notes (honest).** (1) The first two full
API-jest attempts died with a V8 heap abort in the jest MAIN
process at Node's default ~2 GB heap (233 suites reported, zero
failures, before the abort) — the suite has outgrown the default
heap on this 2-core/8 GB sandbox; the gate was therefore run
with `NODE_OPTIONS=--max-old-space-size=4096`, under which it
completes in ~90 s. (2) The one failing test across three full
runs is `inbox/cx3-debounce.spec.ts` → "draft mode defers too:
the draft is composed at fire time". This is the flake already
documented as an open item since the CX package
(MEMORY: "the cx3-debounce flake root-cause" still open): on
identical B2 code it failed once and passed three times in solo
runs (18/18), and the B2 diff contains **zero** changes to the
debounce/auto-reply code paths (connectMessaging +
listMessagingIntegrations only — verified by diff grep). A
counterfactual full run on the unmodified B1 base (1918fa5)
passed 278/278 in the same session, so the flake is
load/timing-sensitive rather than a B2 regression; it is NOT
fixed here — root-causing it remains the standing CX open item.
(3) This sandbox had no Postgres binaries (a shared-VM apt lock
from parallel work made apt unusable), so the migration gate ran
against standalone Postgres 16.4 binaries fetched to /tmp for
this check only; the cluster was throwaway and is gone.

## Honest limits — NOT done in B2

- **No live-provider proof.** Meta verification, TikTok OAuth
  start/callback/refresh are proven at the injectable-client /
  stubbed-fetch boundary in the codebase's established spec
  style. No real tenant Meta app or TikTok app was connected;
  M30 live verification is still owed. Migration
  `20261013220000_cc3_tenant_app_config` has **not** run on any
  real DB (deploy: migrate deploy + Dokploy Redeploy, on the
  owner's instruction only).
- **Own-app TikTok publishing mode.** Connect requests
  upload-only scopes for own apps, but the publish path's
  `audited` decision still reads the PLATFORM app's flag. An
  audited tenant app therefore does not unlock direct-post for
  its own accounts, and (conversely) inbox-mode remains the safe
  default — no false publish claim is possible, but per-app
  audited support is future work.
- **Meta app secret rotation.** Webhook verification for
  appSource "own" relies on the secret sealed at connect time.
  If a tenant rotates the secret in Meta's console, the Connect
  Center config must be updated AND the channel reconnected
  (the reconnect re-seals the config's current secret) — there
  is no webhook-time TenantAppConfig lookup.
- **Meta social/ads token connects carry no appSource choice** —
  they resolve no app secret at all today (SP1 token paste), so
  there was nothing truthful to parameterize; their accounts
  read appSource "platform" by schema default.
- **`getPlatformModes` (social) unchanged** — it reports
  platform-app configuration booleans only; own-app presence is
  reported by the new app-configs endpoint instead.
- No GitHub push (standing rule).
