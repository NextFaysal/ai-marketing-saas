# Social Posts Next — Package Summary (SN1–SN10)

প্যাকেজ: Social Posts Next (SN1–SN10) · Plan:
`docs/social-posts-next-plan.md` · Worktree
`~/workspace/ai-marketing-saas-sn`, branch `social-next`,
base = GitHub main `49dac3e` · **CODE-COMPLETE** (Batch N5
closing-এ) · Push হয়নি — local commit only।

## Status table

| Item | Batch | যা বসেছে | Migration | প্রমাণের ধরন |
|---|---|---|---|---|
| SN1 Publishing gaps | N1 | FB video cover (spike verdict BUILD — post-publish thumbnails edge দিয়ে), YouTube playlist বাছাই + publish-এর পর playlistItems.insert, YouTube/LinkedIn first comment, TikTok photo posts audit gate-এর পেছনে | `20261015100000` (SN2-র সঙ্গে ভাগ করা) | Stubbed-boundary spec (`social-sn1.spec.ts`) + spike doc `docs/social-sn1-fb-cover-spike.md`; কোনো live Meta/YouTube/TikTok call হয়নি |
| SN2 Client approval share link | N1 | Token public preview page (`/share/social/[token]`), ক্লায়েন্টের Approve/Request-changes পোস্টের timeline-এ আসল record, review supersede, optional gate `socialRequireClientApproval` (default OFF) — অভ্যন্তরীণ approval gate-কে bypass করে না | `20261015100000` | Stubbed spec (`social-sn2.spec.ts`); আসল ক্লায়েন্ট দিয়ে live পরীক্ষা হয়নি (checklist S13) |
| SN3 Pipeline board + calendar drag | N2 | Board view (Draft/Pending/Approved/Scheduled/Published-Failed) — drag ও move-menu দুটোই বিদ্যমান handler-এ resolve হয়, server gate-ই চূড়ান্ত সিদ্ধান্ত, refusal-এ card জায়গায় থাকে verbatim কারণসহ; calendar drag-reschedule একই schedule endpoint-এ | — | Web vitest (board decision layer 21 case) + API gate সবুজ; screenshot QA হয়নি |
| SN4 AI variants / translate / repurpose | N2 | তিনটি RETURN-ONLY endpoint (ai-variants / ai-translate / ai-carousel-outline): real-LLM ছাড়া refuse, per-feature daily cap, SU4 number guard, policy findings; composer-এ হাতে apply করা variant, per-field translation, Repurpose menu (Reel script / carousel outline / Messaging `?prefill=` draft handoff — কিছু পাঠানো হয় না) | — | Spec (`social-sn4.spec.ts`, zero-row pin); আসল LLM দিয়ে live যাচাই হয়নি |
| SN5 Stock (Pexels) + brand overlay | N3 | Org-এর নিজের Pexels key (verify-before-save, sealed সংরক্ষণ), Library-তে stock search/import (SSRF-guarded একমাত্র পথে, attribution asset-এ থাকে, একই item দ্বিতীয়বার import-এ duplicate নয়), যেকোনো ছবিতে brand overlay derived asset | `20261015110000` | Stubbed spec (`social-sn5.spec.ts`); আসল Pexels key দিয়ে live import হয়নি (checklist S13) |
| SN9 AI performance coach | N3 | সাপ্তাহিক digest — deterministic compute শুধু org-এর আসল SU7 data থেকে, LLM narration থাকলে number guard মেনে, না থাকলে deterministic সারসংক্ষেপ; Analytics Coach card + notification; per-org job `social_coach_weekly` (default OFF), একই সপ্তাহে idempotent | `20261015110000` (SN5-এর সঙ্গে ভাগ করা) | Spec (`social-sn9.spec.ts`); আসল সপ্তাহের data-তে live digest হয়নি (checklist S14) |
| SN6 Telegram channel publishing | N4 | Bot token connect (verify-before-save: getMe/getChat/getChatMember), text/photo/video/media-group publish, দীর্ঘ caption spill, schedule বিদ্যমান worker-এ; insights সৎভাবে unavailable (Bot API দেয় না — বানানো সংখ্যা নেই) | — | 24 stubbed-boundary spec (`social-sn6.spec.ts`) + spike; আসল bot/channel-এ publish হয়নি (checklist S11) |
| SN7 Threads publishing | N4 | threadsApp platform config + tenant নিজের app পথ, OAuth (long-lived + refresh), container → publish, preflight 500/20, profile health, documented insights + follower snapshot | — | 27 stubbed-boundary spec (`social-sn7.spec.ts`) + spike doc `docs/social-sn7-threads-spike.md`; App Review/live publish বাকি (checklist S12) |
| SN8 Syndication auto-draft | N5 | RSS feed + নিজের YouTube channel-এর নতুন আইটেম থেকে SU5 semantics-এ DRAFT ONLY; `social_syndication_sweep` job (default OFF); dedupe SocialSyndicationSeen + autoDraftRef দুই স্তরে; cap commerce-এর সঙ্গে সম্মিলিত | `20261015130000` | 27 spec (`social-sn8.spec.ts`, fake seam); আসল feed/channel-এ live run হয়নি (checklist S15) |
| SN10 Caption test | N5 | Draft থেকে জোড়া (একই captionTestId), আলাদা schedule; দুটো published হলে Analytics-এ পাশাপাশি তুলনা (আসল engagement + কোন metric ছিল + link click); কাছাকাছি ফলে নোট; **winner ঘোষণা নেই** | `20261015130000` (SN8-এর সঙ্গে ভাগ করা) | 11 spec (`social-sn10.spec.ts`, no-winner assert সহ); live জোড়া publish হয়নি (checklist S15) |

Batch acceptance: `docs/social-sn-batch1-acceptance.md` …
`docs/social-sn-batch5-acceptance.md`।

## প্যাকেজের commit তালিকা (base `49dac3e` থেকে, মোট 34)

**Plan**: `8e96e60` (plan doc)
**N1**: `1bdb1e0` schema · `b3571c6` FB cover spike ·
`cc3ae38` SN1 API · `f0dfeb9` SN1 FB cover ·
`5430769` SN2 API · `3b56e9d` SN1 web · `cad46e2` SN2 web ·
`f51d2b6` docs
**N2**: `dd2882e` SN4 API · `3ec9ef9` SN3 web helpers ·
`89295a2` SN3+SN4 web · `04589f6` docs
**N3**: `03010cc` schema · `cf62572` SN5 API ·
`789a088` SN9 API · `9019f32` SN5 web · `2770853` SN9 web ·
`8fd9807` docs
**N4**: `ce8dfe6` spikes · `8c862a7` SN6 API ·
`5cf75ec` SN6 web · `df747e2` SN7 API · `45eaf89` SN7 web ·
`5bb4b2f` docs
**N5**: `ba186ac` schema · `4060ea1` SN8 settings/parser ·
`076871b` SN8 service/wiring · `87d8e01` SN8 specs ·
`41fd8b3` SN10 API · `b37668d` SN10 specs ·
`84c968e` SN8 web · `19db1b0` SN10 web · closing docs commit

## Migration তালিকা (মোট 3)

| Migration | বিষয় |
|---|---|
| `20261015100000_sn1_sn2_publishing_client` | youtubePlaylistId, SocialPostShareLink/ClientReview, socialRequireClientApproval |
| `20261015110000_sn5_sn9_stock_coach` | OrgStockConfig, SocialCoachDigest, MediaAsset.attribution |
| `20261015130000_sn8_sn10_syndication_caption_test` | SocialAutoDraftConfig rss/youtube toggles + rssFeedUrl, SocialSyndicationSeen, SocialPost.captionTestId |

(`20261015120000` ইচ্ছাকৃতভাবে ফাঁকা — কোনো batch ওই
নম্বর দাবি করেনি।) কোনো migration-ই আসল/production DB-তে
চলেনি; fresh Postgres 16-এ পুরো sequence 195/195 পরীক্ষিত
(closing gate, N5 acceptance)।

## Final gate (closing, N5 acceptance-এ বিস্তারিত)

API jest FULL (chunked) **410 suites / 4358 tests ALL PASS**
· Web vitest **56 files / 466 PASS** · tsc API/web/admin
**0/0/0** · Prisma valid · Build **7/7** · Fresh-PG
**195/195, 260 tables**।

## Deploy checklist

1. **Integration**: `social-next`-এর base main `49dac3e`।
   এর ওপর অন্য track (R2 media line, GC completion,
   integration-6-পরবর্তী কাজ) এগিয়ে গেছে — release-এর
   আগে একটি integration branch-এ union করতে হবে এবং
   **union tree-তে fresh-PG পুরো sequence আবার চালানো
   বাধ্যতামূলক** (migration সংখ্যা তখন 195-এর বেশি হবে;
   SN-এর 3 migration অন্য line-এর migration-এর সঙ্গে
   timestamp সংঘর্ষে নেই — SN range `20261015100000`–
   `20261015130000`, R2 range `20261016000000+`)।
2. Push মালিকের স্পষ্ট নির্দেশে; তারপর Dokploy Redeploy
   (migration গুলো তখনই আসল DB-তে চলবে)।
3. **Per-org job template চালু করতে হবে** (Automations-এ,
   প্রতিটা default OFF):
   - `social_coach_weekly` (SN9)
   - `social_syndication_sweep` (SN8)
   - (আগের package থেকেই owed: `social_publish_due`,
     `social_evergreen_sweep`, `social_follower_snapshot`)
4. **Admin → Platform Config**: Threads App (threadsApp)
   বসাতে হবে Threads publish-এর জন্য (platform app পথ);
   tenant নিজের Threads app ব্যবহার করলে Connect Center-এর
   own-app পথ আছে।
5. **Org setup (tenant নিজে, app-এর form-এ)**:
   - Pexels API key (Media Library → Stock) — SN5
   - Telegram bot token + channel (Social Posts → Settings)
     — SN6; bot-কে channel admin করতে হবে
   - RSS feed URL + toggles (Settings → Auto-Draft) — SN8
   - `API_PUBLIC_URL` env (share/tracked link-এর পূর্ণ URL-এর
     জন্য, SU থেকে owed)

## Owner-gated যা রয়ে গেল (live প্রমাণ)

সবই `docs/social-live-verification-checklist.md`-তে —
S1–S10 (SU0, আগের) + এই প্যাকেজে যোগ হওয়া **S11–S15,
সব box UNCHECKED**:

- SN0/SU0 live verification পুরোটাই (Meta/YouTube/Gemini
  আসল অ্যাকাউন্টে publish ও insights)
- Threads App Review + আসল Threads publish (S12)
- TikTok audit (photo/direct পথ gate খুলতে)
- Telegram আসল bot + channel-এ publish পরীক্ষা (S11)
- Pexels আসল key দিয়ে import + overlay (S13)
- Client share link আসল ক্লায়েন্ট-ভূমিকায় (S13)
- Coach digest এক সপ্তাহের আসল data-তে (S14)
- Syndication আসল feed/নিজের channel + caption test
  আসল জোড়া (S15)
- Screenshot QA (design + নতুন surface গুলো deploy-এর পর)

কোনো SN ফিচারই live-proven নয় — সব প্রমাণ
stubbed-boundary spec, vitest, build ও fresh-DB স্তরে।
