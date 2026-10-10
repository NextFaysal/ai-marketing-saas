# Milestone 8 Acceptance Checklist - Competitor Intelligence

- [x] Prisma models: Competitor, CompetitorAd,
      CompetitorPriceObservation, CompetitorInsight + migration
      20261010070000. Schema total: 46 models.
- [x] Data sources are public and official only:
      (1) Meta Ad Library API (/ads_archive) for ads - the API, never
          website scraping of the Library;
      (2) the competitor's own public website for listed prices;
      (3) manual observations entered by the user.
      No logins, no profile scraping, no paywall bypass anywhere.
- [x] Ad Library sync: token resolution order FACEBOOK_AD_LIBRARY_TOKEN
      env, then the connected Meta integration's token (Milestone 5).
      Upsert by (competitor, archive id) - re-syncs update, never
      duplicate. Ads absent from a response are NOT marked stopped
      (absence under an ACTIVE filter is not proof).
- [x] Website scanner boundaries enforced in code: competitor's own
      host only, robots.txt fetched first and Disallow rules block
      paths (skips are reported to the user, never bypassed), honest
      crawler user-agent, no cookies/login/forms, capped page budget,
      prices read only from structured public markup (JSON-LD Product
      offers, OpenGraph/product price meta tags). A page without a
      published price yields nothing - prices are never estimated.
- [x] Evidence is mandatory at the data layer: every
      CompetitorPriceObservation carries sourceUrl + sourceType +
      observedAt. Manual entry without a source URL is rejected by
      the service, not just the form.
- [x] Price comparison matches own products to competitor observations
      by name, uses the latest observation, compares only same-currency
      pairs for the diff %, and shows "no evidence" rows for unmatched
      products instead of inventing a competitor price.
- [x] Insights are evidence-validated in the service:
      generateInsights refuses to run with zero collected evidence.
      LLM-proposed insights are kept only if they cite at least one
      evidence ref that actually exists in the bundle (unknown refs and
      ref-less insights are dropped and counted in the response -
      covered by a test with a deliberately hallucinating fake LLM).
      Dev-template insights are direct restatements of collected facts,
      each carrying its evidence link.
- [x] Honest limits stated in UI and docs: the Ad Library does not
      publish spend, reach (for most commercial ads), sales or market
      share, so the system never estimates them from ad counts.
- [x] Web: Competitors page (add competitor, Ad Library sync, website
      scan with robots-skip notice, ads list with Ad Library snapshot
      links, observations with source links, manual observation form
      requiring a URL, price comparison table with evidence dates,
      insights panel showing evidence for every insight).
- [x] Tests: 126 total passing (API 118, contracts 7, worker 1).
- [x] Builds: all packages + API + Next.js pass.
- [ ] Live Ad Library calls need a token whose Facebook user may need
      Meta identity confirmation depending on country - that is Meta's
      policy gate; website scans and manual observations work without it.

## Known limitations
- Ad Library coverage depends on Meta: very new ads can lag, and some
  countries require the identity-confirmed token noted above.
- Name matching for price comparison is word-overlap based; it prefers
  showing no match over a wrong match, and every match displays the
  observed product name so a human can spot a bad pairing.
- Scheduled recurring sync/scans (worker cron) reuse these services and
  arrive with the automation phase.
