# Milestone 46 Acceptance — AI Assistant Deep Analysis Tools

Governing brief: docs/ai-assistant-remaining-brief.md (M46). Local commit
only — NO GitHub push (owner-only trigger rule, 2026-10-10 22:49).
No schema change in this milestone.

- [x] Five new READ-ONLY tools, all executed through the existing
      planner → sanitizePlan → ToolsService.execute path (org id always
      from the authenticated request, every call logged to AIAction):
      - `get_customer_segments` — RFM segments (reuses the messaging
        module's computeRfm: quintiles relative to the org's own
        customers, cancelled orders excluded, customers without orders
        excluded) with per-segment counts + revenue share.
      - `get_inventory_health` — out-of-stock / low-stock (≤5) /
        high-stock (≥100) from real `stockQuantity`; thresholds stated
        in the result; high stock labelled as a raw count, not a
        velocity judgement; when NO product has stock recorded the tool
        says so plainly (stockDataAbsent) instead of inventing health.
      - `get_courier_performance` — per-provider totals + delivery /
        return rates computed over TERMINAL shipments only; a provider
        with no terminal shipment gets null rates, never a guess.
      - `get_product_profit` — per-product units/revenue from real
        order items, COGS via the cost in effect on each order date
        (chooseCostForDate), gross profit, and the period's total ad
        spend allocated PRO-RATA BY REVENUE SHARE — labelled in the
        result as an allocation, not per-product tracked spend.
        Products with any cost-less item get cogsKnown=false and null
        profit figures. Unlinked items' revenue reported separately.
      - `compare_periods` — requested range vs the previous range of
        the same length, side by side, with % deltas for orders,
        revenue, ad spend and contribution profit.
      Max tool calls stays 3; sanitizePlan whitelists the new tools and
      their args (dates validated, profit limit capped at 25, stray
      args dropped).
- [x] Keyword planner: BN + EN phrases for each new tool, matched
      BEFORE the generic sales/profit/product rules so specific
      phrasing ("কোন পণ্যে সবচেয়ে বেশি লাভ হয়?", "per-product profit")
      reaches the deep tool first. Tests assert both languages for all
      five tools and the priority ordering.
- [x] Dev-template rendering for all five tools (BN + EN), formatting
      tool results only — no generated claims.
- [x] Web: the AI page's starter suggestions gained the new questions
      (product profit, customer segments, stock, courier performance).
- [x] Unit tests: new `tools.spec.ts` (11) — segment aggregation +
      shares summing to ~100%, honest empty states for segments /
      inventory / courier, inventory bucketing + untracked count,
      courier terminal-only rates (66.7/33.3), product profit math
      (dated COGS, unknown-cost nulls, pro-rata allocation ⅔ share),
      compare deltas + null-on-empty-previous, BN/EN template
      rendering. Planner spec gained sanitize + keyword coverage.
- [x] LIVE-FOUND BUG, fixed + regression-locked: the first live
      compare_periods answer showed "Infinity%" / "NaN%" deltas —
      AnalyticsService returns minor-unit fields as strings/BigInt, so
      the zero-check `p === 0` never fired. pct() now coerces via
      Number() and returns null for non-finite/zero baselines, and the
      unit-test stub now mimics the real string/BigInt shapes.
      Re-verified live: deltas render as "—" with the honest note.
- [x] Verification: full monorepo build green; full API suite
      67/67 suites, 456 tests pass (count at M46 close, includes the
      follow-on Gemini default-model spec). NOTE: one combined
      build+test run during this session reported 20 suites "failed
      to run" while 0 tests failed — that run overlapped concurrent
      file edits/builds from the parallel session; the clean re-run
      immediately after was fully green.
- [x] Live sandbox check (fresh tenant + seeded fixture rows in the
      sandbox DB only): all five questions routed to the right tools
      and answered from the seeded data — inventory named the
      out-of-stock and low-stock products, courier showed steadfast
      50% delivery / 50% return over 2 terminal shipments, segments
      returned the single buyer as "new" with 100% share, product
      profit returned BDT 400.00 gross (revenue 1000 − COGS 600) with
      the allocation label, compare rendered after the fix above.
- [ ] Real-LLM behaviour of the new tools (planner JSON choosing
      them) — covered separately by the real-LLM live verification
      follow-on (owner-provided test key, sandbox only).
