# Inbox Design v2 — Modern & Powerful (Plan)

**প্রসঙ্গ:** মালিকের নির্দেশ ২০২৬-১০-১২ ০০:৫৫ +06 — "Marketing SAAS-এর জন্য inbox page-এর design modern and powerful করতে হবে।"
একই দিনের code audit-এর ওপর ভিত্তি করে (apps/web/src/app/dashboard/inbox/page.tsx, 2,211 লাইন)।

## Audit — এখন যা আছে

ফাংশনালি ইনবক্স ইতিমধ্যেই শক্তিশালী: 100dvh 3-column resizable workspace, realtime stream,
presence/collision, ghost-text, tone rewriter, voice recorder, drag-drop/paste media,
product card পাঠানো, courier tracking widget, smart folders (SLA/VIP — server counts),
bulk actions, pipeline board, media library, Cmd+K palette, j/k navigation।
**সমস্যা ডিজাইনে, ফিচারে নয়:**

1. Header তালিকা-ভিউতে 116–180px জায়গা খায় (বড় title + ৫টি pill + লম্বা অনুচ্ছেদ) — চ্যাটের জায়গা কমে।
2. Conversation card: avatar নেই, সময় দুর্বল, unread/SLA/mood/tag সব এক লাইনে গাদাগাদি — hierarchy নেই।
3. Thread action bar: pipeline/tracking/courier/refund/Export/spam/outcome — রঙিন ছোট pill-এর ভিড়, "powerful" মনে হয় না।
4. Message bubble ও banner পুরনো slate ধাঁচের; app-এর Design v2 tokens (globals.css) ইনবক্সে প্রায় ব্যবহারই হয়নি।
5. Composer toolbar: অনেকগুলো সমান ওজনের btn-secondary — AI group আর insert group আলাদা বোঝা যায় না।
6. Context panel: ছোট ছোট কার্ডের স্তূপ; customer hero/lifetime stat-এর কোনো visual weight নেই।
7. Board ও Media ভিউ plain slate-50 — বাকি app-এর v2 লুকের (Dashboard/Billing/Support) সাথে মেলে না।

## Scope — কঠোর সীমা

- **শুধু apps/web:** `src/app/dashboard/inbox/page.tsx`, `src/app/globals.css` (additive Inbox v2 primitives),
  `src/components/inbox-extras.tsx` (শুধু restyle)।
- **কোনো API/schema/lib-logic বদল নয়।** কোনো handler, endpoint, payload, state-এর আচরণ বদলাবে না — শুধু markup/class।
- **কোনো invented metric নয়:** power strip-এর সংখ্যা শুধু ইতিমধ্যে fetch হওয়া `folderCounts` ও board data থেকে।
- বাংলা লেবেল, aria, keyboard (j/k, ⌘K), resizable panes, mobile list/chat toggle, context drawer — সব আচরণ অপরিবর্তিত।
- Working tree-তে থাকা অসমাপ্ত CX2 কাজ (inbox.service/module, ai-instructions, risk, courier-card ইত্যাদি)
  **ছোঁয়া যাবে না, কমিটও নয়** — কমিট হবে শুধু এই প্যাকেজের নিজের ফাইল।

## Design — Inbox v2

1. **Compact Power Header:** slim bar — "ইনবক্স" + live pulse, segmented view-switcher
   (কথোপকথন/বোর্ড/মিডিয়া/সেটিংস), ডানে my-status + Export + ⌘K hint। নিচে **live stat chips**
   (সব / আমার / অনির্ধারিত / ⏰ SLA breach / ⭐ VIP) — folderCounts-এর আসল সংখ্যা, active folder-এর সাথে sync।
   লম্বা সতর্ক-অনুচ্ছেদটি এক লাইনের muted note হিসেবে থাকবে (AI draft ও internal note-এর সত্যটা হারাবে না)।
2. **Conversation List v2:** `.conv-card` — initials avatar + channel dot overlay, ডানে relative time,
   gradient unread badge, SLA হলে লাল badge, mood শুধু dot, tags tiny pill, assigned agent-এর initials।
   Active কার্ডে brand-soft background + বাম accent bar + ring। Search icon-সহ sticky।
3. **Thread v2:** sticky polished header (avatar, presence, autopilot pill, status segmented control);
   action bar পরিষ্কার toolbar-এ গোছানো — **সব বিদ্যমান action ও handler হুবহু থাকবে**, শুধু grouping/dividers/style;
   bannerগুলো `.alert` v2 variant; bubble `.inbox-msg-in/out` (out = brand gradient), date separator `.date-sep` পুনঃব্যবহার;
   খালি thread-এ modern empty state।
4. **Composer v2:** floating shell (rounded-3xl, shadow-pop) — Reply/Note segmented toggle (note-এর amber সতর্ক-রূপ অপরিবর্তিত),
   toolbar দুই group-এ (insert: quick/emoji/product/image/file/voice · AI: Draft/টোন brand-styled), Send gradient + arrow,
   ghost-text hint অপরিবর্তিত।
5. **Context Panel v2:** customer hero card (বড় avatar, নাম, যোগাযোগ), lifetime stat mini-tiles,
   order কার্ড + ShipmentWidget v2 polish, Command Profile badge polish — সব data আগের মতোই।
6. **Board + Media v2:** column header-এ রঙিন stage dot + count/value, কার্ডে avatar/time/value hierarchy; media কার্ডে type icon tile + hover lift।

সব primitive `--brand-from/--brand-to` থেকে color-mix দিয়ে তৈরি — white-label org-এর রঙ ইনবক্সেও নিজে থেকে বইবে।
Reduced-motion নিয়ম globals.css-এ আগের মতোই প্রযোজ্য।

## যাচাই

- `pnpm --filter @repo/web build` green, `vitest run` pass, `tsc --noEmit` clean।
- Acceptance doc: `docs/inbox-design-v2-acceptance.md` — কী বদলাল, কোন আচরণ অপরিবর্তিত, সৎ সীমা
  (sandbox-এ live Meta data নেই — ডিজাইন যাচাই build + খালি/seeded অবস্থার markup ভিত্তিতে)।
- **Local commit only — GitHub push নয়** (মালিকের স্থায়ী নিয়ম)।
- ⚠️ Overlap নোট: CX প্যাকেজের পরের batch (CX4/CX5) ভবিষ্যতে inbox page.tsx ছুঁতে পারে —
  এই ডিজাইন কমিটের ওপর rebase করে এগোতে হবে; CSS primitive additive রাখায় conflict ছোট থাকার কথা।
