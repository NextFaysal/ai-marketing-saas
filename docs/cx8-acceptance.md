# CX8 — Packing Label Scan + Image Product Recognition — Acceptance

**তারিখ:** ২০২৬-১০-১২ · **ভিত্তি:** `docs/cx-package-plan.md` (Batch 5, CX8) · **অবস্থা:** LOCAL ONLY — uncommitted, কোনো push নয়।

## যা বানানো হয়েছে

### ভাগ করা ক্ষমতা — VisionService (`apps/api/src/ai/vision.service.ts`)
- `analyzeImage(orgId, userId, { imageBase64 | imageBytes, mimeType, prompt, feature })` — provider আসে `LlmFactory` থেকে, অর্থাৎ chat-এর একই effective config (Admin Console setting, নয়তো `LLM_*` env)।
- **Shipped vision-capable provider set: OpenAI + Gemini + Anthropic** — তিনটিরই বিদ্যমান client shape-এ `completeVision` যোগ করা হয়েছে (নতুন ঐচ্ছিক method, `LlmProvider` interface-এ):
  - OpenAI: chat/completions-এ `image_url` data-URI content part;
  - Gemini: generateContent-এ `inlineData` part;
  - Anthropic: Messages API-তে base64 `image` content block।
- **Usage/kill-switch discipline (creative-studio/chat-এর হুবহু প্রতিচ্ছবি):** provider HTTP-র **আগে** platform kill switch → per-feature daily cap (`AIUsageRecord`-এ ওই feature-এর আজকের count, `platform-settings`-এর effective limit)। Block হলে HttpException 403/429। সফল কলের **পরে** একটি `AIUsageRecord` — feature = caller's key, provider, model, tokens; `estimated` পতাকাটি provider result থেকেই আসে (reports.service.ts precedent)।
- **Feature keys:** `vision_label_scan`, `vision_product_match`।
- **Unavailable কখনো throw নয়, কখনো বানানো নয়:** dev-template provider / অকনফিগার্ড বা ভাঙা config (factory-র `LlmConfigError` ধরা হয়) / vision-বিহীন provider → `{ available: false, reason }`। আসল provider ব্যর্থ হলে error verbatim propagate হয় এবং কোনো usage লেখা হয় না।

### (ক) Label scan (`apps/api/src/cx8/label-scan.service.ts`, `label-extract.ts`)
- Endpoint: `POST organizations/:organizationId/courier/label-scan` (multipart `file`, FileInterceptor, **cap 8MB** — multer route-এ + service-এ পুনঃযাচাই; নিজস্ব `Cx8MulterErrorFilter` কারণ CX9-এর filter-এ তার নিজের 10MB বার্তা আছে) এবং `POST .../courier/label-lookup` (plain নম্বর খোঁজ)। `@PermissionArea("courier")`, TenantGuard + RolesGuard, staff roles (OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT)।
- Upload যাচাই **magic bytes** দিয়ে (`inbox/media-sniff.ts`-এর `detectMediaKind` পুনঃব্যবহার): শুধু JPEG/PNG/WebP ছবি; PDF-কে `.jpg` নাম দিলেও সৎ Bengali 400।
- Extraction prompt শুধু ছবিতে ছাপা মান চায়; parse defensive (fence-strip + outermost `{...}` + try/catch) — garbage → `extracted = {}`। Shape validation: tracking/order = trimmed alphanumeric-ish, 4–40 chars; `phoneLast4` = ঠিক 4টি ASCII digit, নয়তো **drop** (truncate করা হয় না — করা হলে অন্য customer-এর last-4 বানিয়ে ফেলা হতো)।
- **Lookup precedence (এই org-এই শুধু):** ১) exact `CourierShipment.trackingCode` → single match; ২) exact order number (`externalNumber` অথবা `externalId`) → ঠিক একটি order থাকলেই single match; ৩) `phoneLast4` শুধু **candidate সঙ্কুচিত** করে (recipientPhone endsWith, সর্বোচ্চ 5) — কখনোই একা single match নয়। Exact identifier মিল না পেলেও phone narrowing চলে। মিল নেই → `{ matched: null, candidates: [], extracted }` — extracted মান দেখানো হয় যাতে মানুষ হাতে খুঁজতে পারে।
- Vision unavailable → endpoint সৎ অবস্থা ফেরত দেয়: "AI ছবি পড়া এখন সেটআপ করা নেই — নিচে নম্বর দিয়ে খুঁজুন" — আর **নম্বর খোঁজ AI ছাড়াই পুরোপুরি চলে**।
- Web (orders page): "📷 Label Scan" file action + "🔢 নম্বর দিয়ে খুঁজুন" বক্স। পাশে সৎ লেবেল: কীবোর্ডের মাইক দিয়ে নম্বর বললে তা এই বক্সেই বসে — আলাদা কোনো STT ফিচার দাবি করা হয়নি। ফলাফল: exact match-এ explicit "অর্ডারটি খুলুন" বোতাম, candidate তালিকা থেকে হাতে বাছাই, no-match-এ extracted মানসহ সৎ বার্তা।

### (খ) Image product recognition (`apps/api/src/cx8/product-recognition.service.ts`, `product-match.ts`)
- Endpoint: `POST organizations/:organizationId/inbox/conversations/:conversationId/messages/:messageId/recognize-product` (`@PermissionArea("inbox")`, staff roles)। শুধু **inbound image** message; conversation org-scoped যাচাই হয়।
- Bytes: message-এর `mediaStorageKey` দিয়ে **MediaStore** থেকে (U6-র stored copy); fallback হিসেবে stored `mediaUrl` fetch; কোনোটাই না থাকলে সৎ Bengali error, vision call হয় না।
- Vision description JSON `{ category?, color?, type?, visibleText?, keywords[] }` — একই defensive parse।
- **Catalog match (pure scorer `rankProductCandidates`):** Audit সত্য — Product-এ `images[]`/`tags`/`keywords` field **নেই**; আছে `name, category, description, sku` আর একটিমাত্র `imageUrl`। Scorer description-এর token গুলোকে ওই field গুলোর বিপরীতে weighted overlap-এ মাপে (name > category > description/SKU; type > category > visibleText > color/keyword)। **Conservative floor = 3** — একক দুর্বল keyword মিল candidate নয়। সমান text score-এ `imageUrl`-ওয়ালা product আগে (boost শুধু tiebreak ordering, score-এ যোগ হয় না — score সৎ থাকে)। সর্বোচ্চ 5, প্রতিটিতে Bengali match reasons। Org-এর `ACTIVE` product-এর মধ্যেই সীমিত (সর্বোচ্চ 500 row scan cap), অন্য org-এর product কখনো score হয় না। Price আসে আসল product row থেকেই (`formatMinor`)।
- **এই flow কখনো পাঠায় না:** `ProductRecognitionService`-এ কোনো inbox/send seam আমদানিই করা হয়নি — service শুধু পড়ে। Spec প্রমাণ করে flow চলাকালে `channelMessage`/`channelConversation`-এ create/update/delete শূন্য বার হয়েছে।
- Web (inbox page): inbound ছবির নিচে "🔍 ছবি দিয়ে প্রোডাক্ট খুঁজুন" → প্যানেলে thumbnail, নাম, আসল দাম, match reasons; এক click-এ composer-এ খসড়া বসে (বিদ্যমান product picker-এর "টেক্সট বসান" seam-এর ধাঁচে) — **auto-send কখনোই নয়**।
- **সততার বাক্য (UI প্যানেলে ও এখানে হুবহু):** "এটি ছবির সাথে ছবির মিল নয় — AI ছবিটি বর্ণনা করে, সেই বর্ণনা দিয়ে catalog খোঁজা হয়"
- Vision unavailable → প্যানেলে সৎ খালি অবস্থা, কোনো candidate নয়, কোনো দাবি নয়।

## Migration
**NONE** — কোনো schema বদল লাগেনি। `AIUsageRecord`, `CourierShipment`, `Order`, `Product`, `ChannelMessage` সবই বিদ্যমান model।

## Audit বিস্ময় (design বদলেছে)
1. **একটি vision পথ আগেই ছিল** — `inbox/media-intelligence.ts`-এর `extractPaymentScreenshot` সরাসরি `LLM_*` env পড়ে নিজে provider call করে; কোনো usage record, kill switch বা cap নেই। CX8 সেই পথ copy করেনি — VisionService platform discipline-এর ভেতর দিয়ে যায় (coordinator-এর "no describe-image call" anchor-এর সাথে এই অমিলটি নথিভুক্ত থাকল)।
2. **Product-এ images[] নেই** — একটিমাত্র `imageUrl` (আর `bumpImageUrl`, যা upsell accessory — boost-এ গণনা হয় না)।
3. **InboxService স্পর্শ করার দরকার পড়েনি** — recognition সরাসরি MediaStore থেকে bytes পড়ে, তাই AG1-স্পর্শিত `inbox.service.ts`-এ শূন্য edit। Label scan-ও নতুন service — AG1-স্পর্শিত `courier.service.ts`-এ শূন্য edit।
4. CX9-এর `MulterErrorFilter`-এর বার্তায় 10MB hardcoded — CX8-এর 8MB cap-এর জন্য নিজস্ব filter লেখা হয়েছে।

## Evidence ceiling (সৎ সীমা)
- Sandbox-এ **Postgres নেই, live HTTP নেই**: প্রমাণ = fake-prisma specs + provider fetch-seam-এ faked HTTP + পুরো jest suite + builds। **কোনো আসল vision read দাবি করা হয়নি** — আসল ছবি পড়া যাচাই হবে M30-pattern live key দিয়ে।
- Web build এই মুহূর্তে parallel-track-এর worktree deletion (`apps/web/src/lib/automation-blueprints.ts` deleted, `automations/page.tsx` এখনো import করে)-এ আটকে — CX8-এর কোনো ফাইলের কারণে নয়; CX8-স্পর্শিত web ফাইলগুলোতে `tsc` error শূন্য।

## Gates (সংখ্যা)
- Targeted API specs: `vision.service.spec.ts` 10 + `cx8.spec.ts` 26 + `llm/providers.spec.ts` 11 = **47/47 pass**।
- Full API jest: **1765 pass / 1767** (198/205 suites)। Failed 7 suites সবই parallel-track: `courier/courier.spec.ts` ও `customers/c3-customers-export.spec.ts` (AG1 assertion — c3 failure-এ AG1-এর যোগ করা CSV column গুলোই দেখা যায়) এবং `inbox/m66-visitor-stream`, `inbox/nextgen-p2`, `inbox/nextgen-p3`, `inbox/phase-f`, `workflows/a2-shipment-di` — সবকটি `inbox/webchat.service.ts:195 TS2304 parseCourierCard` compile-blocked। **একটিও CX8 ফাইলে নয়।**
- API `tsc --noEmit`: একমাত্র error ওই একই পরিচিত `webchat.service.ts` TS2304; API build (`tsconfig.build.json`) একই কারণে blocked — CX8 ফাইলে শূন্য error।
- Web vitest: **100/100 pass** (CX8-এর নতুন `lib/cx8.test.ts` 4টি সহ)। Web `tsc`: 3টি error, সব `automations/page.tsx`-এ (pre-existing owner-merge/parallel-track), CX8 ফাইলে শূন্য।
