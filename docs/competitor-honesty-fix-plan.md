# Competitor Intelligence — Honesty Fix Package (HF1–HF7)

Owner instruction 2026-10-12 01:37 +06: "এবার Honesty-fix প্যাকেজ শুরু করো",
after the 2026-10-12 audit (see MEMORY.md "COMPETITOR INTELLIGENCE AUDIT")
and after Competitors Design v2 (15f4b0e) landed.

Governing boundary (owner's own standing rule): **no mock integrations in
production code; if a real connection is unavailable, use a clearly labeled
development adapter. Never claim an operation succeeded unless it actually
did.** The Milestone-8 core already honoured this — the website-scanner
spec literally asserts "returns null when no price is published (nothing
is invented)". The 2026-10-11 competitors series violated it. This package
removes every fabrication at the source, replaces two fake "analyzers"
with real fetched evidence, and converts one fake "miner" into an
input-driven tool. It does not remove any feature tab.

## Audit facts this plan rests on (code-verified 2026-10-12)

- `multi-platform-scanner.ts`: `scanTikTokAds` and `scanBingAds` make **no
  network call** — they fabricate ad copy and random/fixed start dates.
  `scanGoogleAds` scrapes DuckDuckGo *organic* results, labels them ads,
  and on any failure pushes `fallbackGoogleAd` (fully invented).
  `CompetitorsService.syncMultiPlatform` then **persists all of these to
  `CompetitorAd` as if real**, and `listAds` derives `isWinning`
  (active + ≥14 days) from the random dates — so fake "Winning Ads" flow
  into the alerts feed and the agency dossier.
- `seo-analyzer.ts`: **no fetch at all**. Keywords, positions, volumes,
  difficulty, visits, Domain Authority and traffic shares are generated
  from name templates with fixed numbers. `generateSeoGapStrategy` feeds
  these invented keywords to the LLM and returns an `estimatedCtrBoost`.
- `funnel-auditor.ts`: constructor takes `fetchFn` and **never calls it**.
  Every competitor gets the identical report: friction 28, the same 3
  bundle tiers (popularity 50/35/15), the same gateways and trust badges.
- `review-miner.ts`: no review source exists. With an LLM, the prompt
  asks it to invent "typical" complaints and quotes; without one, a
  hardcoded fallback returns 460 feedback / 3.8 rating / invented quotes.
- `video-deconstructor.ts`: LLM/template script generation from a real
  ad's text (legitimate creative work), but the fallback presents its
  guesses about the competitor's hook as factual breakdown, unlabeled.
- `rules-engine.ts`: default rules ship with seeded fake history —
  `triggerCount: 3`, a `recentExecutions` entry claiming a Daraz
  stock-out budget boost was "EXECUTED". It never happened.
- Existing unit tests **assert the fabricated values** (service spec:
  SEO report numbers, funnel friction 28, bundle popularity 50). Those
  assertions encode the dishonesty and must be rewritten, not preserved.

## Package

### HF1 — Stop fabrication at the source (multi-platform scanner)
- `scanTikTokAds` / `scanBingAds`: no real public source is wired, so
  they return `[]`. No synthetic records, ever.
- `scanGoogleAds`: keep the real DuckDuckGo fetch, but label results
  honestly — creative text prefix "[Google Search Result]", `raw.
  sourceType: "organic_search"`. Delete `fallbackGoogleAd`; fetch
  failure or zero matches returns `[]`.
- `syncMultiPlatform`: persists only real fetched records. Its result
  gains a per-platform `unavailable` note (e.g. TikTok/Bing: "কোনো
  অফিসিয়াল public data source যুক্ত নেই") and the web sync notice
  shows it. Meta path unchanged (real Graph API).

### HF2 — SEO: replace invented metrics with a real on-page audit
- New analyzer fetches the competitor's homepage under the same
  discipline as `WebsiteScanner` (own host only, robots-respecting,
  honest UA, page budget) and reports **observed facts only**: title,
  meta description, H1 texts, product-schema presence, OG tags,
  sitemap presence, internal shop/product/offer links found in the
  HTML, and keyword phrases taken from the site's own title/headings.
- Removed from API + UI: estimated visits, Domain Authority, keyword
  volumes/positions/difficulty, traffic shares, intent distribution.
- `generateSeoGapStrategy` grounds only in the real audit + the org's
  own product; `estimatedCtrBoost` (a percentage) is removed — the
  strategy states its rationale in words, labeled as AI suggestion.
- Site unreachable / no website URL → honest unavailable state in the
  SEO tab, not a template report.

### HF3 — Funnel auditor: actually audit
- The auditor finally uses its `fetchFn`: fetch homepage, discover
  same-host product/cart/checkout links, fetch within budget, and
  detect from real markup — payment gateway mentions (bKash, Nagad,
  Rocket, SSLCommerz, Stripe, PayPal, cash-on-delivery text), trust
  phrases, checkout form field count when a checkout page is reachable,
  quantity/bundle UI hints.
- Not detected = reported "শনাক্ত হয়নি", never assumed. Invented
  fields are deleted: no friction score (or any score) without an
  observed basis, no bundle popularity percentages. Generic
  how-to-beat-them tips may remain but under a visible "সাধারণ পরামর্শ"
  (general advice) label.
- Unreachable site → `{ scanned: false, reason }` and the funnel tab
  shows that honestly.

### HF4 — Review miner: input-driven, or nothing
- Delete the invented fallback and the invention prompt.
- New flow: the owner pastes real customer reviews/comments copied from
  the competitor's page (textarea in the complaints tab). The miner
  analyzes **only that text**: counts are derived from the pasted
  items, quotes must be verbatim excerpts of the input (code drops any
  returned quote that is not found in the input text), a rating is
  reported only if the input itself carries parseable ratings.
- No input → the endpoint returns an unavailable state and the tab
  shows "আসল রিভিউ পেস্ট করুন — ডেটা ছাড়া রিপোর্ট তৈরি হয় না".
  Endpoint becomes POST with the pasted text; nothing is persisted
  unless a schema-free insight record pattern already fits (check
  `CompetitorInsight` usage; prefer stateless like the current GET).

### HF5 — Creative tools: label the drafts
- Video deconstructor and counter-ad outputs gain an `origin` field
  (`"ai" | "template"`) in the API response; the web UI badges them
  "AI খসড়া" / "টেমপ্লেট খসড়া". Fallback copy that asserts facts about
  the competitor's actual video is reworded as draft assumption.
  Generation itself is unchanged (it works from the real ad's text).

### HF6 — Rules engine: no fake history
- Default rules: `triggerCount: 0`, `lastTriggeredAt: null`,
  `recentExecutions: []`. Nothing else about the engine changes
  (simulation is already explicitly labeled SIMULATED).

### HF7 — Cleanup of already-persisted fabrications + downstream check
- Idempotent script `scripts/cleanup-fabricated-competitor-ads.ts`
  that deletes `CompetitorAd` rows matching the synthetic signatures
  (TikTok/Bing synthetic externalAdId patterns and Google fallback
  rows identifiable from `raw`). The script is shipped and documented
  in the acceptance doc; it is **not** run against any live database
  from the sandbox — the owner runs it on the deployment, or runs the
  new sync after it. Dry-run mode by default, `--apply` to delete.
- Trace every creation site of `provider: "alert-engine"` insights and
  the dossier builder: confirm alerts/dossier now derive only from
  real Meta ads + real observations after HF1, and say so explicitly
  in the acceptance doc (with file references).

## Tests (rewrite, don't preserve, the dishonest assertions)
- Scanner honesty specs: network failure → `[]`; TikTok/Bing → `[]`
  and `syncMultiPlatform` persists nothing for them; Google results
  carry `sourceType: "organic_search"`.
- SEO specs: fixture HTML → observed facts extracted; unreachable →
  unavailable; response contains no visits/DA/volume fields.
- Funnel specs: fixture HTML with gateway text → detected; without →
  "শনাক্ত হয়নি"; unreachable → `scanned: false`.
- Review miner specs: no input → unavailable; with input → counts from
  input, quotes verified ⊆ input, invented quote dropped.
- Rules spec: defaults have zero history.
- The existing service-spec assertions on fabricated SEO/funnel values
  are replaced by the honest-behaviour assertions above.

## Batches (sequential, one local commit each, NO push)
- **B1:** HF1 + HF6 + HF7 (stop the bleeding, fake history, cleanup
  script + downstream trace).
- **B2:** HF2 + HF3 (real SEO audit + real funnel audit; API + web +
  tests). Web work must preserve the Design v2 primitives (15f4b0e).
- **B3:** HF4 + HF5 (input-driven review miner + creative labels;
  API + web + tests) + package acceptance doc
  `docs/competitor-honesty-fix-acceptance.md`.

## Hard rules
- Local commits only; **no GitHub push/fetch** (owner-only trigger).
- Surgical staging: the working tree carries other tracks' uncommitted
  work (courier/customers/inbox/risk, courier-card.ts,
  docs/aipraktor-gap-plan.md) — never stage or modify it.
- No schema migration is expected; if one proves necessary, stop and
  document it in the acceptance doc instead of improvising.
- Verification gates per batch: API jest (competitors suites at
  minimum, full suite at package end), web vitest + build, tsc clean.
- Honest limit to state in the acceptance doc: no live Meta token /
  live competitor sites were exercised from the sandbox; detection
  logic is fixture-proven.
