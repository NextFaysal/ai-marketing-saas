# Campaign Screenshot QA Checklist — DX4

Campaign Design+UX package-এর শেষ phase (plan:
Campaign-Design-UX-Plan-2026-10-15.md, DX4)। এই checklist
এখনই তৈরি — **execution deploy-এর পর** (owner-এর push +
Dokploy Redeploy লাগবে; CN12 live session-এর সঙ্গে করা
যায়)। ততদিন প্রতিটা বাক্স **UNCHECKED**-ই থাকবে: কোনো
design-ই "চোখে দেখে যাচাই হয়েছে" দাবি করা যাবে না
যতক্ষণ না এই checklist-এর screenshot হাতে আসে।

## Execution নোট

- **পরিবেশ:** deploy হওয়া আসল app (app.qosprey.com),
  seeded **demo org** দিয়ে walkthrough — production
  path-এ কোনো mock নয়; demo org শুধু QA-র জন্য (UX
  roadmap-এর UX0 নজির)। Demo org-এ থাকতে হবে: কমপক্ষে
  ১টি published plan (metric rows সহ), ১টি draft plan,
  CTWA destination-ওয়ালা ১টি ad set, ১টি funnel plan
  (একটি incomplete layer সহ), ১টি series (একটি held
  instance সহ), ১টি experiment (read-back সহ), ১টি করে
  Google Search / PMax / TikTok cross-platform draft
  (একটি blocked), simulator-এর জন্য যথেষ্ট metric data
  + একটি খালি-objective (refusal দেখতে)।
- **আকার:** প্রতিটা item দুই আকারে — Desktop (1440px)
  ও Mobile (390px)। Screenshot ফাইলের নাম:
  `dx4-<journey>-<surface>-<desktop|mobile>.png`।
- **যা খুঁজব:** overflow/ভাঙা layout, বাংলা লেখা wrap ও
  line-height, status রঙের অর্থ (§5: সবুজ/হলুদ/লাল),
  ৳ bn-BD সংখ্যা, tap target ≥40px, step-shell-এ rail
  ভাঁজ, wizard-এ layer map sticky আচরণ।
- **ত্রুটি পেলে:** এই ফাইলেই item-এর পাশে নোট + আলাদা
  fix commit; checklist নিজে সম্পাদনা করে বাক্স টেক
  করা যাবে শুধু screenshot দেখার পর।

## J1 — প্রথম Campaign

- [ ] Builder step-shell: ৫ ধাপ একে একে (desktop)
- [ ] Builder step-shell: mobile-এ horizontal chip + rail নিচে
- [ ] Per-step readiness chip (✓/⚠/⛔/–) প্রতিটা ধাপে
- [ ] Summary rail: budget (mode label সহ), pacing, AdPreview
- [ ] Autosave অবস্থা: "সেভ হচ্ছে…" → "সব সেভ হয়েছে · সময়"
- [ ] Autosave ব্যর্থতা: "⚠ সেভ হয়নি" + ধাপে থেকে যাওয়া
- [ ] Objective ধাপে destination picker (Website/WhatsApp/Lead)
- [ ] Hub "অসমাপ্ত কাজ" resume card থেকে builder-এ ফেরা
- [ ] Ad-accounts: Meta connect form page-এর একদম ওপরে (desktop + mobile)

## J2 — সাপ্তাহিক চেক (Hub)

- [ ] "এই সপ্তাহে" strip: খরচ ৭দিন vs আগের ৭দিন (currency আলাদা)
- [ ] Week strip: আগের সপ্তাহ ০ হলে % ছাড়া সৎ লাইন
- [ ] Week strip: সুপারিশ + fatigue count ও top-plan deep link
- [ ] Week strip: conversion loop not-configured designed state
- [ ] Week strip: loop configured — last success + failed badge
- [ ] Week strip loading skeleton / ব্যর্থতায় slim retry row
- [ ] View tabs: পরিকল্পনা / ক্যালেন্ডার / পোর্টফোলিও বদল
- [ ] Mobile-এ strip card গুলো এক column-এ ভাঙে কিনা

## J3 — WhatsApp Campaign (CN13)

- [ ] CTWA destination picker: connected নম্বর select
- [ ] CTWA notice (কোনো connected WhatsApp নেই) — exemplar state
- [ ] WhatsApp Welcome editor (greeting/prefill/ice breaker)
- [ ] Performance-এ conversations started (label সহ)

## J4 — Full-funnel Wizard (CN16)

- [ ] Wizard full-screen: বাঁয়ে layer map, ডানে form (desktop)
- [ ] Wizard mobile: map ওপরে, form নিচে — scroll আচরণ
- [ ] Layer checkbox label-এ অসম্পূর্ণ-হওয়ার শর্ত স্পষ্ট
- [ ] Optional layer চালুতে amber notice
- [ ] Result: layer ফলাফল (complete সবুজ / incomplete হলুদ / failed লাল)
- [ ] Result link → builder Review ধাপে land করে

## J5 — Optimisation Review (Builder)

- [ ] ক্রম: ১ সারাংশ → ২ মরা ও জেতা → ৩ Fatigue → ৪ প্রস্তাব
- [ ] মরা ও জেতা তালিকা: dead (খরচ/imp/conv) + winner (CPA/conv) evidence
- [ ] প্রস্তাব card: প্রমাণের লাইন action-এর আগে
- [ ] Fatigue badge (লাল) creative insights-এ
- [ ] Report Link panel: সময়সীমা/মেয়াদ label + তৈরি link

## Frontier / Design surfaces

- [ ] Cross-platform create form: Google/TikTok group আলাদা
- [ ] TikTok objective-এর পাশে LEAD_GENERATION সীমার notice
- [ ] Create ফলাফলে notCarried তালিকা (list আকারে)
- [ ] Draft card: created হলে "যা যায়নি", blocked হলে "ঘাটতি" label
- [ ] Draft edit form: group heading (সাধারণ/Asset Group/RSA/TikTok)
- [ ] Budget Simulator: পরিসর আগে, নমুনা/পদ্ধতি পরে
- [ ] Budget Simulator refusal: §5 notice (কারণ + পরের পদক্ষেপ)
- [ ] Competitor-response: নিয়মের notice box form-এর ওপরে
- [ ] Experiment panel: verbatim read-back + significance note
- [ ] Series panel/card: status chip (সক্রিয় সবুজ/বিরতি হলুদ/শেষ slate), held note
- [ ] Public /r campaign report: ৳ bn-BD সংখ্যা, pacing লাইন (desktop + mobile)

## §5 Cross-cutting যাচাই

- [ ] Status রঙ: approved সবুজ dot (cbx pill + hub badge)
- [ ] Meta কার্যকর অবস্থা badge: ACTIVE সবুজ / PAUSED slate / অন্য লাল
- [ ] Preflight severity: high লাল / medium হলুদ / low সবুজ
- [ ] "AI Draft" tag বেগুনি (হলুদ নয়)
- [ ] টাকার অঙ্ক সব জায়গায় ৳ + bn-BD (builder/hub/ad-accounts//r)
- [ ] বাংলা body text line-height 1.7 — লম্বা অনুচ্ছেদে পড়তে সহজ
