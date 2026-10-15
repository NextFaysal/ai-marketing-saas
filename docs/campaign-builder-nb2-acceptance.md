# Campaign Builder Next — NB2 Acceptance (CN3 + CN4)

Built 2026-10-14 on branch `campaign-next` in
`~/workspace/ai-marketing-saas-cn` (base = NB1 close-out
`0459ddd`). Local commits only — NO push (owner's rule).
Plan: `Campaign-Builder-Next-Plan-2026-10-14.md`, Part 3 / NB2.

## Commits

- `f8de3c4` CN3+CN4 API core: schema + migration
  `20261013820000_cn3_cn4_ads_depth`, event matrix + catalog
  ads + CAPI/lead-form readiness + retargeting preset +
  LeadForm CRUD/create-on-Meta + publish wiring + inbox
  leadgen field mapping + blueprint copy.
- `f24d988` CN3 specs (11) + a fix the specs caught:
  validatePlan no longer demands a pixel for catalog ad
  sets (they optimize on the product set).
- `61ace3b` CN4 specs (9) + inbox leadgen mapping spec (3).
- `3850210` CN3/CN4 web builder controls.
- (this doc follows in the NB2 close-out commit)

## Spike verdicts (researched 2026-10-14, before building)

- **CN4 Lead form creation — CONFIRMED, built for real.**
  Meta's official Lead Ads guide (developers.facebook.com,
  page states "Updated: Mar 26, 2026") documents the full
  creation path: `POST /{PAGE_ID}/leadgen_forms` with a Page
  access token — questions (FULL_NAME / EMAIL / PHONE /
  CUSTOM with label + options and more), `privacy_policy
  { url, link_text }`, `thank_you_page`,
  `is_optimized_for_quality = true` for Higher Intent,
  `follow_up_action_url`,
  `block_display_for_non_targeted_viewer`; ad set
  `destination_type = ON_AD` with promoted_object
  `{ page_id }`; creative `object_story_spec.link_data`
  with link `https://fb.me/` and
  `call_to_action.value.lead_gen_form_id`. Permissions:
  ads_management, pages_manage_ads, pages_read_engagement,
  pages_show_list + the ADVERTISE task on the Page. Form
  creation has NO idempotency key — a retry can create a
  duplicate form on Meta; the local row only ever counts as
  created with the id Meta returned.
- **CN3 Custom conversions — NOT CONFIRMED, NOT built.**
  The only reachable evidence was a legacy Meta Pixel
  document (Graph v2.7-era examples of URL-rule custom
  conversions at `/{AD_ACCOUNT_ID}/customconversions`) and
  Meta's Graph/Marketing API v24 release notes (Oct 2025)
  listing custom conversions among restricted/flagged
  features. No current, documented create path could be
  confirmed, so — exactly as the plan instructed — the
  event picker ships with standard events only. If Meta
  re-documents a create path, custom conversions can be
  added as a follow-up without touching the picker.

## CN3 — Conversion & Catalog depth (what shipped)

- **Event picker per ad set**: `CampaignAdSet.conversionEvent`
  (nullable; null = the legacy PURCHASE default).
  Spec-pinned matrix, mirroring CN2's bidding matrix:
  SALES goals (OFFSITE_CONVERSIONS / VALUE) accept
  PURCHASE, ADD_TO_CART, INITIATE_CHECKOUT,
  ADD_PAYMENT_INFO, VIEW_CONTENT, ADD_TO_WISHLIST,
  COMPLETE_REGISTRATION, SUBSCRIBE, START_TRIAL, SEARCH,
  CONTACT, SCHEDULE, SUBMIT_APPLICATION, FIND_LOCATION,
  DONATE, OTHER; LEADS-objective ad sets accept LEAD,
  COMPLETE_REGISTRATION, SUBMIT_APPLICATION, SCHEDULE,
  CONTACT. LEAD requires the LEAD_GENERATION goal and a
  pixel. Any other combo is refused with the reason at
  add, at PATCH (checked on the MERGED ad set, so a goal
  change cannot smuggle an invalid event), and again in
  validatePlan. At publish, `promoted_object` carries
  `custom_event_type` = the chosen event instead of the
  hardcoded PURCHASE. Note: VALUE is an optimization
  goal, not a custom_event_type — it is not in the picker.
- **Event/CAPI health row** (readiness key `events`): reads
  ONLY this tree's existing CAPI state —
  `ConversionApiSetting` + the latest `ConversionEventLog`
  for the org. No setting → warn (unknown, never ok);
  pixel mismatch → warn naming both pixels; setting
  disabled → warn; enabled + matching + last send "sent"
  → ok; last send "failed" → warn with Meta's verbatim
  error; no sends yet → warn (unknown). No second health
  system was built. (This tree has no Connect-Center
  provider-health rows — that system lives in another
  worktree; the row honestly works with what exists here.)
- **Real catalog ads**: `catalogRecordId` + `productSetId`
  on the ad set (both-or-neither). Save-time validation:
  records must belong to the org, the product set must
  belong to the chosen catalog, and the set must already
  be created on Meta (`status = "created"` with an
  external set id) — otherwise refused, naming the fix
  ("ক্যাটালগ → Product Sets থেকে আগে Meta তে তৈরি করুন").
  Catalog + conversion event together is refused (a
  catalog ad set optimizes on the product set).
  validatePlan additionally requires objective
  OUTCOME_SALES, goal OFFSITE_CONVERSIONS/VALUE, and
  link-format ads only.
  **Exactly what publish sends for a catalog ad set vs a
  normal link ad** — ad set: `promoted_object =
  { product_set_id: <Meta set id> }` (no pixel, no event);
  campaign/ad set otherwise identical (PAUSED, same
  targeting/budget path). Creative: Meta's
  `template_data` dynamic format — message = the ad's
  primary text; name/description default to
  `{{product.name}}` / `{{product.description}}` unless
  the ad carries its own headline/description; link =
  `{{product.url}}`; CTA type from the ad. A normal link
  ad keeps the existing `link_data` path untouched.
- **Dynamic retargeting preset**:
  `POST campaign-plans/:planId/retargeting-preset`
  (kinds: `product_viewers`, `add_to_cart`). It consumes
  EXISTING AudienceRecords of the plan's own ad account
  only. No record chosen and none ready →
  `{ status: "missing", missing: [...] }` naming what is
  missing (including that in-builder audience creation is
  CN6). Ready records exist, none chosen →
  `{ status: "needs_choice", candidates }`. A chosen
  record is fully validated (org, same ad account,
  external id present, status ready) and becomes a draft
  ad set through the normal addAdSet path (pixel event
  PURCHASE when a pixel is given, optional catalog pair);
  the response lists follow-ups still owed (pageId /
  pixelId) instead of pretending the ad set is complete.
- Snapshots freeze the four new fields (approval compares
  what was approved); duplicateAdSet copies them;
  getPlanFull attaches `__catalog` / `__productSet` /
  `__leadForm` summaries for the builder.

## CN4 — Lead Ads complete (what shipped)

- **LeadForm model** (migration `20261013820000`): org
  scoped; pageId, name, locale (default EN_US), intro
  headline/description, questions (Json), privacyPolicyUrl
  (REQUIRED), thank-you title/body/button text,
  followUpActionUrl, higherIntent, fieldMapping (Json),
  externalFormId, status local | created | failed, error,
  createdById. The ad set links via
  `CampaignAdSet.leadFormId`.
- **Questions**: types FULL_NAME, EMAIL, PHONE, FIRST_NAME,
  LAST_NAME, STREET_ADDRESS, CITY, STATE, COUNTRY,
  POST_CODE, COMPANY_NAME, JOB_TITLE, CUSTOM. CUSTOM
  requires a label; options ≤ 10; ≤ 12 questions per
  form; question keys unique. Unknown types and shapes
  are refused at save with the reason.
- **Privacy URL is a hard gate**: save refuses a
  non-https URL, and validatePlan errors when a form ad
  set's form has no valid https privacy URL — never a
  silent publish.
- **Field mapping**: targets `name | email | phone |
  notes | custom:<key>`; a `custom:` target must name a
  LIVE (non-archived) lead CustomFieldDef of the org —
  refused at save otherwise, so the mapping can never
  point at a field that cannot receive it.
- **Create on Meta**: `MetaPublishClient.createLeadForm`
  posts the documented payload to `/{pageId}/leadgen_forms`
  with the plan ad account's integration token (see the
  token-class limit below). The row becomes `created`
  ONLY with Meta's returned id; a Meta refusal is
  recorded verbatim (status failed + error) and rethrown —
  never a claimed success. Meta forms are immutable:
  editing a created form FORKS it back to a local form
  (external id cleared; the response carries
  `forkedFromMeta: true`) so the next publish creates the
  corrected form as a logged step instead of silently
  sending the stale one.
- **Publish wiring**: for a LEAD_GENERATION ad set with a
  form, publish creates the form on Meta first (publish-log
  step `lead_form`, same approval spine — approved-only,
  everything PAUSED) when it has no Meta id yet, then
  creates the ad set with `destination_type = "ON_AD"` +
  promoted_object `{ page_id }`, and each ad's creative
  carries `call_to_action.value.lead_gen_form_id`.
  validatePlan requires the LEAD_GENERATION goal, the
  form's page = the ad set's page, and a lead-compatible
  CTA (APPLY_NOW, DOWNLOAD, GET_QUOTE, LEARN_MORE,
  SIGN_UP, SUBSCRIBE). Readiness key `lead_form`: no form
  → warn; local form → warn it will be created at publish
  (after the privacy/questions checks pass); created →
  ok; broken mapping targets → warn.
- **Webhook mapping**: `InboxService.ingestLeadgen` was
  extended minimally — after the Graph field_data fetch it
  looks up OUR LeadForm by org + fetched form_id; mapped
  standard targets win over the default field names; a
  `custom:<key>` answer lands in `Lead.customFields` only
  while its def is live; a `notes` answer is appended to
  the lead's notes; every answer still appears in the
  lead activity text. Forms we did not model keep the
  exact pre-CN4 behaviour (spec-proven parity).
- **Payload mapping choices** (documented, from the
  confirmed guide): introHeadline →
  `question_page_custom_headline`; thankYouTitle/Body/
  ButtonText → `thank_you_page` (title defaults to
  "ধন্যবাদ!"); followUpActionUrl → top-level
  `follow_up_action_url`; higherIntent →
  `is_optimized_for_quality`. introDescription is stored
  but NOT sent — the guide documents no field for a
  separate intro description on this endpoint.
- **Web**: builder gains the event picker, catalog +
  product-set pickers (only Meta-created sets selectable),
  lead-form picker on the ad-set create/edit forms, CN3/CN4
  badges on ad-set cards, a Lead Forms panel (list with
  honest status, create form with questions + mapping
  editors, "Meta-তে তৈরি করুন" per form), and a
  retargeting-preset card rendering missing / needs_choice
  / created states as returned. Design polish remains
  CN10's job, as in NB1.

## Gates (2026-10-14, this worktree)

- New specs: CN3 11/11, CN4 9/9, inbox mapping 3/3;
  scoped regression (campaigns + inbox + catalogs + crm):
  767/768 — the one failure was the known cx3-debounce
  timing flake (passes solo 18/18; also failed this way
  in NB1 on a tree that touched no inbox code).
- API jest FULL, three runs on this 8 GB sandbox:
  run #1 (default workers) completed — 330/331 suites,
  3322/3323 tests; the sole failed test was the same
  cx3-debounce flake. Run #2 died mid-run on a jest
  worker V8 out-of-memory (~254 suites PASS, no FAIL
  lines; cx3-debounce PASSED in that run) — an
  environment limit, not a test failure. Run #3
  (--maxWorkers=2): 3277/3277 tests passed, ZERO failed
  tests; the one "failed" suite (shopify-graphql) was a
  worker crash and passes solo 6/6. (Suite totals differ
  between runs because crashed workers' suites never
  report; run #1 is the most complete count.)
- Web tests 255/255. tsc: API 0 errors, web 0 errors.
  `next build` green.
- Prisma validate OK.
- Fresh PostgreSQL 16, FULL sequence: **157/157
  migrations applied clean** (156 base + NB2's one);
  `LeadForm` table and the four new `CampaignAdSet`
  columns verified present; temp database dropped after.

## Honest limits

- **Nothing here is live-proven.** No real Meta account,
  Page, catalog or lead has touched this code; the whole
  CN3/CN4 surface joins the M30 / CN12 live-verification
  list. In particular the catalog `template_data`
  creative's live acceptance by Meta is unverified.
- **Migration `20261013820000` has NOT run on any real
  database** — fresh-Postgres proof only, same as NB1.
- **Token class for lead-form creation**: the documented
  path wants a Page access token with the ADVERTISE task;
  create-on-Meta uses the ad account's existing
  integration token (the same token class the publish
  path already uses for page-scoped calls). Whether Meta
  accepts it for `leadgen_forms` in a given app setup is
  a live-proof question (CN12 class) — a refusal is
  recorded verbatim on the form and fails the publish
  honestly, never faked.
- **Custom conversions: not built** (spike above). The
  picker offers standard events only.
- **No idempotency on Meta form creation**: a retried
  publish after a Meta-side success with a lost response
  could create a duplicate form on Meta; the publish log
  + the form row's external id are the reconciliation
  trail.
- **Retargeting preset consumes records only** — audience
  creation/lookalikes remain CN6; the preset says so in
  its own `missing` output.
- introDescription is stored and shown, but not sent to
  Meta (no documented field — see payload choices).
- The CAPI readiness row reflects THIS tree's CAPI
  setting/logs; orgs whose CAPI state lives in the
  Connect-Center worktree will read "unknown" here until
  integration — unknown stays unknown, never ok.
- Known cx3-debounce flake: observed again under load in
  NB2 runs (solo green every time); root-cause is still
  the CX program's open item, not NB2's.
