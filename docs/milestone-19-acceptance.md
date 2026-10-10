# Milestone 19 Acceptance — Phase H: Creative & Audiences

Delivered 2026-10-10 on the owner's approval (advertising review,
`docs/advertising-review.md`, Phase H). Schema: 74 -> 78 models
(+CreativeAsset, +AudienceRecord, +SavedAudience, +CatalogRecord;
CampaignPlan.isTemplate; CampaignAd format/imageAssetId/videoAssetId/
carouselCards). Migration `20261010190000_m19_phase_h` applied.

## Delivered

**H1. Creative library + Meta media upload** (`creatives/`)
- Upload by public https URL: images via `/{account}/adimages`
  (urls) — ready ONLY with Meta's returned hash; videos via
  `/{account}/advideos` (file_url) — processing until a status
  refresh reads Meta's video_status. Upload failures are recorded
  as failed assets with Meta's own message. Creatives page with
  per-status badges and video refresh.

**H2. Richer ad formats** — the publish client now builds link ads
with image_hash, video ads (video_data), and carousel ads
(link_data child_attachments, 2-10 cards). The builder offers all
three formats with library pickers (only ready assets of the plan's
own account) or direct URLs. Publishing resolves assets server-side
and FAILS honestly when an asset is missing/not ready — verified by
test (processing video blocks publish; ready video publishes with
the real video id in the creative).

**H3. Custom audiences from first-party data** (`audiences/`)
- Sources: all customers, all leads, or an RFM segment's customers
  (M17 engine reused). Contacts are uploaded ONLY as SHA-256 hashes
  (EMAIL_SHA256/PHONE_SHA256 schema, batched) — a test asserts no
  raw email/phone appears in any request. The record is built only
  when Meta creates the audience and accepts the batches; size comes
  from Meta's approximate_count via Refresh, never estimated.
  Empty source = honest refusal before any API call (live-verified).

**H4. Saved audiences + lookalikes + targeting** — SavedAudience
presets (JSON) with one-click apply in the builder; ad set targeting
now carries interests (flexible_spec), custom audience include/
exclude (Graph custom_audiences / excluded_custom_audiences).
Lookalikes created from a confirmed source audience (country +
ratio 0.01-0.20), status refreshed from Meta's delivery_status.

**H5. Catalog sync** (`catalogs/`) — create a catalog in the
owner's Meta Business (business id from the form) or register an
existing Commerce Manager catalog; push up to 500 active products
via the batch API with price in minor units, availability from real
stock, and item URLs built from the Business Profile website
(refused honestly when no website is set). Pushed/error counts come
from the batch response handles/errors.

**H6. Duplicate, templates, blueprints** — any plan can be
duplicated (structure only: fresh draft, NO external ids) or saved
as a template; templates instantiate via the same duplicate path.
Three BD blueprints (COD Sales, Click-to-WhatsApp, Lead Form)
instantiate into editable drafts; a chosen product grounds the ad
copy in its real name/price. Blueprint budgets are labeled in the
UI as editable starting values, not data-based recommendations.

## Verification
- API tests 250 pass (8 new: client creative shapes for all three
  formats; duplicate without external ids + targeting carried over;
  format validations; blueprint product grounding; publish blocked
  by a processing video then succeeding with the video id; image
  hash / video processing / failed-asset recording; hashed-only
  audience upload + empty-source refusal; catalog counts + the
  no-website refusal).
- Web builds (34 pages: new Creatives + Audiences pages).
- Live: all three new list endpoints return honest empties;
  blueprint instantiation created a real draft plan; duplicate-as-
  template verified (isTemplate true, ad sets copied); audience
  creation refuses an empty source before touching Meta.

## Limitations
- Everything Meta-facing needs the owner's connected Meta account
  to verify end-to-end (same backlog as the checklist).
- Catalog item URLs assume <website>/product/<slug>; stores whose
  URL scheme differs should adjust product slugs (noted in code).
- Audience membership updates (append/remove on later syncs) are
  not automated yet; re-running a build creates a fresh audience.
- Advantage+ catalog campaigns (sales objective with catalog) use
  the standard builder; a dedicated catalog-sales flow is Phase I+
  territory if wanted.
