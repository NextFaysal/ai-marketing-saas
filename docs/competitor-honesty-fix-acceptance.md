# Competitor Intelligence — Honesty Fix Package (HF1–HF7) Acceptance

Owner instruction 2026-10-12 01:37 +06. Plan: `docs/competitor-honesty-fix-plan.md`
(commit `bef613f`). Governing boundary: no mock integrations in production
code; a real connection that is unavailable is a clearly labeled honest
state; never claim something happened that did not.

## Commits (local only — nothing pushed)

| Batch | Commit | Scope |
|---|---|---|
| B1 | `1ee4662` | HF1 + HF6 + HF7 (7 files, +288/−113) |
| B2 | `27c4980` | HF2 + HF3 (6 files, +837/−598) |
| B3 | the commit containing this version of this doc | HF4 + HF5 + this doc |

> Commit-history note: B3's staging raced with the parallel CX track
> twice in as many minutes — first a shared-index sweep carried B3's
> files into their CX5 commit, then their history rewrite (correctly)
> excluded them again. The final state is the intended one: B3 is its
> own local commit (this doc's correction rides in it), directly above
> the CX5 commit, and B1 `1ee4662` / B2 `27c4980` were never affected.
> An intermediate commit of this doc carries a message describing the
> first race; this note supersedes it.

## What changed, per HF item

### HF1 — Fabrication stopped at the source
- `multi-platform-scanner.ts`: `scanTikTokAds` / `scanBingAds` return `[]`
  (no official public source is wired) and make no network call.
  `fallbackGoogleAd` is deleted. `scanGoogleAds` keeps only the real
  DuckDuckGo fetch; results are labeled honestly — creative prefix
  `[Google Search Result]`, `raw.sourceType: "organic_search"` — and no
  start date is invented anymore (a search result has none). Fetch
  failure or zero matches returns `[]`.
- `CompetitorsService.syncMultiPlatform` persists only real fetched
  records and returns a per-platform `unavailable` note (TikTok/Bing:
  "কোনো অফিসিয়াল public data source যুক্ত নেই"; Google zero-result and
  Meta sync failure are also explained). The web sync notice displays
  the notes and now says "রেকর্ড" / "Google সার্চ ফলাফল" instead of
  calling everything an ad.
- The Meta path is unchanged (official Graph `ads_archive` API).

### HF2 — SEO: invented metrics replaced by a real on-page audit
- `seo-analyzer.ts` rewritten as `SeoOnPageAuditor` (+ shared discipline
  in `site-audit.ts`: own host only, robots-respecting, honest
  `QospreyCompetitorScanner` UA — the WebsiteScanner standard). It
  fetches the competitor's homepage and reports observed facts only:
  real title, meta description, H1/H2 phrases, Product JSON-LD presence,
  OG tags, sitemap presence, internal shop/product/offer links.
- Removed from API + UI: estimated visits, Domain Authority, keyword
  volumes/positions/difficulty, traffic shares, intent distribution,
  and the derived "traffic value in ৳" figure.
- `generateSeoGapStrategy` grounds only in the real audit + the org's
  own product, refuses (400) when the site cannot be audited, and the
  `estimatedCtrBoost` percentage is deleted — rationale is stated in
  words and the UI labels the output a draft (`origin: "ai" | "template"`).
  The SEO tab was rebuilt around the observed facts; its header no
  longer claims "Ahrefs / SEMrush Alternative", and the tab is renamed
  "SEO On-Page অডিট".

### HF3 — Funnel auditor actually audits
- `funnel-auditor.ts` rewritten: it finally uses its `fetchFn` —
  homepage + up to 3 same-host funnel links under the same robots/UA
  discipline. Detected from real markup/text: payment gateway mentions
  (bKash, Nagad, Rocket, SSLCommerz, ShurjoPay, AamarPay, Stripe,
  PayPal, COD), trust phrases actually printed, checkout form field
  count/names, bundle/combo hints as verbatim excerpts.
- Deleted: friction score, bundle tiers with popularity percentages,
  assumed gateways/badges/required fields. Not detected renders as
  "শনাক্ত হয়নি" in the UI; unreachable/no-URL/robots-blocked returns
  `{ scanned: false, reason }`. Generic tips remain under a visible
  "সাধারণ পরামর্শ — প্রতিযোগীর ডেটা নয়" label, and their invented
  effect percentages (35%/60%) were removed from the copy.

### HF4 — Review miner is input-driven, or nothing
- `review-miner.ts` rewritten. The invented fallback (460 feedback /
  3.8 rating / fabricated quotes) and the LLM invention prompt are
  deleted. The owner pastes real reviews copied from the competitor's
  page (new textarea in the complaints tab; endpoint is now
  `POST :competitorId/reviews-mine` with `{ reviewsText }`).
- Counts are counted by code from the pasted items; category/sentiment
  classification is a deterministic keyword heuristic over the input
  (labeled as such in summaries); a rating is reported only when the
  pasted text carries parseable ratings, else the UI shows "—" with an
  explanation. Quotes are the pasted items themselves and are passed
  through `verifyQuotes`, which drops any quote not found verbatim in
  the input. Counter angles are drafted (real LLM from the counted
  categories only, else a labeled template draft) — they introduce no
  new facts. No input → `{ available: false, reason: "আসল রিভিউ পেস্ট
  করুন — ডেটা ছাড়া রিপোর্ট তৈরি হয় না" }`; nothing is persisted.

### HF5 — Creative tools label their drafts
- `DeconstructedVideoScript` and the counter-ad response gain
  `origin: "ai" | "template"`; both web modals badge the result
  "AI খসড়া" / "টেমপ্লেট খসড়া". The video template's hook breakdown no
  longer asserts facts about the competitor's actual video — it is
  reworded as a labeled draft assumption ("খসড়া অনুমান … আসল ভিডিওটি
  দেখা হয়নি"), and the template scene copy no longer contains invented
  social-proof numbers (4.9★ / 5,000+ customers). Generation itself is
  unchanged (it works from the real ad's text). The `listAds` "winning"
  comment was also corrected: ≥14 days active is a longevity signal,
  not "proven high ROI".

### HF6 — Rules engine: no fake history
- `RulesEngine.getDefaultRules()` now ships `triggerCount: 0`,
  `lastTriggeredAt: null`, `recentExecutions: []` for every default
  rule. The seeded "Daraz stock-out EXECUTED" history is gone. The
  engine itself is unchanged (simulation stays labeled SIMULATED).

### HF7 — Cleanup script + downstream trace
- `scripts/cleanup-fabricated-competitor-ads.ts` (new): dry-run by
  default, `--apply` to delete. It selects `CompetitorAd` rows by the
  synthetic signatures — `externalAdId` prefix `tiktok_` or `bing_`
  (namespaces only the fabricating scanners ever produced; real Ad
  Library ids are numeric) and Google fallback rows (`google_` prefix
  with `raw.competitorName` present and no `raw.title`). The pure
  classifier was fixture-verified from the sandbox (synthetic shapes
  matched; real Meta/DDG shapes kept). **The script was NOT run against
  any live database from the sandbox** — the owner runs it on the
  deployment (dry-run first), before or alongside the next sync.
- Alert-engine trace: the only two creation sites of
  `provider: "alert-engine"` insights are in
  `CompetitorsService.scanWebsite` (price-drop ≥5% and stock-out), and
  both are driven exclusively by real `WebsiteScanner` observations
  (fetched JSON-LD/OG prices with the page URL as evidence). No other
  code creates alert-engine insights; `getAlertsFeed` and
  `apps/api/src/ai/tools.service.ts` only read them.
- Dossier trace: `exportDossier` derives from `listAds`,
  `listObservations`, `priceComparison`, `getAlertsFeed` and
  `listInsights` — all real-data stores. After HF1 no code path can
  persist a fabricated ad, and Google organic rows carry no
  `startedAt`, so they can never be counted as "winning"
  (`daysRunning` 0 < 14). Caveat: fabricated rows already persisted in
  a deployment DB before this package can still appear in
  ads/dossier until the owner runs the HF7 cleanup script with
  `--apply` — that is precisely what the script is for.
- `AlertDispatcher` only sends what it is given; the alert-settings
  test send is a labeled test message, unchanged.

## API shape changes (breaking, intentional)
- `GET …/seo-traffic` now returns the on-page audit object
  (`available`, `title`, `observedPhrases`, …) instead of traffic
  estimates.
- `POST …/seo-gap` returns `{ competitor, seoAudit, strategy, origin }`;
  `strategy.estimatedCtrBoost` is gone; unavailable site → 400.
- `GET …/funnel-audit` returns the detection report (`scanned`,
  `checkoutFieldCount`, `bundleHints`, `generalTips`, …).
- `GET …/reviews-mine` is replaced by `POST …/reviews-mine`
  `{ reviewsText }`, returning a discriminated union
  (`available: false | true`).
- `POST …/counter-ad` and `POST …/video-script` responses gain `origin`.
- `POST …/sync-multi-platform` response gains `unavailable`.

## Tests — the dishonest assertions were rewritten, not preserved
- New `multi-platform-scanner.spec.ts` (HF1): TikTok/Bing `[]` with no
  fetch attempted; Google failure/non-OK/zero-match `[]`; organic
  labeling + no invented start date.
- Service spec: syncMultiPlatform persists nothing for TikTok/Bing and
  reports them unavailable; a real Google result persists with the
  organic label; rules defaults have zero history (HF6); SEO report is
  observed-facts-only and honestly unavailable (HF2); seo-gap has no
  `estimatedCtrBoost` and refuses an unauditable site (HF2); funnel
  detection from fixture HTML + not-detected/unreachable honesty (HF3);
  review miner unavailable without input, counts/quotes/rating derived
  from pasted input, `verifyQuotes` drops invented quotes (HF4);
  counter-ad and video script carry `origin: "template"` under the dev
  provider and the video hook text is a labeled assumption (HF5).
- Gates: API jest competitors suites B1 35/35 → B2 38/38 → B3 40/40;
  full API suite at package end: 1580 passed / 2 failed of 1582 — both
  failures are in parallel tracks' uncommitted in-flight work
  (`CourierService` sync-notify count, `CustomersService.exportCsv`
  header), as are the 7 suite-level failures (inbox/courier/customers/
  workflows). No competitors suite fails, and this package touched no
  file those suites exercise. Web vitest 72–78/78 (suite grew
  mid-package from a parallel track); web `tsc --noEmit` clean; web
  `next build` green each batch. API `tsc` shows one pre-existing error
  in another track's uncommitted inbox work (`webchat.service.ts`:
  `parseCourierCard`) — untouched by this package.

## Honest limits
- No live Meta token and no live competitor sites were exercised from
  the sandbox: scanner/auditor/miner behaviour is fixture-proven, and
  Meta sync correctness still awaits the M30 live-verification sprint.
- The HF7 cleanup script has not been run against any database; its
  classifier was verified on fixture shapes only.
- No schema migration was needed or made.
- Everything is local commits only; nothing was pushed, per the
  owner's standing rule. Other tracks' uncommitted working-tree work
  was never staged or modified.
