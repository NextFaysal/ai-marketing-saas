# Campaign Design+UX — DX3 Acceptance (Frontier-surface UX + Visual Polish)

Branch `campaign-next`, base = DX2-complete HEAD `10bcb8e`.
Spec: `docs/campaign-ux-architecture.md` (DX1) §1 J3/J4/J5
targets + §5 cross-cutting নিয়ম + §6 DX3 breakdown; plan-এর
DX3 section। DX2 যা বদলেছে তার ওপর দাঁড়িয়ে — পুনরাবৃত্তি
নেই। **কোনো API change নেই, migration নেই** — পুরোটাই
web presentation।

## Commits

| Commit | কী |
| --- | --- |
| `5f10e3b` | lib/money-bn (৳ bn-BD money + count helper) + tests 3/3 |
| `add8d1f` | J5: Review-step performance area → একটাই guided sequence |
| `b420d68` | J4: funnel wizard modal → full-screen flow + builder `?step=` landing |
| `2233e9f` | NB8 surfaces: xdraft manager grouping, simulator hierarchy, competitor rule box, /r campaign page |
| `03e18fb` | Sweep: status-colour semantics + money-bn সর্বত্র + bn-BD counts/dates |
| (this doc + checklist) | DX3 acceptance + DX4 checklist (`docs/campaign-screenshot-qa-checklist.md`) |

## J5 — Optimisation Review sequence (Builder, Review ধাপ)

Performance area-র panel order এখন একটাই ধারাবাহিক ক্রম,
stage heading সহ:

1. **১ · সারাংশ — কী অবস্থা (আগে সংখ্যা)**: Performance
   totals → Pacing → Breakdown (তিনটাই শুধু সংখ্যা, কোনো
   action নেই)।
2. **২ · মরা ও জেতা (CN7-এর হিসাবে)**: নতুন read-only
   তালিকা — **শুধু বিদ্যমান CN7 recommendations payload
   থেকে** derived: dead_ad_set → মরা (খরচ · impressions ·
   Conversion 0), budget_shift → জেতা (winnerName · CPA ·
   conversions · donor নাম)। কোনো নতুন হিসাব/threshold
   নয়; দুটোই না থাকলে সৎ খালি লাইন।
3. **৩ · Fatigue (CN7)**: Creative Insights (leaderboard +
   fatigue badge)।
4. **৪ · প্রস্তাব (CN7) — প্রমাণ আগে, Action পরে**: আগের
   সুপারিশ panel হুবহু (প্রতিটা card-এ evidence লাইন
   action-এর আগে — আগেও তাই ছিল, এখন ক্রমে বাঁধা)।

Report Link → WhatsApp Conversations → Guardrails →
Creative Health → বাকি Review panel আগের আপেক্ষিক ক্রমেই
sequence-এর পরে। সব conditional render, handler, endpoint,
threshold অপরিবর্তিত। Report-share select দুটো visible
label পেয়েছে (রিপোর্টের সময়সীমা / লিংকের মেয়াদ)।

## J4 — Funnel Wizard full-screen (Hub)

- Modal → **full-screen flow**: বাঁয়ে তিন layer-এর visual
  map (Prospecting = নতুন মানুষ / Retargeting = দেখেছে,
  কিনেনি / Retention = আগের Buyers — কে কোন layer-এ পড়ে,
  ↓ দিয়ে funnel ক্রম, sticky), ডানে **একই form** (সব
  field/handler/`submitFunnel` payload হুবহু)।
- **Incomplete choice এখন explicit**: দুটো optional layer-এর
  checkbox label-এই লেখা — Source খালি থাকলে layer টি
  অসম্পূর্ণ Ad Set হিসেবে তৈরি হবে; optional layer চালু
  থাকলে submit-এর আগে §5 amber notice (কেন + তৈরি হওয়ার
  পর কারণ কোথায় দেখা যাবে)।
- Result panel verbatim (layer status chip ইতিমধ্যে §5:
  complete সবুজ / incomplete হলুদ / failed লাল); Builder
  link এখন **Review ধাপে land** করে (`&step=4`; builder
  load-এ validated `?step=` param মানে — saver/autosave
  আচরণ অপরিবর্তিত)।

### 🚩 J4 source counts — API লাগবে, DX3-তে করা হয়নি

Task চেয়েছিল layer বাছাইয়ের সময় CN6 source count
দেখাতে। যাচাই: `AudiencesService.sourceCatalog(orgId)`
org-scoped হলেও তার **একমাত্র HTTP exposure plan-scoped**
(`GET /campaign-plans/:planId/audience-studio`) — wizard
চালু হওয়ার সময় কোনো plan থাকে না, তাই count পাওয়ার
কোনো বিদ্যমান পথ নেই। DX3-র "API change নয়" নিয়মে এটি
থামানো হলো। লাগবে: একটি ছোট org-level read endpoint
(শুধু sourceCatalog expose করবে; schema নেই, data
বিদ্যমান)। Owner চাইলে আলাদা mini-batch-এ হবে। ততদিন
wizard-এ count দাবি করা হয়নি — map শুধু বলে কে কোন
layer-এ পড়ে।

> **✅ RESOLVED (2026-10-15):** Owner "1" বলে mini-fix
> অনুমোদন দিয়েছেন — উপরের endpoint টি বানানো হয়েছে
> (`GET /campaign-plans/audience-sources`) আর wizard এখন
> layer বাছাইয়ের সময়ই count দেখায়। বিস্তারিত:
> docs/campaign-dx3-flag-minifix-acceptance.md

## NB8 surfaces polish

- **Cross-platform create form**: flat control row →
  skeleton contract অনুযায়ী group: প্ল্যাটফর্ম+Account /
  Google ধরন (PMax-এ keyword নেই + video/audience-signal
  যায় না — সেখানেই লেখা) / TikTok objective group।
  **LEAD_GENERATION-এর সীমা এখন choice-এর জায়গাতেই**
  (§5 amber notice, edit form-এর একই বাক্য) — শুধু
  readiness-তে নয়।
- **notCarried presentation**: create ফলাফলের notCarried
  এখন button-এর নিচে list আকারেও আসে (notice string
  হুবহু আগের মতোই)। Draft card-এ persisted তালিকার
  label status অনুযায়ী সৎ: created → "যা এই ধরনে
  যায়নি (notCarried)", blocked → "ঘাটতি" (API created
  draft-এও notCarried একই field-এ রাখে — যাচাই করে)।
  Edit form-এ group heading: সাধারণ / Asset Group —
  Performance Max / Responsive Search Ad / TikTok Ad।
- **Simulator card**: hierarchy উল্টে — সম্ভাব্য পরিসর
  (ফলাফল) আগে বড় করে, তারপর নমুনা+median, শেষে method
  ও note। Refusal এখন §5 designed notice (⛔ + API-র কারণ
  হুবহু + পরের পদক্ষেপ)। টাকা money-bn দিয়ে।
- **Competitor-response card**: no-copy নিয়ম এখন form-এর
  ওপরে distinct notice box (placement আগের মতোই —
  সব control-এর আগে; box হওয়ায় নিয়মটা চোখে পড়ে)।
- **Public /r campaign page**: শুধু campaign kind —
  সব টাকা fmtMoneyBn, counts fmtNumBn, বাংলা লাইনে
  leading-1.7; shared header-এর তারিখ bn-BD। Executive
  ও default kind **byte-identical** (ছোঁয়া হয়নি)।

## Sweep — status রঙের একটাই অর্থ (§5)

Audit করে বদলানো হয়েছে (প্রতিটা **meaning change**):

| Surface | আগে | পরে | কেন |
| --- | --- | --- | --- |
| Builder: Meta কার্যকর অবস্থা badge | `badge-success/muted/danger` — **এই class গুলো globals.css-এ নেইই**, badge রঙ ছাড়া render হতো | `badge-green/slate/red` | bug fix + §5 (ACTIVE=চলছে সবুজ, PAUSED=নিরপেক্ষ, অন্য=লাল) |
| Builder: Preflight severity | high/medium/low একই undefined class | high লাল / **medium হলুদ** / low সবুজ | medium-এর অর্থ বদল: নিরপেক্ষ → **মনোযোগ** (§5) |
| Builder + Hub: Approved | cbx pill-এ sky নীল dot; hub badge নীল | **সবুজ** (emerald) | approved = ঠিক আছে/প্রস্তুত — §5-এ নীলের কোনো অর্থ নেই |
| Builder: "AI Draft" tag | হলুদ | **বেগুনি** | provenance tag, মনোযোগ নয় — হলুদ শুধু attention-এর জন্য সংরক্ষিত (series provenance chip-এর সঙ্গে মিলিয়ে) |
| Ad-accounts: "আগে থেকেই কানেক্টেড" chip | নীল | **সবুজ** | connected = ok অবস্থা |

যাচাই করে **রাখা হয়েছে** (বদলানো হয়নি): pending_approval
হলুদ, series paused হলুদ (held — §5-এর উদাহরণেই আছে),
platform restricted হলুদ (disabled লাল — জোড়াটা সুসংগত),
disconnected slate+লাল লেখা, xdraft/funnel/readiness
chip গুলো (ইতিমধ্যে §5), panel গুলোর accent রঙ (sky/
violet/rose ইত্যাদি — এগুলো panel পরিচয়, status নয়),
transient "publishing" বেগুনি badge (চলমান প্রক্রিয়া,
ফলাফল-অবস্থা নয়), clone outcome-এর sky লেখা (✓-সহ
outcome category, status chip নয়)। CTWA exemplar
notice (NB6) **হুবহু অপরিবর্তিত**।

**Money (§5)**: তিন page + /r campaign block-এ locally
format হওয়া প্রতিটা টাকার অঙ্ক এখন `lib/money-bn`
(৳ + bn-BD grouping)। Counts (impressions/clicks/size/
estimate/reach) ও তারিখ (publish log, CAPI log, hub
updatedAt) bn-BD। **একটাই documented ব্যতিক্রম**: AI
Copy-র product dropdown-এ দাম contracts `formatMinor`
দিয়েই থাকে — কারণ সেটি product-এর নিজের currency
argument দিয়ে format হয় (সবসময় BDT নয়; ৳ বসালে ভুল
হতো)। API থেকে আসা pre-formatted string কখনো re-format
করা হয়নি।

**NB6/NB7 alignment যাচাই**: CTWA picker (exemplar
অপরিবর্তিত), Welcome editor (grouped panel + heading
আগেই ছিল; note-এ leading-1.7 যোগ), experiment panel
(amber সতর্কতা §5-মাফিক), series panel/card (chip §5) —
behaviour change কোথাও নেই।

## Zero-loss প্রমাণ (DX2 পদ্ধতি — baseline snapshot diff)

Batch শুরুর আগে ৪ surface-এর endpoint set + JSX
label/string set snapshot; শেষে একই পদ্ধতিতে diff:

| Surface | Endpoints | Labels/Strings |
| --- | --- | --- |
| Builder | **lost 0, gained 0** | lost 15টি diff line — সব classified (নিচে) |
| Hub | **lost 0, gained 0** | একই |
| Ad-accounts | **lost 0, gained 0** | একই |
| /r page | **lost 0, gained 0** | একই |

Diff line গুলোর classification: (ক) class-string বদল
(badge সংশোধন, chip রঙ, leading যোগ, wizard container) —
visible text অপরিবর্তিত; (খ) format-expression fragment
(formatMinor → fmtMoneyBn — render হওয়া text একই figure,
§5 format-এ); (গ) ইচ্ছাকৃত text সম্প্রসারণ যেখানে মূল
অংশ substring হিসেবে আছে যাচাই করা — wizard layer
label দুটো (incomplete শর্ত যোগ), result link ("Review
ধাপে" যোগ), competitor নিয়ম (হুবহু, 🛡 prefix সহ box-এ),
simulator refusal (API-র কারণ হুবহু + পরের পদক্ষেপের
লাইন যোগ)। **কোনো আসল label/feature হারায়নি।**

## Closing gates (নিজে চালানো)

| Gate | Result |
| --- | --- |
| Web vitest full | **273/273** (41 files; DX2-র 270 থেকে +3 = money-bn tests) |
| Web tsc | **0** |
| Monorepo build `pnpm -r build` | **exit 0** (সব package Done) |
| API | **ছোঁয়া হয়নি** — API gate প্রযোজ্য নয় |
| Prisma / migrations | ছোঁয়া হয়নি |

## DX4 — প্রস্তুত, execution বাকি

`docs/campaign-screenshot-qa-checklist.md` তৈরি: J1–J5
× desktop/mobile + Frontier/design surfaces + §5
cross-cutting যাচাই — **৪৯টি বাক্সের সব UNCHECKED**।
Execution deploy-gated (owner push + Redeploy + seeded
demo org) — CN12 session-এর সঙ্গে করা যাবে।

## Honest limits

- **কোনো screenshot QA হয়নি** — কিছুই deploy হয়নি;
  step sequence/wizard/money format-এর আসল চেহারা code
  + test দিয়েই প্রমাণিত, চোখে দেখে নয়। DX4 checklist
  UNCHECKED-ই আছে।
- J4 source counts দেখানো যায়নি (ওপরে 🚩) — org-level
  read endpoint ছাড়া সম্ভব নয়; DX3-র no-API নিয়মে
  থামানো হয়েছে, লুকানো হয়নি।
- মরা/জেতা তালিকা শুধু CN7 recommendations payload
  থেকে আসে — recommendations load না করলে stage-টাই
  আসে না (আগের panel গুলোর মতোই on-demand আচরণ)।
- Panel accent রঙ গুলো (প্রতি panel-এর নিজের hue)
  status semantics-এর বাইরে রাখা হয়েছে — DX1 §5
  status রঙ নিয়ে, panel পরিচয় নিয়ে নয়।
- Push owner-gated; কিছুই live-proven নয়।
