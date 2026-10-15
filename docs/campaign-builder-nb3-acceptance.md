# NB3 Acceptance — CN5 Creative v2 + CN6 Audience Studio

Batch NB3 of the Campaign Builder Next package (CN1–CN12,
owner-approved in full 2026-10-14). Built on campaign-next over
NB2's close (3e09cc5). Local commits only — NO push.

Process note (honest): the NB3 coordinator died in a daemon
restart after committing all three build commits, and a finisher
agent died the same way before starting. The closing gates below
were therefore run and verified DIRECTLY by the main agent on the
committed tree, in the pattern of the CC B6/B7 closures. No
feature code was changed during closing.

## Commits

- `fd5abba` — CN6 audiences: studio sources in the existing
  AudiencesService (buyers / recent purchasers from real orders,
  product viewers from tracker events, cart abandoners from EC10
  open checkouts) + sourceCatalog with real contact counts;
  empty sources refuse honestly. 6 specs.
- `8ff9d2e` — CN5+CN6 API core: CampaignAd creative v2
  (textOptions / placementAssets / creativeEnhancements Json,
  migration `20261013830000_cn5_cn6_creative_audience`) —
  asset_feed_spec publish (multi-text DEGREES_OF_FREEDOM,
  placement PLACEMENT rules with base fallback),
  degrees_of_freedom enhancements (unknown keys refused at
  save), first-option fallback logged for carousel / lead /
  catalog ads, readiness creative warnings, CB4 snapshot freeze
  covers the new fields, asset variants (creative library +
  social media with honest refusals); Audience Studio endpoints
  riding the real AudiencesService (create / lookalike /
  exclusion presets / insights); CampaignsModule imports
  AudiencesModule. Specs: cn5 14 + cn6 8.
- `c0abf69` — CN5+CN6 web: multi-text option editors in create +
  edit forms, placement override asset pickers, enhancement
  checkboxes, option/placement/enhancement badges, CB3 preview
  frames use placement media, asset variant picker (creative
  library + studio/social media), per-ad-set Audience Studio
  card (source counts + one-click create-and-attach, lookalike
  form, exclusion presets, insights with honest
  unknown/overlap states).

## CN5 — what shipped

- **Multiple text options per ad**: primary texts / headlines /
  descriptions as option sets (Json); the legacy single fields
  remain the first option, so publish fallback, A/B, creative
  health and previews stay byte-compatible. Link ads publish
  through asset_feed_spec carrying the option sets; formats
  that cannot carry them (carousel / lead / catalog) publish
  the first options and the fallback is LOGGED — readiness
  warns, nothing silently pretends Meta received options it
  did not.
- **Per-placement assets**: placement override assets stored
  per ad and published as asset-feed PLACEMENT rules with the
  base asset as fallback; the CB3 preview frames render the
  placement media, so what is previewed is what is configured.
- **Advantage creative enhancements**: degrees_of_freedom
  toggles stored per ad and mapped at publish; unknown
  enhancement keys are REFUSED at save (no silent no-ops).
- **Asset variants**: an existing creative-library asset or a
  studio/social media asset can be pulled in as an ad variant
  from inside the builder; unusable assets refuse with the
  reason (existing resolveAdMedia discipline).

## CN6 — what shipped

- **In-builder audience creation through the EXISTING
  AudiencesService** — no second audience system. Sources:
  buyers and recent purchasers (real orders), product viewers
  (tracker events), cart abandoners (EC10 open checkouts), and
  the pre-existing contact sources. sourceCatalog returns REAL
  contact counts; an empty source refuses honestly instead of
  creating an empty audience.
- **Lookalike inline** from a chosen source audience via the
  existing createLookalike path, with its validations.
- **Exclusion presets** ("exclude purchasers 30d", "exclude
  existing customers") implemented as real, inspectable
  audience selections on the ad set — visible in targeting,
  editable, never hidden magic.
- **Per-ad-set insights**: audience size / overlap from real
  AudienceRecord data; when membership data cannot support a
  number, the state is "unknown" / not computable — never an
  invented figure.

## Gates (run directly by the main agent, 2026-10-14)

- Scoped (campaigns + audiences): **20/20 suites, 135/135
  tests PASS**.
- API jest FULL (--maxWorkers=2): 331 suites / 3304 tests —
  **3302 passed, 2 failed**. The 4 failed suites decompose as:
  - `cx3-debounce` (the 2 failed tests): the known CX-package
    flake. Proven pre-existing and NOT NB3-caused: the
    identical single-test failure (17/18) reproduces solo on
    the pristine integration-3 base tree, which contains no
    NB3 code. NB3 touches no inbox code. (Solo runs in this
    session went 17/18 twice — the flake is timing-sensitive
    under this sandbox's load; its root cause remains the CX
    open item.)
  - `social-sp9`, `ec-cp5-push-batch`, `shopify`: worker-crash
    suite failures with no failed tests; all three PASS solo
    (with cx3 in the same solo group: 3 passed, only cx3
    failed).
- Web tests **255/255**; tsc API **0** / web **0**; Next build
  **green**; prisma validate **OK**.
- **Fresh PostgreSQL 16 FULL sequence: 158/158 migrations
  applied clean** (157 + NB3's `20261013830000`); the three new
  CampaignAd columns (textOptions, placementAssets,
  creativeEnhancements) verified present; 210 public tables;
  temp database dropped after verification.
- Tree clean at close (the only dirt during the batch was a
  tsconfig.tsbuildinfo build artifact, discarded uncommitted).

## Honest limits

- **Nothing is live-proven against a real Meta account
  (M30/CN12 class).** asset_feed_spec multi-text acceptance,
  placement asset rules, degrees_of_freedom enhancement
  mapping, audience uploads and lookalike creation are
  spec/fixture-proven against the implemented Graph shapes
  only; live confirmation is CN12's job.
- Migration `20261013830000` has NOT run on any real DB —
  fresh-Postgres proof only.
- Audience overlap is reported only when stored membership
  data makes it computable; otherwise the UI says so.
- Product-viewer and cart-abandoner sources are only as good
  as the tenant's tracker / EC10 data — absent data yields an
  honestly empty source, which refuses creation.

## Carry-overs (unchanged, already on record)

- Demographics lifeEvents/workPositions remain API-only in the
  web (full UI is CN10's design pass).
- CB6 cross-platform budget totals still use ad-set sums on
  CBO plans (CN9's item).
