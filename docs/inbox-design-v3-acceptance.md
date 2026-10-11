# Inbox Design v3 — Deep Polish — Acceptance

**তারিখ:** ২০২৬-১০-১২ · **প্ল্যান:** `docs/inbox-design-v3-plan.md` · **বেস:** HEAD `756cdc3`-তে শুরু; কাজ চলাকালে সমান্তরাল CX ট্র্যাক CX12d কমিট (`2ef7c46`) করেছে — এই প্যাকেজের কমিট তার ওপরেই বসেছে (নিচে নোট দেখুন)।
**স্কোপ:** web-only restyle — কোনো API/schema/lib-logic বদল নয়, কোনো handler/endpoint/payload/state-আচরণ বদল নয়; শুধু markup/class ও একটি render-only spacing হিসাব।

## যা বদলাল (৬টি পলিশ)

1. **Manage v2** — সব সেকশন `.manage-card` + `.manage-head` (আইকন-টাইল `.manage-icon`-এ emoji, শিরোনাম হুবহু একই লেখা): Auto-Reply সেটিংস, আমার পারফরম্যান্স, টিম রিপোর্ট, টিম ও এজেন্ট, আরও চ্যানেল, Quick Replies, WhatsApp Template, WhatsApp/Messenger Connect। ওপরে **sticky sub-nav** (`.manage-nav`, শুধু Manage ভিউতে) — ৬টি chip (সেটিংস/পারফরম্যান্স/রিপোর্ট/টিম/কানেক্ট/Quick Reply) ক্লিকে `document.getElementById(...).scrollIntoView({behavior:"smooth"})`; নতুন কোনো state নেই, সেকশনগুলোতে শুধু `id` + `scroll-mt-20` যোগ। মূল সেটিংস গ্রিড ও Connect ফর্মের ফিল্ডগুলো `.setting-row`-তে (label বামে, control ডানে `.setting-row-control`, helper `.setting-row-help` — Retention-এর helper লেখা হুবহু আছে)। টিম রিপোর্টের ৪টি সংখ্যা `.ctx-tile`-এ (আসল `report` payload-ই; SLA ভঙ্গ টাইলে আগের লাল শর্তই)। পারফরম্যান্স chip-গুলো badge primitive-এ; per-agent/per-team/agent সারি, টিম কার্ড, চ্যানেল সাব-কার্ড, Quick/Template সারিতে rounded-2xl/ring polish। Per-channel ও per-intent-এর compact গ্রিডগুলো আগের গ্রিড আকারেই আছে (manage-card-এর ভিতরে)।
2. **Modal v2** — Palette ও Shortcuts: `.modal-backdrop` (`bg-slate-900/50 backdrop-blur-sm` — আগের backdrop রঙই, blur যোগ), প্যানেল `.modal-shell` (rounded-3xl, shadow-pop) + `.fade-rise`; Palette হেডার `.modal-head` (brand-soft gradient), আইটেম `.modal-item` (hover-এ brand gradient); Shortcut তালিকায় প্রতিটি key এখন `.kbd` chip। সব handler/শর্ত হুবহু।
3. **Skeleton loading** — ঠিক আগের "লোড হচ্ছে" condition-গুলোতেই `.skeleton` ব্লক (আকৃতি আসল কন্টেন্টের কাছাকাছি, `role="status"` + আগের লেখাটাই `aria-label`-এ): পাইপলাইন বোর্ড (`!board`), সেটিংস (`settings` null), টিম রিপোর্ট (`report` null), এজেন্ট তালিকা (`agentStates` খালি), TikTok তথ্য (`tiktokPack` null), আর thread-এর প্রতিটি মিডিয়া (`MediaView`-র `!url`)। Media Library ভিউ ও Command Profile-এর আলাদা কোনো loading লেখা/condition ছিল না (খালি-অবস্থা আর content-অবস্থা একই শর্তে মিশে আছে) — সেখানে skeleton বসাতে হলে নতুন condition লাগত, তাই বসানো হয়নি। তালিকার scroll-sentinel "আরও কথোপকথন লোড হচ্ছে…" লেখাটি loading-state নয়, progressive-load নির্দেশক — আগের মতোই আছে।
4. **Thread canvas + grouping** — timeline ধারকে `.thread-canvas` (brand `color-mix` ৫% tint, v2-র `.thread-scroll` radial-এর নিচে) + `flex flex-col gap-2`। Grouping সম্পূর্ণ render-only: আগের timeline item-টি একই direction-এর message ও একই দিনের হলে এই message-এর wrapper-এ `-mt-1` (ফাঁক 8px→4px); note/day-separator গ্রুপ ভাঙে। Data, order, key — কিছুই বদলায়নি। Note কার্ড `.note-card` (amber gradient + 🔒 হেডার হুবহু, ফুটারে লেখকের initials avatar `.note-author` + নাম + সময়)। AI Draft কার্ড `.draft-card` (brand gradient surface + brand ring + ✨ হেডার, অনুমোদন বোতাম `.btn-ai`; send/dismiss handler হুবহু)।
5. **Filter row v2** — channel/assignee select `.filter-select`; অপঠিত/অপঠিত আগে/Spam/বাল্ক toggle `.toggle-pill` (active = slate-900-এর বদলে brand gradient `.toggle-pill-active`); Tag ইনপুটে 🏷️ prefix tile (`.tag-input-icon`) + `!pl-9`। সব `onFilter`/`onChange` হুবহু।
6. **Context নিচের অর্ধেক + micro-motion** — গ্রাহক/Command Profile/দায়িত্ব ও Tag কার্ড `.ctx-card`; সারসংক্ষেপ বাক্স ও chat-order ফর্ম `.ctx-subcard`; profile-এর চ্যানেল সারি ও পেমেন্ট-যাচাই সারিতে ring polish। `.fade-rise` keyframe (0.35s, translateY 6px→0) manage কার্ড, modal shell, note/draft কার্ডে।

**CSS:** `globals.css`-এ শুধু additive "Inbox Design v3 primitives" সেকশন (+53 লাইন, কোনো লাইন মোছা হয়নি) — সব primitive `--brand-from`/`--brand-to` থেকে `color-mix`/gradient, white-label অক্ষত। `.fade-rise` reduced-motion-এ বন্ধ হওয়া যাচাই করা: globals-এর বিদ্যমান `@media (prefers-reduced-motion: reduce)` ব্লক সব element-এ `animation-duration: 0.01ms !important; animation-iteration-count: 1 !important` বসায় — `.fade-rise`-ও তার আওতায়, আলাদা কোড লাগেনি।

**পরিষ্কার-পরিচ্ছন্নতা:** Connect ফর্মের restyle-এর পর অব্যবহৃত হয়ে যাওয়া style const `inputCls` সরানো হয়েছে (এর একমাত্র ব্যবহারকারী ছিল ওই ফর্মটিই)। `inbox-extras.tsx`-তে কোনো বদল লাগেনি (emoji panel/voice recorder v2-তেই পলিশ করা ছিল)।

## যা অপরিবর্তিত (যাচাই করা)

- সব handler, endpoint, payload, state — page.tsx diff-এর removed লাইনগুলো হুবহু একই handlerসহ added লাইনে ফিরে এসেছে (শুধু class/markup বদল); একমাত্র নতুন হিসাব grouping-এর `prevItem` (আগের item পড়ে শুধু spacing ঠিক করে) ও sub-nav-এর `scrollIntoView`।
- সব বাংলা লেবেল (সেকশন শিরোনামের emoji এখন পাশের আইকন-টাইলে — লেখা একই), aria, keyboard shortcut, resizable pane, mobile toggle, context drawer।
- কোনো invented metric নয়: report tile = আসল `report` payload, sub-nav/stat সব আগের data-ই।

## যাচাই — আসল আউটপুট

- `tsc --noEmit` (apps/web) — **clean, exit 0**।
- `apps/web` vitest — **8 files, 72 tests, সব pass** (`Test Files 8 passed (8) · Tests 72 passed (72)`)।
- `pnpm --filter @repo/web build` — **green** (exit 0; route table সম্পূর্ণ, `.next/app-path-routes-manifest.json`-এ `/dashboard/inbox` আছে)।
- পরিবেশ নোট: প্রথম vitest run `ENOSPC`-তে ব্যর্থ হয় — কারণ `/tmp` tmpfs (512M) 100% ভরা ছিল (বড় অংশ সমান্তরাল ট্র্যাকের `/tmp/cx12d-wt` worktree কপি)। অন্য ট্র্যাকের ফাইল না ছুঁয়ে যাচাইগুলো `TMPDIR` বড় ডিস্কে সরিয়ে চালানো হয়েছে; কোডের সাথে সম্পর্কিত ব্যর্থতা নয়।

## সৎ সীমা

- Sandbox-এ live Meta/WhatsApp data নেই — ডিজাইনের যাচাই build + typecheck + markup ভিত্তিক; live কথোপকথন দিয়ে visual QA করা হয়নি।
- ⚠️ সমান্তরাল ট্র্যাক নোট: কাজ চলাকালে CX12d কমিট (`2ef7c46`) page.tsx-তে 🌙 off-schedule chip ও per-channel schedule editor যোগ করে কমিট করেছে। Working tree যাচাই করে নিশ্চিত করা হয়েছে — CX12d-র সব page.tsx অংশ (`aiSchedule` ৫টি reference, chip, editor) এই প্যাকেজের working tree-তেও হুবহু আছে এবং এই কমিটের diff-এ CX12d-র কোনো লাইন মোছা হয়নি; ডিজাইন হাংকগুলো তার ওপরেই বসেছে। Build/test/tsc ফলাফল সেই combined tree-র ওপরের। Working tree-তে থাকা অন্য ট্র্যাকের অকমিটেড API কাজ (courier/customers/inbox.service/webchat/risk + `courier-card.ts`) এই কমিটে **ঢোকেনি**।
- **Local commit only — GitHub push হয়নি** (মালিকের স্থায়ী নিয়ম)।
