# Connect Center Next — B12 Acceptance (CC27 + CC28 + CC29)

Branch `cc-next`, base `71bcc4d` (B11). Local commits only — nothing pushed.

| Commit | Item |
|---|---|
| `f6c213a` | CC27 deny-list completion |
| `4f3ddb3` | CC28 own-app completion |
| `4f30906` | CC29 courier multi-account |
| `eedf4b8` | B12 web surfaces |

New migrations: `20261013380000_cc27_deny_completion` (nullable
`updatedById` on `InboxSetting` + `SocialReplySetting`),
`20261013390000_cc29_courier_multi_account` (nullable
`CourierShipment.integrationId` + index). CC28 needed **no**
migration — `TenantAppConfig.platform` is a plain `String`, so
`google`/`linkedin` are values, not an enum change.

---

## CC27 — Deny-list completion

Every gate uses the existing CC17 semantics
(`Membership.deniedConnections`, OWNER never denied). Every
refusal is Bengali and recorded — in the audit log or in the
path's own native failure record (post error, broadcast entry,
comment metadata) — never a silent drop. Shared helper:
`isMemberConnectionDenied(prisma, orgId, userId, targetId)` in
`apps/api/src/common/permission-catalog.ts` (defensive: any
missing actor/target/membership ⇒ not denied).

### Actor-rule table — GATED paths

| Path | Actor whose deny-list is checked | Target | Refusal record |
|---|---|---|---|
| Scheduled social publish sweep (`SocialPublishService.runDuePublishes`) | The post's **author** (`SocialPost.createdById`), re-checked at publish time | The post's SocialAccount | Post returns to **draft** with a Bengali error on the post + audit `social.post_publish_denied`; counted in the sweep's `blocked` (SP7 pattern) |
| Human comment reply + private reply (`SocialCommentsService.sendReply` / `sendPrivateReply`) | The **acting member** | The comment's channel Integration (resolved via the same lookup the Graph client uses) | `ForbiddenException` (Bengali) before any Graph call |
| Bulk comment action `AI_REPLY_ALL` | The **acting member**, per item | Each comment's channel Integration | Denied items land in the result's `failed[]` with the Bengali reason; allowed items proceed |
| Comment AI auto-reply (due sweep + instant path) | The member recorded in **`SocialReplySetting.updatedById`** (written on every settings save — new in CC27) | The comment's channel Integration | Suppression recorded on the comment (`metadata.graph.denySuppressed`) + audit; comment stays PENDING for a human, claim cleared so it never fires late |
| Inbox autopilot auto-reply (`InboxService.maybeAutoReply`) | `conversation.assignedUserId` if set, else **`InboxSetting.updatedById`** | The conversation's channel account | Existing human-handover path (`escalateAutopilot`) with reason `connection_denied` — visible, recorded |
| Inbox system sends — ALL of them (`InboxService.sendAutomatedMessage`: order bot, tracking share, courier update, return update, order chase, review request, workflow sends) | Same actor chain as above (assignee → configuring member) | The conversation's channel account | Audit `inbox.system_send.suppressed_denied` + `ForbiddenException` at the funnel's entry, before any message row; every caller is failure-isolated, so the surrounding flow continues and the conversation is left for a human |
| WhatsApp template broadcast, scheduled sweep (`MessagingService.processBroadcast`) | The broadcast's **creator** (`Broadcast.createdById`), re-checked at send time | The org's WhatsApp Integration | The sender factory throws before any send; the engine records **every pending entry failed** with the Bengali deny reason |
| WhatsApp broadcast test send | The **tester** (acting member) | The org's WhatsApp Integration | Same failure record on the test entries |
| Manual ad-data syncs (`AdsService.syncMetaInsights`, `syncMetaAdInsights`, `syncMetaBreakdowns`, `syncGoogleInsights`, `syncTikTokInsights`) | The **acting member** | The AdAccount | `ForbiddenException` (Bengali) before any platform call |
| `AdsService.syncAllAccounts` | The **acting member**, per account | Each AdAccount | Denied accounts get per-account status `skipped_denied`; others sync |
| Campaign publish (`CampaignsService.publish`, incl. automation-rule launches and scheduled launches) | The **acting member**; automation passes the **rule's creator**; scheduled launches pass the **plan's creator** | The plan's AdAccount | `ForbiddenException`; scheduled-launch refusal lands in the launch failure audit + notification |
| Cross-platform draft create (`createCrossPlatformDraft` with a target account) | The **acting member** | `dto.targetAdAccountId` | `ForbiddenException` before anything is stored |
| Campaign status ACTIVE direction (`setMetaStatus`, `setAdSetStatus`, `setAdStatus` → ACTIVE) | The **acting member** | The plan's AdAccount | `ForbiddenException` before the platform call |

Ad accounts are now first-class deny targets: the member-access
matrix/target catalogue includes AdAccounts (source
`ad_account`, category `ads`), so an AdAccount id can be stored
in `deniedConnections` from the Connect Center UI like any
Page/account.

### Actor-rule table — honestly NOT gated (and why)

| Path | Why not gated |
|---|---|
| SMS / Email broadcasts | Their senders are `MessagingSenderConfig` rows (tenant SMTP / SMS gateway credentials), **not connection targets** — there is no Integration/SocialAccount id a deny entry could name. Inventing a mapping would be fake-gating. Out of deny scope, documented in code. |
| Scheduled/system ad insights sync (`syncInsightsJob`, passes `fromJob: true`) | Runs with **no member actor** (per-org job). Gating it on "someone" would require inventing an actor. Manual triggers of the same methods ARE gated. |
| `AdsService.refreshAccountStatus` | A platform status probe (is the account disabled at Meta?), not a data sync or a send; no member action is being exercised. |
| Comment bulk `HIDE_ALL` / `MARK_RESOLVED` | Moderation/housekeeping, **not sends** — nothing leaves the platform on the tenant's behalf. Only the reply action is gated. |
| Campaign status **PAUSED** direction (all three setters) | Deliberately ungated: pausing stops spend. Denying a member the ability to *stop* a campaign would be a safety regression; the deny-list governs acting *through* an account, not emergency stops. |
| AI paths whose settings row has **no recorded `updatedById`** | Rows created before CC27 (or minted by system defaults) have no configuring actor — there is nobody defensible to check, so the path runs ungated rather than inventing an actor. From CC27 on, every settings save records the actor, so this shrinks to legacy rows only. |
| Inbox conversations with **neither an assignee nor a recorded configuring actor** | Same rule: no actor exists on that path; documented, not fabricated. |
| The org **OWNER** | Never denied, anywhere (CC17 rule, unchanged) — every check short-circuits for OWNER. |

Spec: `apps/api/src/connections/cc27-deny-completion.spec.ts`
— **27/27**. Each gated path is proven by a spec asserting the
send/publish/sync does **not** happen (no Graph call, no claim,
no sender constructed).

---

## CC28 — Own-app completion

### Per-provider honesty

| Provider | Verify-before-save | Status after save | What "verified" means |
|---|---|---|---|
| Meta | **Real** — existing `MetaAppClient` check, unchanged | `verified` | Unchanged from CC1–CC10 |
| TikTok | None exists (CC3 pattern) | `configured` | Verified at first connect (unchanged) |
| Google | **None possible** — there is no pre-OAuth credential check for an OAuth client. Client id must end `.apps.googleusercontent.com` (format check) + secret presence only | `configured` | Verified at first connect: the first OAuth callback exchange either works with the tenant's client or Google rejects it |
| LinkedIn | None exists | `configured` | Verified at first connect (same pattern) |

Google/LinkedIn app-config views carry `verificationNote:
"verified_at_first_connect"` and the **exact redirect URIs** the
tenant must register in their own console — `listAppConfigs`
also returns them as `ownAppGuides` so the UI can show them
before anything is saved:

- Google (derived from the platform's own callback routes, one
  per surface): YouTube, GA4, Merchant Center, Business Profile
  callback URLs.
- LinkedIn: the LinkedIn callback URL.
- The UI states plainly that without registering them, the
  tenant's OAuth **cannot complete** — Google/LinkedIn will
  reject the redirect.

### App-source resolution (connect + refresh)

- **Google pack** (`GoogleConnectService`): connect URL accepts
  `?appSource=`; the choice is bound into the signed OAuth state
  and the callback exchanges with the **same** client; the
  Integration row persists `appSource`. Token refresh resolves
  by the integration's own `appSource` (own → tenant config,
  platform → platform `googleAppConfig`). No silent fallback:
  an own-app account whose tenant config was deleted fails with
  a Bengali "not configured" message.
- **YouTube + LinkedIn social OAuth** (`SocialOAuthService`):
  same parameterization, mirroring CC4's TikTok binding; the
  connect-url endpoints accept `?appSource=`; own-app redirect
  URI is the derived platform callback (no override — that is
  the URL the tenant registered). Refresh in
  `ensureAccessToken` resolves by the account's `appSource`.
- Platform-app accounts are byte-identical to before (state
  payload is only added on the own path); regression-pinned in
  the spec.

### Meta app-secret rotation

Saving a Meta `TenantAppConfig` whose **appId matches** the
existing config but whose **secret differs** (compared after
decryption) is a rotation:

- The new secret is verified via the existing `MetaAppClient`
  first — a bad new secret saves **nothing** (spec-pinned).
- On success the sealed secret is replaced, the audit action is
  the distinct `app_config.secret_rotated`, and the response
  carries `rotated: true` (the UI shows "reconnect not needed").
- **No Integration or SocialAccount row is touched**
  (spec-pinned: row snapshots identical). Why that is correct:
  app-secret rotation does not invalidate page/user access
  tokens (they are not derived from the app secret), and webhook
  signature verification resolves the **current** config secret
  at request time, so it follows the rotation automatically.

### Token-paste Meta connects gain `appSource`

- Social (`POST social/accounts/meta/connect`) and Ads
  (`POST integrations/meta/connect`) accept optional `appSource`
  (`platform` | `own`). `own` requires an existing tenant Meta
  config — Bengali 400 otherwise; nothing is silently downgraded
  to platform.
- Persisted on the created Integration (and, for social, on the
  Page/IG SocialAccounts) + audit metadata.
- Downstream honesty: on the **social** side the value has a real
  effect — CC21(a) Meta token healing resolves its exchange
  credentials by the account's `appSource`, so a pasted own-app
  token is healed through the tenant's own app. On the **ads**
  side, nothing downstream resolves an app secret today (ads
  sync/publish use the stored user token directly), so the value
  is recorded truthfully as provenance — this doc says so rather
  than pretending an effect.

Spec: `apps/api/src/connections/cc28-own-app-completion.spec.ts`
— **20/20**.

One pre-existing spec was updated (in the CC28 commit,
documented there): `cc3-app-config.spec.ts` used `"google"` as
its example of an *unknown* platform for the putAppConfig
refusal; google is a real platform now, so the example became
`"snapchat"` — the test's intent (unknown platform refused) is
preserved; suite 6/6 green.

---

## CC29 — Courier multi-account

### Per-courier identity source

Investigation result: **no courier's verify response returns a
real account id.**

| Courier | What verify actually returns | Account key |
|---|---|---|
| Steadfast | `getBalance()` → balance only | Credential fingerprint |
| Pathao | Token issue + store list. Stores are merchant **outlets** (many per account, chosen per booking), not an account id; the token response carries no merchant id | Credential fingerprint over `clientId + ":" + username` — deliberately **excludes** the access/refresh tokens, because Pathao token refresh persists rotated tokens into the same credential row and must not fork the account |
| RedX | Areas list (geography, not identity) | Credential fingerprint |

Fingerprint: exported `courierAccountKey(provider, creds)` =
`"fp_" + sha256(material).hex.slice(0, 24)`, computed
server-side; the credential itself is never exposed (the tenant
sees the CC17 label or the `fp_…` prefix). Material: Steadfast
= apiKey, RedX = accessToken.

**Honest consequence:** rotating the fingerprinted credential
itself (new API key / new token / different Pathao username)
reads as a **new** account; the tenant disconnects the stale
row. That is the price of no courier offering a stable account
id, and it is stated here rather than hidden.

### Behaviour

- Keying is now (org, provider, externalAccountId): reconnecting
  the **same** credential set updates the same row (default flag
  preserved); a **different** set creates a sibling row, default
  only when no sibling carries the flag. Each set is verified
  separately at connect (existing verify-before-save).
- Primary resolution (shared, pure, spec-pinned):
  CONNECTED+default → earliest CONNECTED → earliest any-status
  (a disconnected default never beats a connected account).
- Booking resolution order: explicit `courierIntegrationId`
  (booking + bulk DTOs) → the EC22 rule's pinned
  `courierAccountId` (previously evaluated but **ignored** by
  booking — now honoured) → provider default CONNECTED →
  earliest CONNECTED. An explicit/rule account that is missing
  or disconnected is a Bengali 400 — **never a silent reroute**
  to another account with different rates/balance.
- `CourierShipment.integrationId` records the account actually
  used (+ audit metadata). Status sync resolves the client from
  the shipment's **recorded** account (recorded mode needs the
  row + credential, not CONNECTED status — sync must keep
  working for in-flight parcels; a deleted row falls back to
  primary). `null` (pre-CC29 shipments) → primary, as before.
- EC22 keeps choosing the **provider**; the account follows the
  resolution above (documented in code + spec).
- Disconnect accepts `?integrationId=`: disconnecting one
  account leaves its siblings fully working (spec-pinned —
  booking + client resolution still succeed on the survivor).
  Provider-only disconnect (legacy callers) disconnects the
  primary, documented.
- `GET courier/connections` now also returns `accounts[]` per
  provider (id, fingerprint, status, isDefault, label,
  connectedAt); top-level fields still describe the primary, so
  existing consumers (orders page etc.) are unaffected.
- UI: Connect Center courier panel lists every account with
  default badge + per-account make-default/disconnect, and the
  connect form stays available for another account; the Orders
  booking form (single + bulk) gains an account select shown
  only when a provider has >1 connected account (empty =
  rule/default resolution).

### CC29 honest limits

- `setTrackingTemplate` still edits the **primary** account's
  template only (per-account templates are not a concept in the
  existing settings surface); a shipment's tracking URL prefers
  its own account's template and falls back to the primary's.
- Quote + Pathao/RedX picker lookups (stores/cities/areas) use
  **primary** resolution — they are read helpers for the booking
  form, and the booking itself re-resolves the chosen account.

Spec: `apps/api/src/courier/cc29-courier-multi-account.spec.ts`
— **14/14** (clients spied at the prototype seam; specs prove
*which account's credentials* were used). All 9 pre-existing
courier suites stay green.

---

## Gates (sequential, final HEAD `eedf4b8`)

| Gate | Result |
|---|---|
| API jest (full, `--runInBand`, `NODE_OPTIONS=--max-old-space-size=4096`) | **337/337 suites, 3438/3438 tests — all pass** (the known cx3-debounce flake did not appear this run; no worker-OOM) |
| Web vitest | **332/332** |
| tsc | api **0** / web **0** / admin **0** errors |
| prisma validate | valid |
| Fresh-Postgres full sequence | **159/159 migrations applied** (157 prior + 2 new), 210 public tables; throwaway DB dropped after |
| Monorepo build (`pnpm@9.15.0 -r build`) | green (exit 0) |

Baseline movement vs B11: API +3 spec files (cc27 27 tests,
cc28 20, cc29 14) → 334 → 337 suites; migrations 157 → 159.

## Honest limits

- **No live provider proof for anything in this batch** — no
  real Meta/Google/LinkedIn OAuth, no real courier account, no
  real deny scenario was exercised against a live account.
  Everything is spec/fixture-proven. M30 live verification
  remains entirely owner-owed.
- The two new migrations have **not run on any real database**
  (fresh-Postgres sequence only, as always).
- CC27's AI gates cover paths whose configuring actor is
  recorded from CC27 onward; pre-existing settings rows without
  `updatedById` stay ungated by design (see the NOT-gated table)
  until someone saves those settings once.
- CC29's fingerprint identity means a credential rotation reads
  as a new account (above) — inherent to the couriers offering
  no stable account id.
- Nothing in this batch is pushed or deployed; the push gate
  remains the owner's explicit instruction, as always.
