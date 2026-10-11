# Inbox Design v3 — Deep Polish (Plan)

**প্রসঙ্গ:** মালিকের নির্দেশ ২০২৬-১০-১২ ০১:১৫ +06 — "Design-এ আর কী improve করা যায়, আরও modern করো।"
Design v2 (fe0ebe0) header/list/thread/composer/context-hero/board/media আধুনিক করেছে; এই প্যাকেজ বাকি
পুরনো অংশগুলো — একই দিনের code audit-এ যাচাই করা (page.tsx এখন 2,301 লাইন)।

## Audit — v2-এর পর যা এখনো পুরনো

1. **Manage ভিউ পুরোটাই পুরনো (~1817–2255):** Auto-Reply সেটিংস, আমার পারফরম্যান্স ও স্বাক্ষর,
   টিম রিপোর্ট, টিম ও এজেন্ট, চ্যানেল কানেক্ট ফর্ম, Quick Reply, WhatsApp Template — সব plain
   `.card` + `.input`, কোনো v2 primitive নেই, সেকশনগুলো একটানা লম্বা scroll-এ হারিয়ে যায়।
2. **Modal পুরনো (2256 palette, 2280 shortcuts):** plain সাদা বাক্স, backdrop blur নেই, shortcut-এ `<kbd>` স্টাইল নেই।
3. **Loading সব জায়গায় শুধু লেখা:** "লোড হচ্ছে..." (board 1060, settings 1916, report 2013, agents 2040,
   profile 2183) — globals.css-এ `.skeleton` থাকলেও ইনবক্সে একটাও ব্যবহার হয় না।
4. **Thread canvas সমতল:** timeline-এ (1419) সব message সমান ফাঁকে; পরপর একই দিকের message-এর
   grouping নেই; note (1430) ও AI Draft কার্ড (1490) পুরনো বাক্স; thread-এর পেছনে কোনো canvas tint নেই।
5. **List-এর দ্বিতীয় filter সারি পুরনো:** channel/assignee select, অপঠিত/Spam/বাল্ক toggle, tag input —
   v2 শুধু folder chip হেডারে নিয়েছিল, এই সারি আগের `.input`/slate pill-ই রয়ে গেছে।
6. **Context panel-এর নিচের অর্ধেক:** দায়িত্ব ও Tag (1729), notes, chat-order ফর্ম — basic কার্ড, v2 hero-র সাথে মেলে না।

## Scope — কঠোর সীমা (v2-এর মতোই)

- **শুধু apps/web:** inbox `page.tsx`, `globals.css` (additive v3 primitives), প্রয়োজনে `inbox-extras.tsx`।
- কোনো API/schema/lib-logic/handler/endpoint/payload/state বদল নয় — শুধু markup/class ও pure display helper।
- কোনো invented metric নয়; skeleton ঠিক সেই জায়গায় যেখানে এখন "লোড হচ্ছে" লেখা আসে (একই condition)।
- Working tree-র অকমিটেড CX/AG কাজ ছোঁয়া নয়; কমিটে শুধু নিজের ফাইল। Local commit only — push নয়।

## Design v3 — ৬টি পলিশ

1. **Manage v2:** প্রতিটি সেকশন `.manage-card` (আইকন-টাইল হেডারসহ); ওপরে sticky sub-nav chip সারি
   (সেটিংস / পারফরম্যান্স / রিপোর্ট / টিম / কানেক্ট / Quick Reply) — ক্লিকে সংশ্লিষ্ট সেকশনে smooth scroll
   (শুধু id anchor + scrollIntoView, কোনো state বদল নয়)। Form row-গুলো `.setting-row` (label বামে, control ডানে, helper নিচে)।
   টিম রিপোর্টের সংখ্যাগুলো `.ctx-tile` ধাঁচের stat tile-এ (আসল report data-ই)।
2. **Modal v2:** palette ও shortcuts — `.modal-shell` (rounded-3xl, shadow-pop, backdrop `bg-slate-900/50 backdrop-blur-sm`),
   palette আইটেমে hover gradient, shortcut তালিকায় `.kbd` chip। একই handler/শর্ত।
3. **Skeleton loading:** board, settings, report, agent list, profile, media-র "লোড হচ্ছে" লেখার বদলে
   `.skeleton` ব্লক (আকৃতি আসল কন্টেন্টের কাছাকাছি) — condition হুবহু আগের।
4. **Thread canvas + grouping:** thread scroll এলাকায় হালকা brand-tinted canvas
   (`color-mix` 4–6% — সাদা bubble তার ওপর ভাসবে); timeline render-এ পরপর একই direction-এর message
   কাছাকাছি (group-start-এ বেশি ফাঁক) — শুধু render-এর ফাঁক হিসাব, data অপরিবর্তিত; note কার্ড
   `.note-card` (amber gradient + lock হেডার), AI Draft কার্ড `.draft-card` (brand gradient border + ✨ হেডার)।
5. **Filter row v2:** select-গুলো `.filter-select` (compact, rounded-xl), toggle-গুলো `.toggle-pill`
   (active = slate-900-এর বদলে brand gradient), tag input-এ 🏷 prefix tile।
6. **Context নিচের অর্ধেক v2 + micro-motion:** দায়িত্ব/Tag/notes/order ফর্ম `.ctx-card` ধাঁচে, notes timeline-style
   (author initials + সময়); globals-এ `.fade-rise` keyframe (modal, draft/note কার্ড, manage কার্ডে) —
   reduced-motion-এ global নিয়মে নিজে থেকেই বন্ধ।

## যাচাই

- `pnpm --filter @repo/web build` green, web vitest pass, `tsc --noEmit` clean — আসল আউটপুট acceptance-এ।
- Acceptance: `docs/inbox-design-v3-acceptance.md` (সৎ সীমা: live data ছাড়া visual QA হয়নি)।
