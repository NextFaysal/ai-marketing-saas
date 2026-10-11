# Inbox Design v2 — Acceptance

**তারিখ:** ২০২৬-১০-১২ · **প্ল্যান:** `docs/inbox-design-v2-plan.md` · **স্কোপ:** web-only restyle — কোনো API/schema/lib-logic বদল নয়, কোনো handler/endpoint/payload/state-আচরণ বদল নয়; শুধু markup ও class।

## যা বদলাল (৬টি ডিজাইন অংশ)

1. **Compact Power Header** — স্লিম বার: "ইনবক্স" + live pulse dot, segmented view-switcher (`.view-switch`, কথোপকথন/বোর্ড/মিডিয়া/সেটিংস — একই `setViewMode` handler), ডানে my-status chip (বিদ্যমান `myStatus` state), Export (একই handler) ও ⌘K বোতাম (একই `setPaletteOpen`)। নিচে **live stat chips** (`.stat-chip`) — সব/আমার/অনির্ধারিত/SLA Breach/VIP; সংখ্যা শুধু ইতিমধ্যে fetch করা `folderCounts` থেকে, ক্লিক একই `applyFolder` — ফোল্ডার চিপগুলো তালিকা-প্যান থেকে হেডারে সরেছে (ডুপ্লিকেট নয়)। লম্বা সতর্ক-অনুচ্ছেদ এখন এক লাইনের muted note (AI Draft ও Internal Note-এর সত্যটা রয়ে গেছে)। Error/Notice এখন `.alert` v2 (red/green)।
2. **Conversation List v2** — `.conv-card`: initials avatar + channel dot overlay (`.conv-avatar`/`.conv-dot`), ডানদিকে relative time (`relTime` — পূর্ণ তারিখ title-এ), gradient unread badge (`.conv-unread`), SLA হলে লাল `.sla-badge` (আগের display-rule-ই), mood এখন শুধু রঙিন dot (title-এ আগের ব্যাখ্যা), tags tiny pill, assigned agent-এর initials (`.agent-mini`, নাম title-এ)। Active কার্ডে brand-soft gradient + বাম accent bar + ring (`.conv-card-active`)। Search ঘরে 🔍 icon। Bulk বার polish।
3. **Thread v2** — polished sticky-ধাঁচের header (`.thread-head`): avatar, নাম, channel, mood chip, **Autopilot pill** (বিদ্যমান `settings.autoReplyMode` / `autoReplyPaused` থেকে — নতুন data নয়), presence cues অপরিবর্তিত, status এখন segmented control (`.status-switch`, একই `patchConversation`)। Action bar `.toolbar-v2`-তে গোছানো — pipeline select, tracking, courier, refund, CSV export, spam, outcome — **সব action ও handler হুবহু**; শুধু ring/hover/grouping। Bannerগুলো `.alert` v2 (autopilot-paused red, WhatsApp window green/amber, presence amber)। Bubble `.inbox-msg-in` (সাদা) / `.inbox-msg-out` (brand gradient) / `.inbox-msg-failed`; date separator পুনঃব্যবহৃত `.date-sep`; খালি thread ও "কোনো কথোপকথন বেছে নিননি" অবস্থায় modern empty state।
4. **Composer v2** — floating shell (`.composer-shell`: rounded-3xl + shadow-pop), Reply/Note segmented toggle (note-mode-এর amber রূপ অপরিবর্তিত), toolbar দুই group-এ: **যোগ করুন** (quick/emoji/format/product/image/file/voice) ও **AI** (`.composer-group-ai` — AI Draft ও টোন এখন brand-gradient `.btn-ai`)। Send আগের মতোই `.btn-primary` gradient। Ghost-text, quick-reply/emoji পপআপ, mention chips — সব অপরিবর্তিত।
5. **Context Panel v2** — customer hero card (`.ctx-hero`: brand gradient, বড় avatar, নাম/যোগাযোগ), lifetime stat mini-tiles (`.ctx-tile` — একই `context.lifetime` data), order কার্ড `.ctx-order`, ShipmentWidget polish (rounded-xl, gradient progress step), Command Profile-এর `badge-indigo` primitive যোগ হয়েছে (আগে class-টি undefined ছিল)।
6. **Board + Media v2** — board column `.board-col` + রঙিন stage dot + `.board-count` chip, কার্ড `.board-card` (avatar initials, relative time, gradient unread; drag/drop ও click handler হুবহু); media কার্ড `.media-card` + type icon tile (`.media-icon-tile`) + hover lift।

**CSS:** `globals.css`-এ শুধু additive "Inbox Design v2 primitives" সেকশন — সব primitive `--brand-from`/`--brand-to` থেকে `color-mix`/gradient দিয়ে, তাই white-label org-এর রঙ ইনবক্সেও বয়। Reduced-motion নিয়ম আগের মতোই প্রযোজ্য। `inbox-extras.tsx`-এ শুধু restyle (emoji panel shadow-pop/rounded-3xl, recording pill ring)।

**নতুন display helper (page.tsx-এর ভিতরে, pure formatting):** `initialsOf`, `relTime`, `CHANNEL_DOT`, `ConvAvatar` — কোনো fetch/state/handler ছোঁয়নি।

## যা অপরিবর্তিত (যাচাই করা)

- সব handler, endpoint, payload, state-আচরণ — diff শুধু markup/class ও উপরের pure display helper।
- সব বাংলা লেবেল, aria-label, keyboard shortcut (j/k, ⌘K, /, R, E, ?, Esc), resizable pane (splitter, localStorage key), mobile list/chat toggle, context drawer।
- Note-mode-এর কোনো customer-send পথ নেই — আগের structural guard-ই আছে।
- কোনো invented metric নয়: header chips = `folderCounts`, board count/value = board data, Autopilot pill = fetched settings।

## যাচাই — আসল আউটপুট

- `pnpm --filter @repo/web build` — **green** (sandbox-এ pnpm binary না থাকায় প্রথমে একই `next build` script `npm run build` দিয়ে, পরে `npx pnpm@9.15.0 --filter @repo/web build` দিয়েও green; route table-এ `/dashboard/inbox` সহ সব route compile হয়েছে)।
- `apps/web` vitest — **8 files, 72 tests, সব pass** (`Test Files 8 passed (8) · Tests 72 passed (72)`)।
- `tsc --noEmit` (apps/web) — **clean, exit 0, কোনো error নয়**।

## সৎ সীমা

- Sandbox-এ live Meta/WhatsApp data নেই — ডিজাইনের যাচাই build + typecheck + markup ভিত্তিক; live কথোপকথন দিয়ে visual QA করা হয়নি। Seeded/খালি অবস্থার markup-ই পরীক্ষিত পথ।
- যাচাই চলাকালে working tree-তে সমান্তরাল CX ট্র্যাকের অকমিটেড কাজ ছিল (সেটা এই কমিটে **ঢোকেনি** — page.tsx-এর staged অংশ হুবহু এই ডিজাইন প্যাকেজের; CX-এর `aiReplyDelay` সেটিংস-UI অংশ working tree-তেই অকমিটেড রয়ে গেছে)। Build/test/tsc ফলাফল সেই combined working tree-র ওপরের।
- ভবিষ্যৎ CX batch (CX4/CX5) inbox page.tsx ছুঁলে এই কমিটের ওপর rebase করতে হবে; CSS primitive additive রাখায় conflict ছোট থাকার কথা।
- **Local commit only — GitHub push হয়নি** (মালিকের স্থায়ী নিয়ম)।
