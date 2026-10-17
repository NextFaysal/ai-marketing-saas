# NF2 (FB1 Part B) — Short Video Commerce Studio: Backend Acceptance

**তারিখ:** ২০২৬-১০-১৭ · **Worktree:** `ai-marketing-saas-nf` (branch `new-frontier`) · **Base:** 11c22133
**Scope:** NF2 backend only — Dockerfile, data model, ffmpeg template renderer + job, API + publish.
Local commits only; **push হয়নি** (owner-এর explicit push instruction ছাড়া push নয়)।

---

## Per-item record

### Item 1 — Dockerfile ffmpeg · commit `443fa01c`
Root `Dockerfile` runtime stage-এর একমাত্র apt line-এ `ffmpeg` যোগ:
`openssl ca-certificates fontconfig fonts-noto-core ffmpeg` — আর কিছু বদলায়নি।
**কার্যকর হবে শুধু owner-এর পরবর্তী Dokploy redeploy-এর পর** — ততদিন production image-এ
ffmpeg নেই, এবং তখন পর্যন্ত প্রতিটি render Item 3-এর honest-label পথে fail করবে।

### Item 2 — VideoProject data model + migration · commit `f9b2cacd`
- Prisma `VideoProject`: organizationId, productId, template (String, service-validated
  v1 `"showcase" | "offer"`), language (String, `bn | en`), offerText?, status
  (String, default `queued`: queued | rendering | ready | failed), mediaAssetId?
  (→ MediaAsset, SetNull), errorLabel?, socialPostId? (→ SocialPost, SetNull),
  createdById, timestamps। Relations: Organization, Product (Cascade), MediaAsset,
  SocialPost; back-relations চারটি মডেলেই যোগ। Indexes: `(organizationId, status)`,
  `(organizationId, createdAt)`, `productId`, `mediaAssetId`, `socialPostId`।
- Migration: `20261029000000_nf_video_projects` (claim range 20261028000000+; 28 = NF1)।
- Gates: `pnpm db:generate` OK · `prisma validate` OK।

### Item 3 — Provider port + ffmpeg renderer + job · commit `7e591beb`
- **Port:** `apps/api/src/video-studio/ffmpeg-video.provider.ts` —
  `VideoGenerationProvider` interface (`render(input) → {filePath, durationSec, width, height}`),
  typed `VideoRenderError` (Bengali `label`)। Binary path injectable:
  constructor arg → `FFMPEG_PATH` env → `"ffmpeg"`।
- **v1 impl `FfmpegTemplateVideoProvider`:** vertical 1080×1920 mp4; প্রতি ছবি একটি
  3s slide (scale/crop 2× → zoompan Ken Burns), সর্বোচ্চ 5 slide = 15s, সর্বনিম্ন 1 = 3s;
  concat demuxer দিয়ে join; শেষে drawbox band + drawtext (product name, price,
  `"offer"` template-এ offer line)। Tenant text `textfile=` দিয়ে যায় — ffmpeg
  escaping-এর ঝুঁকি নেই। Font: language অনুযায়ী প্রথম EXISTING candidate —
  bn: `/usr/share/fonts/truetype/noto/NotoSansBengali-Bold.ttf` → `-Regular` → `NotoSans-Bold`;
  en: `NotoSans-Bold` → `-Regular` (fonts-noto-core-এর পথ; PP1 poster-ও একই package-এর
  Noto Bengali-র উপর নির্ভর করে); কোনো ফাইল না থাকলে fontconfig family name fallback।
  `child_process.execFile` — নতুন কোনো npm dependency নেই। Temp ফাইল `os.tmpdir`-এ,
  service `finally`-তে cleanup করে।
- **Honesty:** render শুরুর আগে binary check (`-version`); ENOENT →
  `"ffmpeg পাওয়া যায়নি — সার্ভারে ভিডিও রেন্ডার সম্ভব নয়"`। যেকোনো render failure →
  project `status=failed` + `errorLabel` (আসল কারণ; ffmpeg stderr-এর tail সহ) এবং
  **কোনো MediaAsset তৈরি হয় না**।
- **Image resolution (কোনো invented storage path নেই)** — `VideoStudioService.bytesForImageUrl`,
  ক্রমানুসারে: (1) ওই sourceUrl-এর জন্য org-এর already-imported MediaAsset →
  `MediaStore.get(storageKey)`; (2) নিজেদের CDN URL → `mediaKeyFromCdnUrl` (storage/media-url.ts)
  → `MediaStore.get`; (3) `/public/media/<token>` URL → token-ধারী asset; (4) primary
  `product.imageUrl` → `SocialImportService.importForProduct` (একমাত্র SSRF-guarded import পথ,
  deduped) → asset row → `MediaStore.get`; (5) অন্য remote gallery URL →
  `SocialImportService.fetchGuardedImageBytes` (এই batch-এ যোগ করা public wrapper —
  একই guarded fetch-এর উপর; কোনো দ্বিতীয় bare fetch পথ তৈরি হয়নি)। Bytes ffmpeg-এর
  আগে `detectMediaKind` দিয়ে sniff হয়; ছবি না হলে নামসহ failure।
  Cover = `Product.imageUrl`, তারপর `ProductImage` rows position asc, dedupe, cap 5।
  Price text: `formatMinor` (@repo/contracts) — বিদ্যমান pattern।
- **Output storage:** `MediaStore.put` → MediaAsset `kind: "video"`,
  `contentType: "video/mp4"`, `origin: "video_studio"` (origin একটি String column —
  free value নিরাপদ), storageKey `${organizationId}/video-studio/<uuid>.mp4`,
  `publicToken` creation-এই mint (SocialService.createPublicLink-এর একই
  randomBytes(32) base64url pattern) — তাই web preview বিদ্যমান
  `storedAssetPublicUrl` পথেই (`/public/media/<token>` অথবা CDN URL) চলে;
  **নতুন কোনো public file route বানানো হয়নি**।
- **State machine / idempotency:** `renderProject(orgId, projectId)` —
  queued → rendering → ready | failed একই method-এ; ready project = no-op
  (দ্বিতীয় asset কখনো নয়); fresh rendering = in-flight no-op; stale rendering
  (>10 min, `RENDERING_STALE_MS`) = retry। ব্যর্থতা throw না করে project row-তেই
  record হয়ে return হয়।
- **Job:** `video_render_sweep` — `JOB_TYPES`-এ নিবন্ধিত + `AutomationService.executeJob`
  case (`AutomationService`-তে optional injection সবার শেষে append; AutomationModule
  VideoStudioModule import করে — OrgBrain/KnowledgeIndexing leaf pattern, cycle নেই)।
  Sweep: org-এর queued (+ stale rendering) project, run প্রতি সর্বোচ্চ 10,
  `{processed, ready, failed}` report। Per-org enablement অন্য সব sweep-এর মতোই
  ScheduledJob row দিয়ে — **কোনো org-এর জন্য job enable করা হয়নি** (owner-owed)।

### Item 4 — API + publish · এই commit
- **Controller** `apps/api/src/video-studio/video-studio.controller.ts`:
  `@PermissionArea("social")` — **সিদ্ধান্ত:** studio-র output-ই একটি social post এবং
  publish `SocialService.createPost` দিয়েই হয়, তাই পুরো surface social area-র অধীনে;
  products/orders area একটি publishing tool-কে ভুলভাবে gate করত। LiveCommerce/Pos
  conventions: `organizations/:organizationId` base, TenantGuard + RolesGuard,
  writes = OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT।
  Routes: `POST video-projects` (create → queued view return + fire-and-forget
  `void renderProject(...).catch(...)`; sweep reconcile করে), `GET video-projects`
  (newest first, product name + ready হলে asset URL), `GET video-projects/:id`,
  `POST video-projects/:id/render` (manual retry), `POST video-projects/:id/publish`।
- **Publish** (`publishProject`): শুধু `status=ready` হলে; `SocialService.createPost`
  দিয়েই — **publishNow কখনো ডাকা হয় না**; post Social engine-এর নিজের flow-তেই
  draft হিসেবে জন্মায়। mediaRefs: `[{assetId, kind: "video"}]`। Account: caller-এর
  `socialAccountId` (createPost নিজে org-ownership validate করে), না দিলে org-এর
  প্রথম connected account (SocialCommerceDraft fallback pattern); কোনো connected
  account না থাকলে honest Bengali 400। Caption default: product name + real
  `formatMinor` price। **Link:** MS5-এর বিদ্যমান নিয়ম হুবহু —
  `${webBaseUrl()}/checkout/${slug}` (webBaseUrl: `courier/tracking-token.ts`)
  **শুধুমাত্র product-এর slug থাকলে**; slug না থাকলে linkUrl ছাড়াই publish হয় —
  কোনো URL fabricate করা হয়নি। `socialPostId` set হয়; দ্বিতীয় publish একই post
  return করে, createPost দ্বিতীয়বার ডাকেই না।

## Spec / gate ফলাফল

| Gate | ফলাফল |
|---|---|
| `video-studio.spec.ts` (Item 3) | 7/7 PASS |
| `video-studio.spec.ts` (Item 4-এর পর মোট) | **12/12 PASS** |
| Automation regression (a4-job-templates, automation.service, cx3-jobs, rb6b-mirror-job) | 24/24 PASS |
| SocialImport regression (social-pp3, social-sn8) | 82/82 PASS |
| `pnpm --filter @repo/api lint` (tsc --noEmit) | PASS (Item 3 ও Item 4 দুই বারই) |
| `pnpm --filter @repo/api build` | PASS (দুই বারই) |
| Full api suite / fresh-PG | **চালানো হয়নি — নির্দেশ অনুযায়ী coordinator serially চালাবে** |

Spec প্রমাণ (fake-prisma harness, live-commerce.spec pattern):
- Real ffmpeg render: checked-in fixture নয় — spec নিজে ffmpeg দিয়ে PNG বানিয়ে
  MediaStore-এ রাখে; render-এর পর **stored mp4 bytes ffprobe দিয়ে probed**:
  width 1080, height 1920, codec h264, duration ~6s (2 images × 3s)।
- Corrupt source (টেক্সট bytes) → failed + errorLabel-এ "ছবি", MediaAsset সংখ্যা অপরিবর্তিত।
- Bogus binary path injection → provider unit স্তরে ও service স্তরে দুই জায়গাতেই
  "ffmpeg পাওয়া যায়নি" label, কোনো asset নয়।
- Idempotency: ready project re-render → একই mediaAssetId, ঠিক 1টি video asset;
  publish twice → createPost ঠিক 1 বার।
- Org isolation: create/read/render/list/publish — সব জায়গায় org B → 404 / খালি list,
  foreign attempt-এ কোনো mutation নয়।
- Publish: non-ready refusal createPost-এর আগেই; default account = প্রথম connected;
  explicit account/caption জেতে; slug-less product → linkUrl undefined।
- Controller: create queued view return করে এবং renderProject ঠিক 1 বার trigger করে।

## NOT BUILT / সীমাবদ্ধতা (সৎ তালিকা)

- **Web/Admin UI নেই** — এই batch শুধু backend; studio-র পৃষ্ঠা পরের batch-এর কাজ।
- **কোনো external AI video provider নেই** — D3 (owner decision) pending; v1 template
  render-কেই কোথাও "AI-generated" বলা হয়নি।
- **Bengali drawtext shaping:** ffmpeg drawtext (freetype) যুক্তাক্ষর shaping-এ
  সীমিত হতে পারে — textfile পথে text ঠিকঠাক পৌঁছায়, কিন্তু complex conjunct
  rendering browser-grade নয়। Spec pixel-level shaping assert করে না।
- **Audio নেই** — v1 video silent (কোনো music/voice track যোগ হয়নি; দাবিও করা হয়নি)।
- **Live proof নেই:** কোনো migration real DB-তে চলেনি, production-এ ffmpeg এখনো
  নেই (Item 1 redeploy-নির্ভর), কোনো org-এর `video_render_sweep` job enable হয়নি,
  আসল product image দিয়ে live render বা আসল social account-এ publish — কোনোটাই
  যাচাই হয়নি। M30-style live verification owner-owed।
- Template মাত্র দুটি (`showcase` / `offer`) — offer band শুধু `offer` template-এ
  offerText থাকলে আসে; `showcase`-এ offerText সংরক্ষিত থাকে কিন্তু আঁকা হয় না।
