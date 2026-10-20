# i18n Hardcoded-String Scan — Baseline (ML3, 2026-10-19)

MB1 শেষে, committed tree-তে পরিমাপ করা baseline। টুল: `node scripts/i18n-scan.mjs` (root script: `pnpm i18n:scan`)।

পদ্ধতি: dictionary home (web `lib/i18n/**`, admin `lib/i18n.ts`, shop shim, NF5 translations) ও test/spec ফাইল বাদে সব .ts/.tsx ফাইলের string literal গণনা। বাংলা literal = U+0980–U+09FF আছে এমন literal। English-UI literal = heuristic (৩+ শব্দের বাক্য-আকৃতির literal; code-আকৃতির string বাদ) — এটি upper bound, প্রমাণ নয়। toLocaleString গণনা source-level (comment-সহ হতে পারে)।

## web
- ফাইল স্ক্যান: 442 · findings-সহ ফাইল: 357
- বাংলা literals: 11144 · English-UI literals (heuristic): 448 · direct toLocaleString calls: 572

সবচেয়ে বেশি findings (top 10):

- `/apps/web/src/lib/workflow-blueprints.ts` — bn 712, en 0, toLocaleString 0
- `/apps/web/src/app/dashboard/inbox/page.tsx` — bn 396, en 42, toLocaleString 14
- `/apps/web/src/app/dashboard/messaging/page.tsx` — bn 418, en 3, toLocaleString 18
- `/apps/web/src/app/dashboard/campaign-builder/page.tsx` — bn 329, en 15, toLocaleString 23
- `/apps/web/src/app/dashboard/orders/page.tsx` — bn 308, en 2, toLocaleString 8
- `/apps/web/src/app/dashboard/commerce/storefront/page.tsx` — bn 276, en 21, toLocaleString 5
- `/apps/web/src/app/dashboard/settings/page.tsx` — bn 249, en 6, toLocaleString 20
- `/apps/web/src/app/dashboard/social-posts/page.tsx` — bn 239, en 0, toLocaleString 29
- `/apps/web/src/app/dashboard/workflows/page.tsx` — bn 180, en 12, toLocaleString 3
- `/apps/web/src/lib/festival-playbook.ts` — bn 168, en 0, toLocaleString 1

## admin
- ফাইল স্ক্যান: 35 · findings-সহ ফাইল: 31
- বাংলা literals: 866 · English-UI literals (heuristic): 123 · direct toLocaleString calls: 27

সবচেয়ে বেশি findings (top 10):

- `/apps/admin/src/app/settings/page.tsx` — bn 152, en 16, toLocaleString 0
- `/apps/admin/src/app/billing/page.tsx` — bn 78, en 9, toLocaleString 0
- `/apps/admin/src/app/orgs/[id]/page.tsx` — bn 82, en 2, toLocaleString 1
- `/apps/admin/src/app/payouts/page.tsx` — bn 66, en 15, toLocaleString 0
- `/apps/admin/src/app/growth/page.tsx` — bn 60, en 5, toLocaleString 1
- `/apps/admin/src/app/system/page.tsx` — bn 39, en 6, toLocaleString 3
- `/apps/admin/src/app/tickets/page.tsx` — bn 38, en 3, toLocaleString 0
- `/apps/admin/src/app/health/page.tsx` — bn 35, en 4, toLocaleString 0
- `/apps/admin/src/app/page.tsx` — bn 35, en 4, toLocaleString 4
- `/apps/admin/src/app/orgs/page.tsx` — bn 29, en 6, toLocaleString 0

## api
- ফাইল স্ক্যান: 763 · findings-সহ ফাইল: 407
- বাংলা literals: 6114 · English-UI literals (heuristic): 2193 · direct toLocaleString calls: 19

সবচেয়ে বেশি findings (top 10):

- `/apps/api/src/campaigns/campaigns.service.ts` — bn 523, en 197, toLocaleString 2
- `/apps/api/src/messaging/messaging.service.ts` — bn 86, en 323, toLocaleString 1
- `/apps/api/src/inbox/inbox.service.ts` — bn 213, en 72, toLocaleString 0
- `/apps/api/src/admin/admin.service.ts` — bn 102, en 94, toLocaleString 1
- `/apps/api/src/automation/automation.service.ts` — bn 140, en 35, toLocaleString 3
- `/apps/api/src/storefront/storefront.service.ts` — bn 156, en 7, toLocaleString 0
- `/apps/api/src/ai/planner.ts` — bn 110, en 30, toLocaleString 0
- `/apps/api/src/orders/bd-address-data.ts` — bn 132, en 2, toLocaleString 0
- `/apps/api/src/organizations/organizations.service.ts` — bn 87, en 25, toLocaleString 0
- `/apps/api/src/inbox/intent.ts` — bn 100, en 0, toLocaleString 0

## মোট: 1240 ফাইল · 18124 বাংলা literals · 2764 English-UI literals · 618 toLocaleString calls

গুরুত্ব: এটাই MB2–MB5-এর কাজের মাপ — প্রতিটি ব্যাচে নিজের surface-এর সংখ্যা কমবে; MB6-তে scanner gate (fail-on-new) চালু হলে শূন্যের দিকে যাওয়া বাধ্যতামূলক হবে। MB1-এ scanner report-only (exit code সবসময় 0) — enforcement এখনো চালু নয়।
