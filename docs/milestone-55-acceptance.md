# Milestone 55 Acceptance — AI Creative Studio (grounded copy variants + policy pre-flight + one-click campaign draft)

- [x] **Built on the existing AI stack, no parallel machinery.** Generation goes
      through `LlmFactory` (dynamic platform config, Admin → env → default),
      enforcement mirrors `ChatService.checkDailyLimit` exactly (kill switch
      from `platform-settings` → 403 with the same message; daily cap via
      `effectiveLimits`), the policy check is the existing deterministic
      BN+EN `policyFindingsForText` from Phase L, and the draft is created
      through the existing `CampaignsService.createPlan → addAdSet → addAd`
      path. No schema change; variants are NOT persisted (generation is
      stateless — the campaign draft is the artifact).
- [x] **Endpoints** (`AiController`, Roles OWNER/ADMIN/MARKETING_MANAGER):
      `POST /organizations/:id/ai/creative-studio/generate` and
      `POST /organizations/:id/ai/creative-studio/draft`.
- [x] **Grounded generation.** The prompt carries ONLY the product's real
      facts (name, formatted price, compare-at price when the field exists,
      category, description, stock quantity when recorded, brand voice) plus
      the user's optional goal/tone, and instructs the model to never invent
      prices, discounts, stock, delivery promises, features or results.
      Output is parsed defensively: a variant without a non-empty headline
      and primary text is dropped, never shown half-broken; an invalid or
      missing CTA is coerced to `SHOP_NOW` (CTA set = 14 Meta values,
      `STUDIO_CTAS`); at most 5 variants are returned. Zero usable variants
      → `400 "The AI provider returned no usable copy variants. Nothing was
      saved."` (mirrors the existing generateCopy behaviour).
- [x] **Policy pre-flight on EVERY variant.** Each variant (real-LLM and
      dev-template paths alike) is checked with `policyFindingsForText`
      over headline + primary text and returned with
      `policy: { status: "pass" | "flagged", findings }` — findings are the
      checker's own rule/severity/snippet/explanation/suggestion verbatim.
      The UI shows a green pass badge or a red/amber warning with the
      findings; a flagged variant is never presented as clean. Passing is
      NOT a Meta approval guarantee (same caveat as Phase L).
- [x] **Enforcement parity with AI chat.** Kill switch → 403 before any
      work; daily cap counts today's `AIUsageRecord` rows for feature
      `creative_studio` against the org's effective `aiDaily` limit → 429.
      Every generation (real or dev-template) writes an `AIUsageRecord`
      with `feature: "creative_studio"` (real path: provider/model/token
      counts from the provider result; dev path: `estimated: true`).
      Provider errors are surfaced VERBATIM (the provider's own message as
      the 400 body) and write no usage record.
- [x] **Dev-adapter honesty.** When no real LLM is configured, the studio
      returns 3 template variants built ONLY from the product's real fields
      (name/price/category/description/compare-at stated as the two real
      prices — no invented discount percentages), `isRealLlm: false`, and
      the notice: "আসল AI (LLM) কনফিগার করা হয়নি — এগুলো Dev Template
      Adapter দিয়ে বানানো সাধারণ টেমপ্লেট, আসল AI জেনারেশন নয়।" The UI
      shows that notice in an amber banner. A template is never presented
      as a real AI generation.
- [x] **One-click campaign draft — DRAFT only.** `createDraft` re-validates
      the submitted copy server-side (the client is never trusted),
      recomputes the policy findings, resolves the landing link exactly
      like generateCopy (`linkUrl` → Business Knowledge website URL →
      the same verbatim 400), then creates: plan `AI Studio: <product>`
      (objective `OUTCOME_SALES`, status `draft`), one ad set
      `AI Studio — BD Broad` (daily budget "500", `OFFSITE_CONVERSIONS`,
      BD, ages 18–65 — the same documented STARTING values the built-in
      `cod_sales` blueprint uses; the user must review them), and one ad
      carrying the variant's headline/primary text/CTA with
      `productId` set, `createdByAi: true`, and the product's own image
      URL when it has one. The response `note` states in Bengali that
      nothing was published or launched and that budget/targeting are
      starting values to verify (Page/Pixel included) in Campaign Builder.
      Nothing in this flow can publish: it only calls the draft-creation
      methods.
      Carries over: headline, primary text, CTA, product link, product
      image. Does NOT carry over: Page ID / Pixel ID (the org must pick
      them in Campaign Builder — plan validation will refuse submit
      without them), any user-edited budget/targeting.
- [x] **Image generation verdict: honestly ABSENT.** The codebase has no
      image-generation provider (the Creatives module is an asset library
      — upload/existing media only; grep for image-generation providers
      finds none). Per the no-mock rule nothing was faked: the Studio is
      copy-only and the page states it permanently: "🖼️ ছবি তৈরির সুবিধা
      এখনো যুক্ত হয়নি — Creative Studio এখন শুধু বিজ্ঞাপনের লেখা (কপি)
      তৈরি করে। ড্রাফটে পণ্যের নিজের ছবি (যদি থাকে) ব্যবহৃত হবে।"
- [x] **UI** (`/dashboard/creative-studio`, nav entry after Campaign
      Builder): real product picker (name + formatted price), optional
      goal, tone select, BN/EN toggle, variant cards with policy badges
      and verbatim findings, Meta ad-account picker (connected Meta
      accounts only), optional landing-link field, per-variant
      "ক্যাম্পেইনে ব্যবহার করুন" with the API note + draft id + Campaign
      Builder link on success and the server message verbatim on error.
- [x] **Tests.** 12 new service tests (`creative-studio.spec.ts`, real
      CampaignsService over a fake prisma): real-LLM 4 variants incl. an
      "আপনি কি" variant flagged `personal_attributes` and invalid-CTA
      coercion; malformed variants dropped / all-malformed 400; provider
      error verbatim with zero usage rows; dev-template 3 variants +
      notice + `estimated: true` + real price in text; cross-org product
      404; kill-switch 403; per-org override cap → 429; draft happy path
      (draft plan/ad set/ad rows, `createdByAi`, product link) and its
      failure modes. Full API suite: **562 pass / 79 suites** (baseline
      539/77). Web tests unchanged 20/20. Full monorepo build green
      (route `/dashboard/creative-studio` 4.46 kB).
- [x] **Live-proven on the sandbox** (API + web restarted on the new
      build): generate with the sandbox's effective config resolved to
      the dev-template provider → 3 variants, `isRealLlm: false`, the
      Bengali dev notice verbatim, policy statuses [pass, pass, flagged]
      (the checker demonstrably fires live), usage row
      `creative_studio | dev-template | estimated=t` in the DB;
      cross-org/unknown product → 404; draft with an unknown ad account →
      the createPlan 400 verbatim; draft happy path with a seeded Meta
      account and deliberately policy-violating copy ("আপনি কি…") → plan
      created, DB status `draft`, ad row `createdByAi = t` with the
      product id and the Business-Knowledge website as link, response
      policy `flagged` with rule `personal_attributes`; page serves 200
      and the built chunk contains the studio UI + image-honesty text.

## Honest limits
- The real-LLM generation path is proven by unit tests with a stubbed
  provider (the full pipeline — prompt grounding contract, parsing,
  coercion, policy, usage, verbatim errors). It was NOT re-run live in
  this milestone because the sandbox currently has no real LLM
  configured; the shared `LlmFactory`/Gemini path itself was live-proven
  in Milestone 46. Configuring a real key (Admin → Dynamic Platform
  Config) switches the studio to real generation with no code change.
- No pixel QA / real-browser click-through of the studio page (build +
  chunk markers + page-serves + API behaviour verified, as for prior
  web milestones).
- The per-feature daily cap counts `creative_studio` generations against
  the same effective `aiDaily` limit value the chat uses for `chat`
  messages (mirroring ChatService's per-feature counting); the two
  features do not share one pooled counter.
