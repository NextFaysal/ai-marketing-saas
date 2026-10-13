# IN2 — এক Customer, সব Channel (Acceptance)

Batch B4, branch `in-package`. সব কাজ local commit, **push হয়নি**।

## যা তৈরি হয়েছে

### IN2a — Duplicate শনাক্তকরণ (context panel)
- `InboxService.identityForConversation` conversation খুললেই context-এ `identity` পাঠায়: `duplicates`, `linkedConversations`, `merges`।
- মিল শুধু **আসল identifier**-এ: ফোনের **শেষ ১০ ডিজিট** (`orders/risk-score.ts`-এর `phoneKey` — CX1/risk-এর বিদ্যমান নিয়মই পুনঃব্যবহার, যাতে `01711-111111` আর `+880 1711-111111` এক হয়) অথবা **ইমেইল** (case-insensitive)। উৎস: conversation-এর `contactPhone`, যুক্ত Customer, Lead।
- **সৎ সীমা:** Messenger/Instagram PSID থেকে ফোন পাওয়া যায় না যতক্ষণ গ্রাহক নিজে না দেন — শুধু PSID আছে এমন conversation-এ duplicate তালিকা **খালি** থাকে (spec দিয়ে প্রমাণিত)। অনুমানে কোনো মিল দেখানো হয় না।
- Web: গ্রাহক card-এ "⚠️ সম্ভাব্য একই গ্রাহক" সতর্কতা — মিলের কারণ (ফোন/ইমেইল) দেখানো হয়, থ্রেড দেখা / মার্জ / লিংক বোতামসহ।

### IN2b — Manual merge, reversible
- Canonical merge আগেই `CustomersService.merge`-এ ছিল কিন্তু **irreversible** ছিল (audit-তে শুধু count থাকত)। IN2 সেটাকে record-driven করেছে:
  - নতুন model `CustomerMergeRecord` (migration `20261012240000_in2_customer_merge_record`): কোন order/conversation সরেছে তার **হুবহু id তালিকা** + কোন field gap-fill হয়েছে তার `{before, filledWith}` snapshot।
  - `CustomersService.unmerge`: row তখনই ফেরে যখন এখনো survivor-কেই point করছে (পরে হাতে অন্য কোথাও সরানো row চুরি হয় না); gap-filled field তখনই restore হয় যখন এখনো ঠিক filled value-টাই আছে (পরের human edit clobber হয় না); shell-এর `mergedIntoId` মোছে; record-এ `revertedAt/revertedBy` বসে; audit `customer.unmerged`। Double-unmerge refuse হয়।
  - **Pre-IN2 merge (record নেই) সৎভাবে refuse** করা হয় — অনুমানে কিছু ফেরানো হয় না।
  - কোনো message/order **মোছা হয় না** কখনোই — শুধু `customerId` বদলায়।
- Inbox surface: `POST conversations/:id/merge-customer | unmerge-customer | link-customer` — merge-এর অন্তত এক পক্ষ এই conversation-এর customer হতে হবে (route দিয়ে অসম্পর্কিত pair মার্জ করা যায় না)। Link শুধু `customerId` null হলে বসে, merged shell-এ refuse হয়।
- `CustomersController`-এ সরাসরি `POST customers/unmerge` (OWNER/ADMIN)।

### IN2c — Unified timeline
- Context panel-এ `linkedConversations`: একই customer-এর অন্য channel-এর সব thread (খুললেই সেই thread-এ যাওয়া যায়)।
- Orders/lifetime/courier record আগের মতোই customer-scoped compute-on-read — তাই merge হলেই panel-এর অর্ডার, মোট খরচ আর **CX1 courier success % দুই channel মিলিয়ে** আসে। Spec প্রমাণ: merge-এর আগে survivor একা decided 1 / delivered 0 (0%); merge-এর পরে decided 2 / delivered 1 (**50%**, per-courier: steadfast 100%, pathao 0%); unmerge-এর পরে আবার আগের হিসাবে ফেরে — আসল `RiskService` দিয়ে, একই fake rows-এর ওপর।

## Spec (27টি B4 test-এর মধ্যে IN2: 14)
- `apps/api/src/customers/in2-merge.spec.ts` (7): move + record + snapshot + gap-fill, guards (same id / already-merged / cross-org), courier before/after/unmerge, পূর্ণ unmerge restore, re-pointed row না-চুরি, edited field না-clobber, legacy merge refuse।
- `apps/api/src/inbox/in2-identity.spec.ts` (7): phone (last-10) + email duplicate, org-scope, linked conversations, PSID-only খালি তালিকা, conversation থেকে merge→identity.merges→unmerge, unrelated merge refuse, link + overwrite/merged-shell refuse।

## Migration deploy-নোট
- `20261012240000_in2_customer_merge_record` **কোনো আসল DB-তে চলেনি** — deploy-এ migration + `prisma generate` বাধ্যতামূলক, নইলে merge record লেখা fail-soft হলেও unmerge পাওয়া যাবে না।
- ⚠️ Master-এর সমান্তরাল AP6 track-ও `20261012240000` prefix ব্যবহার করেছে (আলাদা folder/table) — integration-এ দুটোই রাখতে হবে, IN4/GV3-র `20261012220000` জোড়ার মতোই।
