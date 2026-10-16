# DX3 🚩 Mini-fix Acceptance — Funnel Wizard-এর Source Counts

Owner অনুমোদন 2026-10-15 ("1" = এখনই করো)। Base: DX3
শেষ HEAD `e50736c` (branch campaign-next, tree clean)।
Local commit only, **কোনো push হয়নি**। Schema/migration
নেই — Prisma ছোঁয়া হয়নি, fresh-PG প্রযোজ্য নয়।

## সমস্যা (DX3 acceptance-এর 🚩)

CN16 full-funnel wizard layer বাছাইয়ের সময় CN6 source
count দেখাতে পারেনি: `AudiencesService.sourceCatalog(orgId)`
org-scoped হলেও তার একমাত্র HTTP exposure ছিল plan-scoped
(`GET /campaign-plans/:planId/audience-studio`) — wizard
খোলার সময় কোনো plan থাকে না।

## যা ship হয়েছে

### API — একটি org-level read endpoint (commit `3eec2ba`)

`GET /organizations/:organizationId/campaign-plans/audience-sources`
(controller-এ `:planId`-এর আগে declared one-segment route;
controller-এর একই TenantGuard/RolesGuard + PermissionArea
"campaigns" — studio route-এর হুবহু একই guard পরিবেশ)।

Contract: `{ available: boolean, reason?: string, sources: SourceCatalogEntry[] }`

- `sources` = **হুবহু** `AudiencesService.sourceCatalog(orgId)`-এর
  output — `CampaignsService.audienceSourceCatalog()` একই
  method call করে; কোনো দ্বিতীয় counting implementation
  নেই (spec deep-equal দিয়ে pin করা, নিচে দেখুন)।
  Counts আসল row থেকে: buyers/recent purchasers = সফল
  Order-এর customer, product viewers = tracker-এর
  product_view event-এর চেনা visitor, cart abandoners =
  EC10-এর open AbandonedStoreCheckout — প্রতিটা entry-তে
  `available` + খালি হলে studio-র নিজের `reason`।
- Studio payload-এর `records`/`presets` এখানে নেই — ওগুলো
  plan-এর account/ad set-এর ধারণা, org level-এ অর্থহীন;
  শুধু `sources` + availability semantics carry হয়েছে।
- AudiencesService wired না থাকলে studio-র হুবহু একই
  সৎ অবস্থা: `{ available: false, reason: "AudiencesService
  এই Deployment-এ যুক্ত নেই", sources: [] }`।

### Web — wizard-এ selection-time counts (commit `6e6b5ca`)

- Hub page wizard খুললেই (`showFunnel`) নতুন endpoint
  fetch হয় — সম্পূর্ণ independent load; **fail হলে একটি
  সৎ amber line** ("সংখ্যা এখন লোড করা যাচ্ছে না —
  সংখ্যা ছাড়াই Wizard আগের মতোই চলবে") আর wizard
  হুবহু আগের মতো submit হয়, কোনো layer আটকায় না।
- Retargeting ও Retention checkbox-এর (layer-এর source
  choice) ঠিক নিচে per-source line, `lib/funnel-sources`
  দিয়ে shape করা: আসল count bn-BD-তে (money-bn-এর
  `fmtNumBn`) — যেমন "Product Viewers: ১,২৫০ জন";
  আসল শূন্য হলে §5 amber empty state ("০ জন — এই
  Source-এ এখনো কেউ নেই"); source gather করা না গেলে
  (contactCount null) "সংখ্যা পাওয়া যায়নি" — কখনো
  ০ সেজে দেখানো হয় না। Layer→source mapping API-র
  নিজের: retargeting = product_viewers + cart_abandoners,
  retention = buyers (prospecting CN6 source পড়ে না)।
- Wizard-এর সব বিদ্যমান field/call অপরিবর্তিত।

## Zero-loss diff (e50736c → HEAD, একই DX2/DX3 পদ্ধতি)

| Surface | ফল |
| --- | --- |
| API routes (campaigns.controller) | 97 → 98; diff = ঠিক +1 লাইন `@Get("audience-sources")`; lost 0, changed 0 |
| Hub `campaign-plans/*` calls | diff = ঠিক +1 `campaign-plans/audience-sources`; lost 0 |
| Plan-scoped studio | `audienceStudio` service body diff-এ অনুপস্থিত (0 mention) — endpoint ও তার consumer (builder) সম্পূর্ণ untouched |

## Specs

- API `dx3-flag-minifix.spec.ts` **6/6**: আসল row থেকে
  count (cancelled-only customer buyer নয়; anonymous
  visitor viewer নয়; recovered checkout abandoner নয়),
  studio sources-এর সঙ্গে deep-equal (একটাই computation),
  org isolation, খালি org-এ studio-র honest empty semantics
  (০ + reason verbatim), AudiencesService না থাকলে
  unavailable payload, controller delegation।
- Web `lib/funnel-sources.test.ts` **5/5**: bn-BD count,
  zero = empty state, null = unknown (কখনো ০ নয়),
  missing entry = unknown, layer→key mapping।

## Gates (সব serially)

| Gate | ফল |
| --- | --- |
| API jest `--runInBand` | **344/345 suites, 3427/3428 tests** — 4টি chunk-এ ভাগ করে চালানো (91+89+82+83; chunk যোগফল baseline 344/3422 থেকে ঠিক +1 suite/+6 tests = নতুন spec)। একমাত্র fail = পরিচিত **cx3-debounce flake**; solo re-run-এও হুবহু একই 17/18 (এই diff inbox ছোঁয়নি — NB3-তে pristine base-এও একই solo fail প্রমাণিত)। একক-process full run দুইবার sandbox OOM-এ SIGKILL হয়েছে (~307 suite PASS, 0 fail অবস্থায়) — তাই chunk পদ্ধতি; কোনো fail লুকানো হয়নি |
| Web vitest | **278/278** (42 files; baseline 273 + 5 নতুন) |
| tsc api / web | **0 / 0** |
| Monorepo build `pnpm -r build` | **exit 0, 7/7 Done** |
| Prisma / fresh-PG | ছোঁয়া হয়নি / প্রযোজ্য নয় (schema নেই) |

## Honest limits

- **কোনো screenshot QA হয়নি** — কিছুই deploy হয়নি;
  wizard-এর count line চোখে দেখা হয়নি, tsc/test দিয়েই
  প্রমাণিত। DX4 checklist deploy-gated-ই আছে।
- Count গুলো studio-র মতোই "এখনকার" gathered-contact
  count — Meta audience size নয়, estimateও নয়; wizard
  তা-ই বলে (Studio-র ভাষা হুবহু)।
- কিছুই live-proven নয়; push owner-gated।
