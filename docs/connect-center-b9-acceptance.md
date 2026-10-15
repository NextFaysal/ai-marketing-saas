# Connect Center Advanced — Batch B9 Acceptance (CC20) — FINAL BATCH

Branch `cc-advanced`, worktree `~/workspace/ai-marketing-saas-adv`, base B8 HEAD `9e3510f`.
6 local commits — **no push** (owner's standing rule). Migrations **not run on any real DB**.
With this batch the Connect Center Advanced package (CC11–CC20) is **code-complete**;
see `docs/connect-center-advanced-summary.md` for the whole-package status + deploy checklist.

Commits: `3cd5d85` schema · `24bc638` linkedinAppConfig admin · `0127f90` API core
(Google pack + assistant + Doctor) · `15286cc` LinkedIn · `d9cab12` specs · `c76f943` web+admin UI.

## What was built

### 1. TikTok Shop + Daraz — conditional items CLOSED by evidence (NO-BUILD)
No shop connections were built for either, per the recorded verdicts
(`docs/ec14-marketplace-research.md`, EC program): **TikTok Shop** — Bangladesh is
"Not listed" as a local seller market, so no BD TikTok Shop exists to connect;
**Daraz** — the public Lazada Open Platform covers only my/sg/th/ph/vn/id and no
public Daraz BD seller API/onboarding exists; labeling a Lazada integration "Daraz"
would be a false claim. The Connect Center now shows an honest **মার্কেটপ্লেস** section
(`MARKETPLACE_NOTES` in `apps/web/src/lib/connections.ts`, pinned by web lib tests)
with, per marketplace: the verdict, what the research found, why no connect button
exists, and exactly what would change the verdict (official TikTok Shop BD seller
launch / a paying tenant with a supported-market shop; written Daraz BD confirmation
of third-party API access / an official public BD developer portal). No fake account
rows were created anywhere — the notes are a separate, clearly-labeled section.

### 2. Smart Setup Assistant (`connections/setup-assistant.service.ts`)
`GET organizations/:orgId/connections/assistant` computes findings from **real rows
only**, on every read; `POST …/assistant/dismiss` stores one row per
(org, user, findingKey) in the new `SetupFindingDismissal` model (migration
`20261013350000_cc20_assistant`) — the ONLY persisted assistant state. Connection
state is read from the CC1 overview (not re-derived); gateways/enablements/profile/
LLM rows and template/shipment counts are read directly. Rules (each spec-pinned
firing AND not firing):
1. **whatsapp_no_approved_template** (blocker) — WhatsApp CONNECTED but zero
   `WhatsAppTemplate` rows with Meta-verbatim status `APPROVED` (total count in evidence).
2. **meta_page_without_messaging:<pageId>** (blocker) + **messaging_page_without_social:<pageId>**
   (improvement) — matched on REAL external ids: `SocialAccount(meta_page).externalId`
   vs `Integration(messenger|meta_social).externalAccountId`. There is no FK; the join
   is org + external id, exactly as the data model allows.
3. **Ad-account-without-Page rule: OMITTED, deliberately.** `AdAccount` has no
   page/linkage field anywhere in the schema, so there is no real record to check —
   the rule is documented as not implemented rather than approximated.
4. **store_without_courier** (blocker) — store connected, zero CONNECTED courier
   integrations (steadfast/pathao/redx).
5. **store_without_payment_path** (blocker) — store connected and none of: own
   enabled **live** gateway (sandbox sets never count as a production path), platform
   enablement on, manual payment info in `BusinessProfile` (bkashNumber/nagadNumber/codAvailable).
6. **platform_gateway_not_configured:<provider>** (blocker) — tenant enabled a
   platform provider that `WalletService.platformProviders()` says the PLATFORM has
   not configured (only sslcommerz/bkash are ever offered).
7. **bkash_gateway_unverified:<environment>** (improvement) — own bKash row still in
   `configured` status. bKash only: it is the one gateway with a real pre-save
   verification (grant token), so a persisted `configured` bKash row was never
   verified; SSLCommerz/Nagad honestly stay `configured` and never fire this rule.
8. **courier_never_used** (improvement) — courier connected, `CourierShipment` count 0.
9. **llm_platform_fallback** (info, lowest) — no enabled own `OrgLlmConfig` while
   the overview's AI category reports the platform-managed state.

Each finding carries severity (blocker | improvement | info), the feature it
blocks, evidence text with the real counts/ids, and a fix link (in-page category
anchors `#cat-…` — the page's category sections now carry those ids — or the owning
page). Severity order is blockers → improvements → info. Web panel
(`setup-assistant-panel.tsx`) sits at the top of the Connect Center; the empty
state is **"সব ঠিক আছে"**; dismiss is per user (another member's dismissal never
hides a finding from you) and an unknown finding key is refused server-side.

### 3. Google pack — GA4 + Merchant Center + Business Profile (platform app ONLY)
- New `GoogleConnectService` in the connections module (results are Integration
  rows; putting it in social/ would cycle the modules) + `GoogleClient`
  (`connections/google.client.ts`). Flows reuse the operator's existing
  `googleAppConfig` (the YouTube app) — **no own-Google-app path exists**, and the
  UI states platform-app only in words.
- Discovery: GA4 via Analytics Admin API `accountSummaries` (property id stored);
  Merchant via **Merchant API v1** accounts (NOT the retiring Content API — EC14
  spike §3); Business Profile via account-management accounts → business-information
  locations (location resource stored).
- SP9 discipline throughout: `SocialOAuthState` rows bound to (org, user, provider,
  purpose), 10-minute expiry, atomic single-use consume; >1 accounts → pick state
  with SEALED credential payload; select re-checks the id against the offered list;
  **zero accounts → honest error, NOTHING stored**; **no refresh token → refused,
  nothing stored**. Redirect URIs are the derived per-flow callbacks
  (`/social/oauth/google-ga4|google-merchant|google-business/callback`, public
  `GoogleOAuthCallbackController`), never the YouTube-configured URI — Google
  requires an exact per-flow match; the operator registers the three URLs on the
  same app (the admin Google card now says so).
- Tokens sealed in `IntegrationCredential.encryptedData`; refresh via
  `GoogleConnectService.freshAccessToken` (rotation persisted). Supersede: a live
  row for the same provider+external id is replaced on re-connect.
- Overview: `google_analytics` → new **analytics** category (📊, deep link
  `/dashboard/analytics`), `google_merchant` → commerce, `google_business` →
  social; provider labels added. Doctor: the three kinds get a REAL check — one
  authenticated list call with a fresh token (count + first names), via an optional
  `GoogleConnectService` injection; missing credential → the standard fail step.

### 4. LinkedIn Page (platform app ONLY)
- New platform config key **`linkedinAppConfig`** (M33 pattern, full stack):
  platform-config snapshot/resolver + env fallback (`LINKEDIN_CLIENT_ID/SECRET/
  REDIRECT_URI`), admin safe view, `PATCH platform-config/linkedin`,
  `POST platform-config/test-linkedin` (client-auth probe — a bogus refresh-token
  grant: `invalid_client` = bad creds, any token-level refusal = client accepted;
  the detail states plainly it proves neither redirect registration nor Community
  Management API approval), env-check area list extended (aa1 spec updated), and an
  admin settings card mirroring Google's.
- `LinkedInClient` (`social/linkedin.client.ts`): authorize →
  `POST /oauth/v2/accessToken` → admin'd organizations via
  `/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR` + `/v2/organizations/{id}`
  → pick. Zero orgs → honest error, nothing stored; >1 → `org_pick` state (SP9
  shape). Stored as `SocialAccount` platform **`linkedin_page`**, provider
  `linkedin_social`, appSource **platform** (no own-app path — stated in UI + here).
  `SOCIAL_ACCOUNT_PLATFORMS` extended; platform-modes now reports linkedin configured.
- Token lifecycle: refresh branch in `ensureAccessToken`. A LinkedIn connection
  WITHOUT a refresh token is accepted (LinkedIn only issues one when the app holds
  the refresh-token product) — at access-token expiry the account is marked with
  the honest reconnect message instead of silently dying.
- Publishing: `linkedin_page` dispatch in `SocialPublishService` BEFORE the
  TikTok/YouTube OAuth path (whose mediaRefs[0] assumption would crash text posts).
  Honest media rule: text posts and link posts (`linkUrl` → ARTICLE share) only;
  any mediaRefs → PermanentPublishError (no native media-upload step exists and
  none is faked). The result stores the post URN **exactly as LinkedIn returns
  it** and `platformUrl: null` (LinkedIn returns no URL); failures propagate
  LinkedIn's message verbatim. Doctor gains a `linkedinOrgs` probe (org count is
  the real signal; zero admins is a reportable result, not a failure).

## Tests (new: 38 API + 3 web)
- `apps/api/src/connections/cc20-b9.spec.ts` — every assistant rule fires/silences
  on fixtures, dismissal scoping (per user), unknown-key refusal, severity order;
  Google connect-url shape, zero/one/many callbacks, no-refresh refusal,
  state single-use + expiry, pick wrong-id/refusal/replay, merchant provider,
  Doctor refresh+count. Google client stubbed.
- `apps/api/src/social/social-cc20-linkedin.spec.ts` — connect URL/scopes,
  unconfigured refusal, zero/one/many org callbacks, pick authority, state
  single-use, refresh re-seal, publish dispatch (text/link/media-refusal/verbatim
  failure), LinkedIn client request shapes against a stub fetch.
- `apps/web/src/lib/connections.test.ts` — severity meta, Google kind list,
  marketplace notes carry verdict + reason + revisit (never a connect offer).
- `cc11-doctor.spec.ts` fixture gained the `linkedinOrgs` probe (interface grew).

## Gates (sequential, this tree)
- **API jest FULL**: 313/314 suites, **3101/3102** — the sole failure was
  `inbox/cx3-debounce.spec.ts:224`, the known intermittent flake; solo re-runs on
  the identical tree went **18/18 and 18/18**, recorded exactly as in B6/B7
  (consistent with the known flake, not proven). All 38 CC20 tests pass.
- **Web vitest FULL**: 259/259. **Admin**: tsc 0, vitest passWithNoTests (exit 0),
  next build green.
- **tsc**: 0 in api, web, admin. **prisma validate**: valid.
- **Fresh-PG migration sequence**: **150/150 applied clean** (PG16, throwaway DB,
  dropped after), 195 public tables — the new migration is
  `20261013350000_cc20_assistant` (150 total = B8's 149 + 1).
- **next build (web)**: green.

## Honest limits
- **Nothing here is live-proven.** No real Google/LinkedIn/Meta account was used:
  every Google/LinkedIn behavior above is proven at stubbed client/fetch
  boundaries only. Live proof is M30 work with the owner's real accounts.
- **LinkedIn live posting needs LinkedIn's Community Management API approval**
  for the platform's app — an external gate this code cannot satisfy or detect;
  until LinkedIn grants it, real publishes will fail with LinkedIn's own message
  (surfaced verbatim). No live publish is claimed.
- Google pack live use needs the operator to (a) register the three derived
  callback URLs on the Google app and (b) enable the Analytics Admin / Merchant /
  Business Profile APIs in Google Cloud — admin-panel text says both.
- LinkedIn refresh tokens exist only if the operator's app holds LinkedIn's
  refresh-token product; without one, connections work until token expiry and
  then ask for a reconnect (by design, stated above).
- The Doctor's Google check counts what the token can see across the whole
  Google account, not just the picked property/account/location.
- Migration `20261013350000` has **not** run on any real DB; nothing in this
  batch has been pushed or deployed.
