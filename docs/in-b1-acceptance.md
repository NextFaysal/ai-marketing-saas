# IN Batch B1 — সম্মিলিত Acceptance (IN1 + IN5a)

**তারিখ:** ২০২৬-১০-১২ · **প্যাকেজ:** IN1–IN10 (মালিকের অনুমোদন ২২:১৬ +06), Batch B1 · **বেস:** `a8980d6` · **Branch:** `in-package` (clean worktree `~/workspace/ai-marketing-saas-in`; main working tree-র ৩১টি uncommitted AG/Group-B entry-তে হাত দেওয়া হয়নি) · **Push:** হয়নি (স্থায়ী নিয়ম)

## Commit
| Commit | কী |
|---|---|
| `528d7e4` | IN1 — message search + advanced filters + saved views (`docs/in1-acceptance.md`) |
| `4023150` | IN5a — voice transcoding WebM → OGG/Opus (`docs/in5a-acceptance.md`) |
| (এই doc-এর commit) | B1 সম্মিলিত gate রিপোর্ট |

## Full gate (clean worktree, এই branch-এ)
- **API jest (full):** প্রথম run — 1880 pass / 1 fail / 1881, 209/210 suites; একমাত্র ব্যর্থতা `social/social-pp1.spec.ts`-এর SVG→PNG raster test (এই প্যাকেজের অছোঁয়া এলাকা)। একই spec আলাদা চালালে 5/5 pass, এবং **দ্বিতীয় full run: 1881/1881 pass, 210/210 suites** — অর্থাৎ ওটি ছিল full-run flake, এই প্যাকেজের regression নয়। সংখ্যা যাচাই: baseline (CX complete) 1859 + IN1 13 + IN5a 9 = **1881** ✓, suites 208 + 2 = **210** ✓।
- **API tsc:** clean (exit 0)।
- **Web vitest:** **125/125 pass, 17 files** (baseline 116 + IN1-এর 9)।
- **Web tsc:** clean (exit 0)।
- **Web build:** `next build` green — route table-এ `/dashboard/inbox` আছে।

## পরিবেশ নোট (যাচাইয়ের পথে পাওয়া)
- Worktree-তে node_modules নেই বলে main repo-র node_modules থেকে per-entry symlink farm বানানো হয়েছে; `@repo/*` linkগুলো worktree-র নিজের packages-এ নির্দেশ করে (main-এর dirty `@repo/ui` যেন যাচাইয়ে না ঢোকে — প্রথমে সেই কারণে 3টি ভুয়া EmptyState error এসেছিল, ঠিক করার পর clean)। `@repo/contracts` ও `@repo/db`-র `dist` worktree-তে build করা হয়েছে (gitignored, commit-এ নেই)।
- Prisma schema validate: dummy `DATABASE_URL` দিয়ে **valid** (env ছাড়া main repo-তেও একই P1012 — pre-existing)। Schema আগে থেকে unformatted ছিল (base-তেও format --check fail) — format চালিয়ে বড় diff আনা হয়নি।

## সৎ সীমা (B1 জুড়ে)
- **Live প্রমাণ হয়নি:** আসল Meta/WhatsApp credential sandbox-এ নেই (M30 বাকি) — IN1-এর search/filter/view ও IN5a-র transcode send-path service-layer spec + build দিয়ে প্রমাণিত; আসল নম্বরে WhatsApp OGG গ্রহণ ও production ডেটায় search-এর গতি অযাচাইকৃত।
- **Migration কোনো আসল DB-তে চলেনি** — `20261012200000_in1_saved_views` deploy-এর সময় Dokploy redeploy/migrate-এ লাগবে; তার আগে live সাইটে saved views endpoint 500 দিতে পারে (table নেই) — B1 push-এর সময় এই migration যেন অবশ্যই deploy হয়।
- **Production হোস্টে ffmpeg অযাচাইকৃত** (এই sandbox-এ 8.1.2 + libopus আছে); না থাকলে IN5a সৎ fallback-এ ফেরে, তবে deploy-এর পর `ffmpeg -version` যাচাই follow-up।
- Search plain `contains` scan — বড় org-এ ধীর হলে trigram/FTS index পরের ধাপ (IN1 acceptance-এও লেখা)।
