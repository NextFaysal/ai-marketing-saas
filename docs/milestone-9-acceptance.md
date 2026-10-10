# Milestone 9 Acceptance Checklist - Campaign Builder & Publishing

- [x] Prisma models: CampaignPlan, CampaignAdSet, CampaignAd,
      CampaignPublishLog + migration 20261010080000. Schema: 50 models.
- [x] Builder: plans, ad sets (daily/lifetime budget, optimization
      goal, page/pixel ids, targeting countries/age/genders) and ads
      (text, headline, link, CTA, image URL, optional product link).
      Editing is allowed only in draft/rejected status; approved and
      later states are frozen and the API enforces it.
- [x] Validation before approval: budgets present and positive, target
      countries set, Page ID present, Pixel ID required for
      OFFSITE_CONVERSIONS, every ad set has at least one ad with text
      and a valid link. Submit returns the full error list, not a
      generic failure.
- [x] Approval workflow: draft -> pending_approval -> approved /
      rejected (with a stored reason; rejected returns to editable).
      Approve/reject/publish/activate/pause endpoints are restricted
      to OWNER/ADMIN; building/submitting also allows
      MARKETING_MANAGER. Every transition is written to AuditLog.
- [x] Publishing guard: publish() throws unless the plan status is
      "approved" (or "publish_failed" for resume). There is no other
      code path to the Meta write client.
- [x] Safe defaults: campaign, ad sets and ads are ALL created on Meta
      with status=PAUSED (asserted in tests from the actual request
      bodies). Activation is a separate explicit action; if Meta does
      not confirm it, local status does not change and the error is
      surfaced. No spend can start from the publish action itself.
- [x] Success is confirmed, never assumed: a creation counts only when
      Meta returns an object id (client tests assert id-less 200
      responses are failures). External ids are stored per entity.
- [x] Idempotent resume: a partial failure sets status publish_failed
      and keeps created ids; retrying Publish skips existing entities
      (tested: the campaign endpoint is not called again), so retries
      never duplicate campaigns on Meta.
- [x] Full audit trail: CampaignPublishLog records every external call
      attempt (step, external id, success/error, actor) and is shown
      in the builder UI.
- [x] AI copy: suggestions are grounded in the selected product's real
      data (dev template uses the actual stored price; the real-LLM
      prompt forbids invented discounts/promises) and are saved as
      draft ads flagged createdByAi for human review/editing - AI
      never submits or publishes anything by itself.
- [x] Web: Campaigns list (status + Meta status badges) and Campaign
      Builder (create plan, ad sets, manual ads, AI copy per ad set,
      submit/approve/reject, publish with resume, activate/pause,
      publish log). CSV/manual-only ad accounts are labeled in the UI
      and blocked server-side from publishing.
- [x] Tests: 136 total passing (API 128, contracts 7, worker 1).
- [x] Builds: all packages + API + Next.js pass.
- [ ] Live publishing needs the user's Meta app with Marketing API and
      ads_management (Advanced Access / App Review for accounts not
      owned by the app user) plus the connected account from
      Milestone 5. Until then every layer above the HTTP call is
      test-covered with a stubbed Graph API.

## Deliberately NOT in this milestone
- Managed ad accounts and the prepaid wallet remain postponed (the
  original architecture decision): publishing here always happens in
  the customer's OWN ad account with their own payment method, which
  avoids holding customer ad funds. Revisit only after platform-policy
  and legal review.
- Image upload to the ad account's image library: ads currently use
  image URLs in link-data creatives; binary upload arrives with the
  creative library phase.
- Automated rules (pause on CPA threshold etc.) arrive with the
  automation phase and will reuse setMetaStatus with full logging.
