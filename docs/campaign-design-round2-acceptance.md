# Campaign Design — Round 2 Acceptance (DX2/DX3-এর বাইরের মাত্রা)

Branch `campaign-next`, base = mini-fix HEAD `5c8b2f4`।
Owner নির্দেশ (2026-10-15): "Campaign Builder-এর design
আরেক round update করো"। Round 2 DX2/DX3-র পুনরাবৃত্তি নয় —
ওরা যেসব design মাত্রা ইচ্ছাকৃতভাবে ছোঁয়নি (keyboard/focus,
motion, print, sticky controls, notice pattern, glyph
consistency, relative time) শুধু সেগুলোই। **Verify-first**:
Phase A-তে প্রতিটা মাত্রা code-এ যাচাই করে HAVE/MISSING
ঠিক হয়েছে; build হয়েছে শুধু verified-missing গুলোতে।
**কোনো API change নেই, migration নেই** — পুরোটাই web।

## Commits

| Commit | কী |
| --- | --- |
| `0a13a38` | lib: `stepIndexForKey` (step rail keyboard map) + `relTimeBn` (bn-BD relative time) + tests 7/7 |
| `697bbab` | globals.css: `.r2-step-enter` + `@media print` block (scoped) |
| `9b4632b` | Builder: keyboard/focus, plan-loading skeleton, notice pattern, glyph sweep, print markers |
| `e72df28` | Hub: sticky filter card (desktop), relative time, notice role, list fade |
| `071087c` | Ad-accounts notice pattern + /r skeleton/print marker/fade |
| (this doc) | Round 2 acceptance |

## Phase A — Audit Table (dimension × verdict × evidence)

| # | Dimension | Verdict | Evidence (code) |
| --- | --- | --- | --- |
| 1a | Focus ring visible | **HAVE** | `globals.css:46` global `:focus-visible` outline; form controls-এ ring utilities component class-এ |
| 1b | Autosave indicator aria-live | **HAVE** | builder save indicator `role="status"` (DX2) |
| 1c | Step rail arrow-key navigation | **MISSING → built** | builder/hub/ad-accounts//r কোথাও `ArrowLeft/ArrowRight/onKeyDown` ছিল না |
| 1d | `aria-current` on active step | **MISSING → built** | step button (builder)-এ কোনো aria-current ছিল না |
| 1e | Focus moves on step change | **MISSING → built** | `goStep` শুধু `setActiveStep` করত; focus management ছিল শুধু @mention input আর ad-accounts scroll-focus-এ |
| 1f | Notice aria-live | **MISSING → built** | notice render গুলো plain `<p>`/`<div>`, কোনো role ছিল না |
| 2a | `prefers-reduced-motion` | **HAVE** | `globals.css:427` global block — সব animation/transition neutralise করে (নতুন animation-ও এর আওতায়) |
| 2b | Button/card transitions | **HAVE** | globals component classes (`.cbx-step-btn` transition .15s সহ) |
| 2c | Step-content transitions | **MISSING → built** | step body `hidden` toggle = instant; builder-এ transition utility 0; `fade-rise` keyframe ছিল কিন্তু এই surface গুলোতে অব্যবহৃত |
| 3a | Hub list skeleton | **HAVE** | campaigns-এ animate-pulse cards (DX2) |
| 3b | Builder summary-rail skeleton | **HAVE** | rail readiness `busy === "ready"` হলে `.cbx-skel` bars (DX2) — audit-এর প্রথম ধারণা সংশোধন করে এখানে HAVE ধরা হলো |
| 3c | Builder step-body / initial-load skeleton | **MISSING → built** | builder-এ skeleton markup শূন্য; deep-link `?id=` load-এর সময় `if (!plan)` create screen flash হতো |
| 3d | Ad-accounts loading | **HAVE** | `.skeleton` blocks + "লোড হচ্ছে…" (DX2) |
| 3e | Review on-demand panels | **HAVE** | designed text state + busy button (DX2) — skeleton বসানো busywork হতো |
| 3f | /r loading | **MISSING → built** | plain "লোড হচ্ছে..." text মাত্র ছিল |
| 4a | Builder step rail sticky | **HAVE** | `.cbx-step-rail { position: sticky }` |
| 4b | Summary rail sticky | **HAVE** | `.cbx-rail` ≥lg sticky (globals) |
| 4c | Hub list controls sticky | **MISSING → built** | hub-এ sticky ছিল শুধু wizard map-এ; plan list card-ভিত্তিক (কোনো `<table>`/`<thead>` নেই — "table header" এখানে controls bar-ই) |
| 4d | Week strip sticky | **NOT BUILT (ইচ্ছাকৃত)** | strip owner সিদ্ধান্তে hub-এর ওপরে; সেটাকে sticky করলে ছোট viewport-এর বড় অংশ স্থায়ীভাবে দখল হতো — controls sticky-ই আসল প্রয়োজন |
| 5 | Notice/toast pattern | **PARTIAL → aligned** | hub = canonical (✓ icon + dismiss + emerald block, দুই view-তে); builder + ad-accounts = plain green/red `<p>` (icon/dismiss/role ছাড়া) — straggler দুটো surface |
| 6 | Status iconography | **PARTIAL → aligned** | §5 trio ✓/⚠/⛔ প্রতিষ্ঠিত (DX2/DX3 chips); কিন্তু builder status string-এ ✅ (৬টি context), ❌ (১), ✗ (৪) straggler ছিল। App-এ কোনো icon font/lucide নেই — এই glyph গুলোই product-এর icon ভাষা। 🔄 (sync action) বনাম 🔁 (series entity) আলাদা অর্থ — **deliberate, রাখা হয়েছে**; panel-header emoji = panel identity (DX3 নজির) — ছোঁয়া হয়নি |
| 7a | Hub status pill | **HAVE** | shared `.cbx-pill` mapping (builder + hub একই) |
| 7b | updatedAt relative time | **MISSING → built** | দুই render-ই (list + resume card) শুধু absolute `toLocaleString("bn-BD")` ছিল — পরস্পরের সঙ্গে consistent, কিন্তু relative ছিল না |
| 7c | Row density | **HAVE** | card list p-4 + metric row ইতিমধ্যে compact (DX2/CN10); আর ঘন করা পড়ার সুবিধা কমাত |
| 8 | Print stylesheet | **MISSING → built** | চার surface + globals কোথাও `@media print`/`print:` ছিল না (grep 0) |

🚩 কোনো item-এই API লাগেনি — 🚩 তালিকা খালি।

## Phase B — যা build হয়েছে

**Keyboard + focus (builder)**
- Step rail-এ tabs pattern: `ArrowRight/ArrowLeft` ধাপ
  বদলায়, `Home/End` প্রথম/শেষ ধাপে — `stepIndexForKey`
  (lib, test 3/3) দিয়ে index, তারপর **একই `goStep`** —
  অর্থাৎ autosave আগে চলবেই; save ব্যর্থ হলে ধাপ বদলায়
  না, focus-ও নড়ে না। সফল হলে focus নতুন step button-এ।
- `aria-current="step"` active step button-এ।
- **আগের/পরের ধাপ** বোতামে সফল বদলের পর focus যায় নতুন
  ধাপের panel-এ (anchor container গুলো `tabIndex={-1}`) —
  বোতামটা নিজেই পরের ধাপে অদৃশ্য হতে পারে বলে focus
  body-তে হারিয়ে যেত, এখন যায় না।

**Motion**
- `.r2-step-enter` (বিদ্যমান `fade-rise` keyframe reuse,
  .18s): objective/audience/budget/review container-এ।
  `display:none → block` toggle-এ CSS animation নিজে
  থেকে restart হয় — JS ছাড়াই প্রতিটা ধাপ বদলে enter
  animation। Creative ধাপের আলাদা container নেই
  (hidden-mount design-এ audience/budget container-ই
  ভাগ করে) — সেখানে নতুন animation যোগ হয়নি, সৎভাবে
  এখানে বলা হলো। Hub plan list filter/tab/page বদলে
  keyed remount-এ একই fade; /r root-এ entrance fade।
  Reduced-motion: global block সব neutralise করে (2a)।

**Skeleton**
- Builder: deep-link plan load চলাকালে shell-আকৃতির
  skeleton (`planLoading` state, শুধু web) — create
  screen আর flash হয় না; load ব্যর্থ হলে আগের মতোই
  create screen + error (pattern-সহ) আসে।
- /r: report-আকৃতির skeleton (header block + KPI tiles +
  body); "লোড হচ্ছে..." লেখা sr-only হয়ে আছে।

**Stickiness (hub)**
- Search & Filters Card `lg:sticky lg:top-2 lg:z-30` —
  শুধু desktop-এ। Mobile-এ card লম্বা (~saved views +
  search + pills), sticky করলে viewport খেয়ে ফেলত —
  ইচ্ছাকৃত বাদ, এখানে লেখা রইল।

**Notice pattern (builder + ad-accounts)**
- Notice: hub-এর canonical block হুবহু — ✓ icon +
  `role="status"` + "✕ বন্ধ" dismiss, emerald block।
- Error: ⛔ icon + `role="alert"` + red block (dismiss
  নেই — error মিটলে নিজে থেকেই যায়, hub-এও error
  block-এর কোনো dismiss নজির নেই)। Hub-এর দুটো notice
  block-এ শুধু `role="status"` যোগ হয়েছে।
- সব `{notice}`/`{error}` লেখা verbatim — pattern শুধু
  মোড়ক।

**Glyph sweep (builder)**
- ✅→✓ (Readiness বোতাম, xdraft ফলাফল ×2, rail title,
  rail ready লাইন, rail not-run notice-র বোতাম-উল্লেখ —
  বোতাম label-এর সঙ্গে মিলিয়ে), ❌→⛔ (xdraft publish
  ব্যর্থ), ✗→⛔ (creative-health findings, xdraft
  readiness checks, clone blocker, rail checklist)।
  মোট ১০টি status string। শব্দ একটাও বদলায়নি — শুধু
  glyph। যাচাই: builder-এ ✅/❌/✗ এখন **০টি**।

**Relative time (hub)**
- `relTimeBn` (lib, test 4/4): এইমাত্র / N মিনিট আগে /
  N ঘণ্টা আগে / N দিন আগে (bn-BD digit), ৭ দিনের বেশি
  হলে absolute bn-BD date। List row + resume card
  দুটোতেই relative primary, **absolute datetime
  `title`-এ হুবহু আছে** — তথ্য হারায়নি।

**Print**
- `@media print` একটাই block (code audit নিচে):
  `.r2-print-doc` root-এ — in-doc `.cbx-step-rail`,
  `.cbx-rail`, `.cbx-mobile-bar`, সব `button` hide;
  background সাদা / লেখা কালো / shadow off / border
  হালকা; `.card`/`section`/`article`-এ
  `break-inside: avoid`; link কালো, underline ছাড়া।
  Builder root-এ বাড়তি `.r2-print-builder` — তা থাকলে
  `body:has(...)` দিয়ে dashboard chrome (aside /
  header / fixed mobile nav) hide। Builder page-এ
  নিজের `<header>`/`<aside>` নেই যাচাই করা — selector
  শুধু layout-এর গুলোতেই লাগে। /r-এর নিজের white-label
  `<header>` content — সেটি print হয় (chrome rule
  শুধু builder marker-এ)।
- Print-media CSS audit (code-এ যাচাই, screenshot নয়):
  globals-এ `@media print` ঠিক ১টি; rule inventory —
  chrome hide ৩ selector, in-doc hide ৪ selector,
  black-on-white ১ block (৫ property), break-inside
  ৩ selector, link reset ১; marker class builder
  root-এ ১বার, /r root-এ ১বার।

## Zero-loss প্রমাণ (baseline snapshot diff — DX2/DX3 পদ্ধতি)

Batch শুরুর আগে ৪ surface-এর endpoint set + string
set snapshot; শেষে একই script-এ diff:

| Surface | Endpoints | Strings lost | Classification |
| --- | --- | --- | --- |
| Builder | **lost 0, gained 0** | 8 | 2 = notice/error class string (pattern বদল); 6 = glyph swap (✅/❌/✗ → ✓/⛔) — শব্দ হুবহু |
| Hub | **lost 0, gained 0** | 0 | — (gained 3: sticky class, import, key template) |
| Ad-accounts | **lost 0, gained 0** | 2 | 2 = notice/error class string (pattern বদল) |
| /r page | **lost 0, gained 0** | 1 | root class string-এ marker যোগ (substring সম্প্রসারণ) |

**কোনো আসল label/feature হারায়নি।** Gained label
একটাই visible: notice dismiss-এর "✕ বন্ধ" (hub-এর
বিদ্যমান label-ই, দুই surface-এ এল)।

## Closing gates (নিজে চালানো)

| Gate | Result |
| --- | --- |
| Web vitest full | **285/285** (43 files; baseline 278 থেকে +7 = stepIndexForKey 3 + relTimeBn 4) |
| Web tsc | **0** |
| Monorepo build `pnpm -r build` | **exit 0** (সব package Done) |
| API / Prisma | **ছোঁয়া হয়নি** — gate প্রযোজ্য নয় |

## Honest limits

- **কোনো screenshot QA হয়নি** — কিছুই deploy হয়নি।
  Keyboard/focus/motion/print-এর আসল আচরণ code + test
  দিয়েই প্রমাণিত, browser-এ চোখে দেখে নয়। DX4
  checklist (`docs/campaign-screenshot-qa-checklist.md`,
  ৪৯ বাক্স) **UNCHECKED-ই আছে** — Round 2-র item গুলো
  deploy-এর পর সেই execution-এ যোগ করা উচিত।
- Print-এর `:has()` scoping আধুনিক Chromium/Safari/
  Firefox-এ চলে; পুরনো browser-এ chrome-hide rule
  নীরবে খাটবে না (in-doc rule গুলো খাটবে) — graceful।
- `focusStepPanel` programmatic focus — step panel-এ
  global `:focus-visible` ring দেখাতে পারে keyboard
  modality-তে; সেটি ইচ্ছাকৃত (কোথায় এলাম বোঝা যায়)।
- Creative ধাপে আলাদা enter animation নেই (ওপরে কারণ)।
- Week strip sticky নয় (4d — ইচ্ছাকৃত)।
- Push owner-gated; কিছুই live-proven নয়।
