# OB3 — One-Umbrella Batch 3: Acceptance (OU4 + OU10 remainder)

Status: **CODE-COMPLETE** (local commits only — nothing pushed).
Worktree: `~/workspace/ai-marketing-saas-ou`, branch `one-umbrella`.
Base HEAD: `3d9e862e` (OB2 complete, tree clean at start — verified).
Final HEAD: see git log (acceptance-doc commit on top of the 5 item commits below).
Migrations: **none** — no range claimed, none needed (platform is derived
from the AdAccount row; campaign status is read through live, never stored).

## Commits

| Commit | Item |
|---|---|
| `2d024390` | OU4 clients: Google campaign status/lifecycle + Customer Match, TikTok campaign status + DMP audiences (+13 mocked specs) |
| `9e362474` | OU4 audiences API: Google/TikTok branches in create/lookalike/refresh/membership |
| `c991ac23` | OU4 campaigns API: real xdraft status sync + pause/resume lifecycle |
| `8bb69701` | OU4 web: campaign-builder — real provider status + Pause/Resume on xdrafts |
| `f97b1fa4` | OU4 web: audiences page — Google/TikTok accounts, platform badges, honest notes |

## Step-0 findings (verified in THIS tree before building)

**OU4 — campaigns:**
- `PublishingService` created Google Search/PMax and TikTok campaigns
  PAUSED/DISABLED only; it had no status read and no lifecycle call.
- `CampaignsService.syncCrossPlatformDraftStatus` (~L5149) returned
  `{available:false}` — its own comment stated the codebase had NO
  Google/TikTok campaign-status read path.
- Ads clients were read-only reporting: `GoogleAdsClient` (GAQL daily
  metrics + `verifyCustomer`), `TikTokAdsClient` (integrated report +
  `verifyAdvertiser`). Both already carried the full credential sets
  (Google: OAuth refresh + developer token; TikTok: advertiser
  Access-Token) — management needed new operations, not new config.
- Credentials resolve via AdAccount → Integration credential
  (`decryptJson`), the `PublishingService.accountSecrets` pattern;
  audiences used the Meta-only `metaTokenForAccount` path.
- Meta lifecycle discipline to mirror existed in `setMetaStatus`:
  activation gated by `assertCampaignAccountAccess` (CC27), pause
  always allowed, provider-confirmed-before-local-write, publish log
  + audit on both outcomes.

**OU4 — audiences:**
- `AudiencesService` was Meta-only end to end; `AudienceRecord` has no
  platform column; `contactsFor()` already produces SHA-256 hashed
  [email, phone] pairs — the identifier form all three platforms take.

**OU10 remainder — STOP RULE TRIGGERED (see NOT BUILT):**
- The MX6 keyword engine is **absent in this tree**: the ou schema has
  no `MessagingKeywordRule`/`MessagingKeywordHit` (only mx tree,
  migration `20261019030200_mx6_keyword_campaigns`). This tree carries
  only MS2 STOP/START handling on WhatsApp inbound.
- **No inbound SMS path exists**: webhook controllers in this tree are
  Meta, Telegram, Shopify, Woo, integrations/connections — none for
  SMS. The three configured gateways (`sms.provider.ts`:
  sslwireless / bulksmsbd / alphasms) are outbound send functions only.
- **No inbound email reply processing** exists (zero hits); email has
  only the outbound provider + tokenised unsubscribe link.
- Telegram broadcast was **not** rebuilt: MX13/MB5 delivered it in the
  mx tree (`docs/messaging-mx13-acceptance.md` there — Telegram is the
  fifth broadcast channel on the MX1 engine, STOP/START hooked into
  the MS2 store). It arrives in this line by union, not by rebuild.

## OU4 — shipped audit

### 1. Cross-platform campaign STATUS SYNC ✅
- Clients: `GoogleCampaignManage.getCampaignStatus` (GAQL
  `campaign.status`), `TikTokManage.getCampaign` (`/campaign/get/`,
  `operation_status`/`secondary_status`).
- `PublishingService.crossPlatformCampaignStatus` maps Google
  ENABLED→active / PAUSED→paused / REMOVED→removed and TikTok
  ENABLE→active / DISABLE→paused, raw enum always kept; a provider
  "no such campaign" is an error, never a fabricated status.
- `CampaignsService.syncCrossPlatformDraftStatus` now performs the
  real read and returns `{available:true, providerStatus,
  providerStatusRaw, name?, status, externalCampaignId, syncedAt}`.
  Honest unavailable states preserved: no external id yet, publishing
  unavailable, or provider/config error → `{available:false, reason}`
  with the provider's message verbatim; sync never throws for
  provider errors. Legacy CN9 harness shape kept compatible.
- Hub UI shows the real status on demand (সক্রিয়/বিরতি/সরানো হয়েছে
  + raw enum), or the verbatim reason when unavailable.

### 2. Lifecycle actions (pause + resume) ✅
- Clients: Google `campaigns:mutate` update with explicit
  `updateMask:"status"` (refuses to claim success without a result
  resource name); TikTok `POST /campaign/status/update/`.
- `CampaignsService.setCrossPlatformDraftLifecycle` +
  `POST :planId/xdrafts/:draftId/lifecycle` (WRITE roles, DTO
  `action ∈ pause|resume`). Only `created` drafts with an external id.
  **Resume is gated** by `assertCampaignAccountAccess` exactly like
  Meta activation; **pause is never gated**. Provider failure →
  publish-log error row + BadRequest "<Platform> did NOT confirm the
  status change: … Local status is unchanged." and the draft row is
  never written. Success → publish-log row (`google_pause`,
  `tiktok_resume`, …), audit `campaign.xdraft_paused|resumed`, and
  the response carries a **fresh** provider re-read
  (`providerStatusSource:"fresh_sync"`), falling back to the
  confirmed target mapping labelled `"target_mapped"`.
- Hub UI: Pause/Resume buttons only on created drafts with an
  external id; success refreshes the list and re-syncs.

### 3. Audience sync — Google Customer Match ✅
- `createCustom` branches on the AdAccount's platform. Google:
  CRM-based user list via `userLists:mutate`
  (`crmBasedUserList.uploadKeyType = CONTACT_INFO`, first-party),
  then an OfflineUserDataJob — create → addOperations (5,000-user
  chunks of SHA-256 hashed identifiers only) → run. The record counts
  as built only with Google's returned user-list id; failures mark
  the record `failed` with the verbatim error (Meta discipline).
- `refreshMembership` re-uploads through a new job against
  `customers/{id}/userLists/{externalAudienceId}`.
- `refresh` reads the list via GAQL; `approximateCount` updates ONLY
  when Google returns a plain number — `size_for_display` is often a
  range, and then the old count is kept (never estimated).
- **Lookalike on Google: NOT BUILT by design** — Google offers no
  API-created lookalike (similar audiences are auto-generated by
  Google from a Customer Match list); the API refuses with that
  explanation instead of faking one.

### 4. Audience sync — TikTok DMP ✅
- Custom: data-file upload (`/dmp/custom_audience/file/upload/`,
  SHA-256) → create by file (`/dmp/custom_audience/create/`); an
  audience counts only with TikTok's returned audience id.
  Membership refresh uses `/dmp/custom_audience/update/` with the
  same upload path. TikTok's one-identifier-type-per-file rule is
  honoured: email hashes when any exist, else phone hashes.
- **Lookalike IS offered by TikTok's API**
  (`/dmp/custom_audience/lookalike/create/`, endpoint existence
  verified against TikTok's official SDK listing, 2026-10-16) and is
  built: source must be a TikTok custom audience with an external
  id. TikTok expresses size as a similarity tier, so the UI's ratio
  maps ≤0.05→NARROW, ≤0.10→BALANCED, else BROAD.
- `refresh` uses `/dmp/custom_audience/get/`; size is stored only
  when TikTok reports one (null stays null — never estimated).
- No synchronous "received" count exists from Google/TikTok, so none
  is recorded or displayed for those platforms (Meta's num_received
  behaviour is unchanged).

### 5. Audiences web ✅
- Custom form accepts meta/google/tiktok connected accounts with
  platform labels and per-platform explainer lines; records carry a
  platform badge (joined from loaded accounts — no schema change).
- Lookalike form gained the account picker it never visibly had;
  selecting a Google account shows the honest no-lookalike note and
  disables submit. Header copy covers all three platforms; TikTok
  tier mapping and Google size-range behaviour are stated in the UI.

## NOT BUILT (explicit, with evidence)

1. **OU10 remainder — SMS/email keyword campaigns: NOT BUILT.**
   The keyword engine (MX6 `MessagingKeywordRule/Hit`) does not exist
   in this tree — it lives in the mx tree and arrives by union;
   forking it here was forbidden by the batch ruling and was not
   done. Independently, neither channel can receive in this codebase:
   no inbound SMS webhook exists for any configured gateway
   (sslwireless/bulksmsbd/alphasms are send-only in
   `sms.provider.ts`), and no inbound email reply processing exists.
   A keyword campaign on a channel that cannot receive would be a
   fake feature. **Build target: the post-union tree**, on top of the
   MX6 engine, and only for a channel once a real inbound path is
   evidenced (gateway MO webhook contract or an inbox email-reply
   path). Poll campaigns untouched, as instructed.
2. **Cross-platform campaign delete/archive: NOT BUILT.** TikTok
   Marketing API v1.3 has no campaign delete endpoint; cross-platform
   consistency keeps pause as the lifecycle floor for both platforms.
3. **Full campaign edit (budget/targeting) for Google/TikTok from the
   hub: NOT BUILT** — outside the brief's minimum (status sync +
   pause/resume); drafts still re-create a new PAUSED external draft
   via the existing CN9 path (the old external draft is neither
   edited nor deleted — stated in that flow's own note).
4. **Live proof of any OU4 call: none claimed.** All specs run
   against mocked provider clients in the repo's existing style.
   TikTok DMP payload field shapes follow the v1.3 surface as listed
   in TikTok's official SDK (verified 2026-10-16) and Google's
   documented Customer Match flow; field-level confirmation against
   real advertiser accounts is M30-owed (checklist below).

## Gates (coordinator re-run, serial, final tree)

- API jest, touched scope (`src/ads`, `src/audiences`,
  `src/publishing`, campaigns cn9 + cb6 + ou4 spec): **19 suites /
  155 tests, all passed**. Includes new: ou4-manage-clients (13),
  ou4-xdraft-manage (10), ou4-publishing-manage (8),
  ou4-cross-platform-audiences (11); pre-existing cn6/cn9/cb6 and
  ads suites green, Meta audience paths unregressed.
- API `tsc --noEmit`: **0 errors**. Web `tsc --noEmit`: **0 errors**.
- Web vitest: **110 files / 900 tests, all passed**.
- Web `next build`: **passed**.
- Fresh-Postgres: **not run — no migration was added** (rule: only
  when a migration exists).
- No pre-existing failure needed adjudication in the touched scope:
  the known base failures (cc26, adx3-nav-counts) live outside it
  and were not encountered; the full API suite was not run in this
  batch (touched-scope discipline, consistent with OB1/OB2).

## Live-verification checklist (owner, M30-style — ALL UNCHECKED)

- [ ] Connect a real Google Ads account (developer token approved at
      Basic+ level) and publish a cross-platform draft PAUSED.
- [ ] Sync status from the hub: hub status matches Google Ads'
      campaign status verbatim (incl. after a manual change in
      Google Ads).
- [ ] Pause and resume the campaign from the hub; confirm each state
      change inside Google Ads; confirm a resume attempt by a
      non-approved member is refused before any provider call.
- [ ] Build a Google Customer Match audience from real customers;
      confirm the user list in Google Ads, its reported size after
      processing (6–12h), and that a range-sized list shows no fake
      count in the hub.
- [ ] Repeat status sync + pause/resume on a real TikTok advertiser
      (campaign created DISABLED via the existing publish flow).
- [ ] Build a TikTok custom audience by file and a TikTok lookalike;
      confirm both in TikTok Ads Manager (audience ids, sizes,
      NARROW/BALANCED/BROAD tier effect) — this is also the
      field-level verification of the DMP payload shapes.
- [ ] Confirm provider errors (revoked token, unapproved developer
      token, unauthorized advertiser) surface verbatim in the hub
      and never as a success.
- [ ] (Post-union) Re-audit OU10 on the union tree: MX6 engine
      present + an evidenced inbound SMS/email path before any
      SMS/email keyword build is scheduled.
