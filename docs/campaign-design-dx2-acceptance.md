# Campaign Design+UX — DX2 Acceptance (Builder + Hub পুনর্গঠন)

Branch `campaign-next`, base = Frontier-complete HEAD
`547fb0c`. Spec: `docs/campaign-ux-architecture.md` (DX1,
এই batch-এর প্রথম commit-এ repo-তে verbatim এসেছে) §1–§6 +
§7-এর owner সিদ্ধান্ত দুটো — (1) ধাপ বদলালে **autosave**,
আলাদা save বোতাম নয়; (2) "এই সপ্তাহে" সারি **hub-এর
একদম ওপরে**। দুটোই হুবহু মানা হয়েছে।

## Commits

| Commit | কী |
| --- | --- |
| `1434c3c` | DX1 architecture doc → `docs/campaign-ux-architecture.md` (verbatim) |
| `c6156de` | একমাত্র 🚩 API touch: `GET campaign-plans/week-summary` (নিচে verdict) + spec 4/4 |
| `75b1620` | Ad-accounts: Meta connect form page-এর ওপরে + state design + responsive |
| `ef6820a` | Builder: step-shell + autosave + summary rail + lib/step tests |
| `2d3111d` | Hub: week strip + view tabs + resume card + state design |
| (this doc) | DX2 acceptance |

## 🚩 Verdict — aggregate endpoint: BUILD হয়েছে (একটাই, read-only)

DX1 §6-এর দুটো 🚩 DX2-র শুরুতেই যাচাই হয়েছে:

- **(খ) updatedAt — API লাগেনি।** `listPlans`-এর `planJson`
  পুরো plan row spread করে, তাই `updatedAt` আগেই list
  payload-এ ছিল। Resume card বিদ্যমান paged list
  (`?page=1&pageSize=3&status=draft`, server `updatedAt desc`)
  দিয়েই তৈরি।
- **(ক) Weekly aggregate — সত্যিই reachable ছিল না, তাই
  বানানো হয়েছে।** `portfolio/totals` all-time aggregate
  (কোনো date window নেই), CN7 recommendations ও Phase-K
  fatigue শুধু per-plan endpoint (org-wide count মানে
  published plan প্রতি ২টা call), আর week-over-week spend
  এর কোনো dated org-wide source-ই নেই। নতুন
  `GET /organizations/:orgId/campaign-plans/week-summary`
  সম্পূর্ণ read-only, **কোনো schema/migration নেই**, আর
  সব সংখ্যা বিদ্যমান read-model থেকেই: campaign-level
  DailyAdMetric rows (portfolioTotals-এর filter-ই) থেকে
  rolling 7d vs আগের 7d spend currency অনুযায়ী (মেশানো
  হয় না), `planRecommendations` + `planCreativeInsights`
  reuse করে count (সবচেয়ে বেশি ২৫টি published plan —
  bound-টা response-এ `plansChecked` হিসেবে বলা আছে,
  লুকানো নয়), আর OfflineConversionSetting/Log থেকে
  loop-এর configured / last-success / failed-7d। Spec:
  `dx2-week-summary.spec.ts` 4/4 (currency separation,
  window বাদ যাওয়া, top-plan deep-link data, honest
  empty org)।

## Builder — step-shell + autosave

- ৫টা anchor এখন **আসল ধাপ**: এক সময়ে একটাই step দৃশ্যমান।
  যেসব section-এ uncontrolled `defaultValue` form আছে
  (ad set/ad edit, budget/cap/launch inputs, xdraft edit,
  schedule/daypart) সেগুলো **hidden-mounted** — unmount হলে
  লেখা-কিন্তু-unsaved মান হারাত; page-level state-ওয়ালা
  section গুলোতেও সামঞ্জস্যের জন্য একই পদ্ধতি। Mobile-এ
  step list horizontal chip, rail content-এর নিচে।
- **Per-step readiness chip**: বিদ্যমান readiness endpoint-এর
  ১২টি check key-র ওপর lib-এ `STEP_CHECK_KEYS` map
  (Objective: account/events/lead_form/structure/whatsapp ·
  Audience: targeting/schedule/funnel · Budget: budget ·
  Creative: policy/landing/creative · Review: সব)। Chip:
  error → ⛔, warn → ⚠, সব ok → ✓, কখনো fetch হয়নি → "–"।
  Readiness এখন plan load-এ ও প্রতিটি সফল autosave-এর
  পর fetch হয় (একই বিদ্যমান endpoint)।
- **Summary rail (স্থায়ী)**: plan নাম/objective/status,
  মোট দৈনিক + lifetime budget (readiness.budget থাকলে
  সেখান থেকে, নইলে plan-এর ad-set যোগফল — নতুন সংখ্যা
  বানানো হয়নি), CN2 mode label, published হলে pacing,
  readiness counts, save-state indicator, CB3 `AdPreview`
  (selected ad, না থাকলে প্রথম ad — একই component;
  step-এর নিজের preview অক্ষত)।
- **Autosave (owner সিদ্ধান্ত)**: `lib/campaign-step-shell.ts`-
  এ saver registry। Dirty ধাপ ছাড়লে সেই ধাপের **আগের
  save বোতামগুলোর হুবহু একই apiFetch** চলে — ad-set PATCH,
  published schedule POST, dayparting POST, budget-mode/
  campaign-budget PATCH, cap PATCH, live budget POST,
  ad PATCH, xdraft PATCH। সফল হলেই কেবল "সব সেভ হয়েছে ·
  HH:MM" (bn-BD); ব্যর্থ হলে "⚠ সেভ হয়নি — আবার চেষ্টা
  করুন", ধাপেই থাকে, retry pending ধাপে resume করে।
  **কোনো optimistic "saved" নেই।**
- **ইচ্ছাকৃতভাবে autosave হয়নি (তালিকা)**: Objective ধাপে
  কোনো save বোতামই নেই (plan basics PATCH এই page-এ নেই;
  একমাত্র plan PATCH দুটি Budget ধাপে — wired)। Create/
  action form গুলো — New Ad Set, Add Ad, Lead Form তৈরি,
  Retargeting preset, AI Copy, Variant, Studio audience
  তৈরি — save নয়, create: অর্ধেক-ভরা ফর্ম autosave করলে
  অসম্পূর্ণ entity তৈরি হতো, তাই নয়। Submit/Approve/
  Publish, comments, versions, experiments, series,
  guardrails, clone — action-only, কখনো navigation আটকায়
  না। এদের form state page-level, ধাপ বদলালে হারায় না।
- **J3**: Destination picker এখন Objective ধাপে — **একই
  `adSetForm` state**-এ bound (দ্বিতীয় divergent choice
  নয়); WhatsApp connection select ও CTWA notice হুবহু।
- Post-publish panel গুলো (Performance, Report Link,
  WhatsApp Conversations, Pacing, Breakdowns, Insights,
  Recommendations, Guardrails, Health, Experiments,
  Series, XDrafts, Clone, Comments/Timeline, Versions,
  Publish Log) Review ধাপে থাকে — সব reachable।
- State design: estimate-unavailable, readiness-not-run,
  pacing no-data, studio/conversations unavailable এখন
  designed notice (icon + আগের সৎ লেখা verbatim + পরের
  পদক্ষেপ)। CTWA exemplar notice ছোঁয়া হয়নি।

## Hub — week strip + tabs + resume

- **"এই সপ্তাহে" strip header-এর ঠিক নিচে** (owner
  সিদ্ধান্ত): খরচ (currency অনুযায়ী ৭দিন vs আগের ৭দিন,
  ▲/▼ % আসল figure থেকে; আগের সপ্তাহ ০ হলে % এর বদলে
  "আগের সপ্তাহে খরচ ছিল না"; data না থাকলে invented
  zero নয় — সৎ লাইন), সুপারিশ count + top plan deep-link,
  fatigue count + top plan, conversion loop (configured
  না হলে designed state + "সেটআপ করুন"; হলে last success
  + failed badge)। Loading-এ skeleton, ব্যর্থতায় slim
  retry row — বাকি hub অচল হয় না। Deep-link page-এর
  বিদ্যমান pattern-ই (`/dashboard/campaign-builder?id=…`)।
- **View tabs**: পরিকল্পনা / ক্যালেন্ডার / পোর্টফোলিও।
  Plans = আগের পুরো listing flow (alerts, metric cards,
  status tabs all/live/approval/blueprints, saved views,
  bulk, pagination, series card) হুবহু; Calendar = CN10
  launch calendar (verbatim move); Portfolio = CN8 totals
  + NB8 simulator + competitor-response (verbatim move;
  alerts দুই view-তেই render হয় যাতে ওদের notice নীরব
  না হয়)। Saved view apply যেকোনো view থেকে Plans-এ
  সঠিকভাবে নিয়ে আসে।
- **"অসমাপ্ত কাজ" resume card**: সর্বশেষ সম্পাদিত ৩টি
  draft — নাম, updatedAt (bn-BD), adSetCount, "চালিয়ে
  যান →"। Draft না থাকলে/ fetch ব্যর্থ হলে card-ই দেখায়
  না (শূন্য noise নয়)।
- State design: plan list loading skeleton (আগে EmptyState
  ঝলক দিত), series-empty ও portfolio-empty designed state।

## Ad-accounts — ordering + states + responsive

- **Meta connect form page-এর একদম ওপরে** (header-এর পরই) —
  block fields/handlers/`id="connect-meta"` anchor সহ
  হুবহু; reconnect-এর scroll/focus আগের মতোই land করে।
  বাকি form গুলো (create-account, google, tiktok) আগের
  জায়গায়।
- State design: accounts loading skeleton (আগে ছিলই না —
  EmptyState flash হতো), filter-empty + "সব ফিল্টার মুছুন"
  action, CAPI ও Server-Conversions not-configured amber
  notice + scroll-to-form action, no-logs notice — সব
  honest wording verbatim, "সেটআপ হয়নি" দৃশ্যত
  not-configured-ই থাকে।
- Responsive: form grid 1-col থেকে collapse, CAPI table
  overflow-x-auto, সব button ≥40px, Bengali leading-1.7।

## Zero-loss প্রমাণ (baseline snapshot পদ্ধতি)

Batch শুরুর আগে তিন page-এর endpoint set + JSX label set
snapshot নেওয়া হয়েছিল; শেষে একই পদ্ধতিতে diff:

| Surface | Endpoints | JSX labels |
| --- | --- | --- |
| Builder | **lost 0, gained 0** | lost 0* |
| Hub | **lost 0**, gained ঠিক ২টি ইচ্ছাকৃত (week-summary + resume list call) | **lost 0** |
| Ad-accounts | **identical (lost 0, gained 0)** | **lost 0** |

*Builder-এ ৫টি text-node diff এসেছিল — ৪টি redesigned
notice block (estimate-unavailable / readiness-not-run /
studio-unavailable / pacing-no-data; substring হুবহু আছে
যাচাই করা) + ১টি baseline regex-এর code-fragment false
positive। কোনো আসল label হারায়নি।

## Closing gates (সব নিজে চালানো)

| Gate | Result |
| --- | --- |
| API jest `--runInBand` full (NODE_OPTIONS 4GB) | **344/344 suites, 3422/3422 tests, exit 0** (NB8-এর 343/3418 থেকে +1 suite/+4 tests = week-summary spec ঠিক; cx3 flake আসেনি) |
| Web vitest | **270/270** (40 files; 260 থেকে +10 = step-shell lib tests) |
| tsc web / api | **0 / 0** |
| Monorepo build `pnpm -r build` | **exit 0** (সব package Done) |
| Prisma / migrations | **ছোঁয়া হয়নি** — fresh-PG প্রযোজ্য নয় |

## Honest limits

- **কোনো screenshot QA হয়নি** — কিছুই deploy হয়নি;
  step-shell/autosave/strip-এর আসল চেহারা ও mobile আচরণ
  code + test দিয়েই প্রমাণিত, চোখে দেখে নয়। সেটা DX4-এর
  কাজ, deploy-এর পর (checklist UNCHECKED-ই থাকবে)।
- Autosave শুধু edit-form save গুলোতে wired; create-form
  গুলোর অর্ধেক-ভরা state autosave হয় না (ওপরে কারণসহ
  তালিকা) — ধাপ বদলালে সেগুলোর state হারায় না (page-level),
  কিন্তু server-এও যায় না যতক্ষণ না user create চাপে।
- Hidden-mounted step গুলো DOM-এ থাকে — দীর্ঘ page-এর
  DOM size আগের মতোই; দৃশ্যমান জটিলতাই কমেছে, DOM নয়।
  (Uncontrolled form-এর unsaved লেখা রক্ষা করতেই এই সিদ্ধান্ত।)
- Week strip-এর recommendation/fatigue count সর্বোচ্চ
  ২৫টি published plan পর্যন্ত (bound response-এ বলা আছে);
  তার বেশি published plan থাকলে count আংশিক — UI লাইনে
  `plansChecked` দেখায়।
- Migration কোনো real DB-তে run হয়নি (DX2-তে migration
  ছিলই না); কিছুই live-proven নয়; push owner-gated।
