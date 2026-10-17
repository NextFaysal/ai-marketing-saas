# Smart AI Phase 0 — Batch SA-B5 Acceptance (P7 Performance Learning + P8 Brand Voice & Customer Memory)

Date: 2026-10-17. Branch `smart-ai`, base `bad7eec7` (SA-B4).
Local commits only; nothing pushed.

Commits:
- `a090df95` — Item 1 (P7): schema + migration + PerformanceLearningService + LearningService performance source/visibility rule.
- `9c529fdb` — Item 2 (P8a): VoiceLearningService + BrandVoiceController.
- `94f69e06` — Item 3 (P8b) + Brain read side: CustomerMemoryService, OrgBrainService sections (performance / voice style / customer memory + the `own_customer` audience), inbox pack + prompt plumbing, mining-sweep memory hook, AutomationService sweep wiring. (The shared read-side files — org-brain.service, automation.service, inbox.service — carry all three items' wiring and land in this commit so every commit in the batch type-checks standalone.)
- `b1a6e4be` — Item 4: specs (17 tests).
- (this doc's commit follows)

## Step 0 — reality check in this tree (brief vs code)

**Outcome data inventory — what is REAL and queryable per org:**

| Source | Real fields | Used for |
|---|---|---|
| Inbox conversations | `ChannelConversation.status` (open/pending/closed), `outcome` (closed vocabulary: sale, no_sale_price, no_sale_stock, no_sale_undecided, support_resolved, spam, other), `resolvedAt`, `csatRating` | conversations handled/closed, outcome breakdown, CSAT average |
| Inbox authorship | `ChannelMessage.autoReply` + `sentByUserId` | AI-resolved = closed with ≥1 autopilot reply and ZERO staff-sent messages (deterministic) |
| Chat orders | `Order.conversationId` (chat/bot orders carry it), `totalMinor`, `status` | orders-from-inbox count + value (value excludes cancelled/refunded/failed, mirroring `DailyMetricAggregate`'s revenue definition) |
| Orders / items | `Order` + `OrderItem.productId/name/quantity/totalMinor` | order count, revenue, best-sellers (live orders only) |
| Returns | `ReturnRequest.reason` (free text), `createdAt` | return count + top reasons as EXACT recorded strings (no invented grouping) |
| Reviews | `OrderReview.rating`, `receivedAt` | count, average, 1–5 distribution |
| Ads | `DailyAdMetric` (spend/conversions/conversion value per day), `AdCampaign.name` | spend, platform conversions, ROAS, top campaigns — campaign-level rows only (`adExternalId = ""` and `adSetExternalId = ""`; ad/ad-set rows roll up into them, summing all would double-count) |
| Broadcasts | `Broadcast.sentCount/failedCount/totalRecipients/sentAt/status`, `MessageDelivery.deliveryStatus` (delivered/read, written only by real signals) | per-broadcast sent/failed/delivered/read |
| Social posts | `SocialPost.insights` Json (stored exactly as the platform returned; absent keys stay absent) | top posts by engagement, computed only over posts WITH insights |

**What does NOT exist (recorded, not fabricated):**
- **Per-broadcast reply attribution** — broadcast replies land in the Unified Inbox with no link back to the broadcast. NOT BUILT into the snapshot; delivery/read are the honest broadcast metrics.
- **Structured order-cancellation reasons** — `Order.status` is a raw platform string; there is no reason field. The loss-reason evidence P7 ships is the inbox outcome vocabulary (no_sale_price / no_sale_stock / …), which IS recorded.
- **A persisted CX1 reply-quality score table** — the inbox computes a `replyQuality` analytics aggregation on read (drafts + CSAT) but stores no per-reply score; P7 therefore uses outcome + CSAT aggregates, not a phantom score.

**Brand voice today:** `BusinessProfile.brandVoice` is free text, consumed as a "Brand voice:" fact line by creative-studio / campaigns / messaging / social-ai. The INBOX autopilot prompt does NOT consume it today — it consumes `aiInstructions` (published) + `aiReplyLanguage` through the fact pack. So the learned profile's style enters inbox composition as a new, separate block (Item 2), with the owner's free text keeping precedence (see the recorded rule under Item 2).

**Customer identity:** `ChannelConversation.externalContactId` — WhatsApp wa_id (phone) or Messenger PSID, unique per `(organizationId, channel, externalContactId)` by database constraint. That pair IS the stable per-customer key. **Audience reality:** SA-B1 shipped exactly two Brain audiences (`customer` | `internal`); the brief's "own_customer" did not exist. Item 3 adds it (below).

**Orders for customer history:** reachable two ways — `Order.conversationId` (the customer's own conversations) and `Order.customerId` when the conversation is linked to a Customer row. The memory writer uses both.

## Item 1 — P7 Performance learning (commit a090df95)

- **Schema** — migration `20261030000000_sai_perf_voice` (additive, all three SA-B5 tables in one folder so the batch adds exactly one migration): `PerformanceSnapshot` (metrics Json, `@@unique([organizationId, periodStart, periodEnd])`), `AiBrandVoiceProfile` (Item 2), `CustomerMemory` (Item 3). Organization gains the three back-relations.
- **PerformanceLearningService** (`ai/performance-learning.service.ts`): computes the trailing **7-day and 30-day** windows on every run — calendar-aligned UTC `[start, end)` — and upserts one snapshot per window, so recomputing the same day corrects the same rows. **No LLM anywhere**: every figure is a deterministic aggregate over the Step-0 sources (see the table); money is stored as minor-unit strings (BigInt-safe), rates as numbers or null. An org with NO source rows in the widest window is skipped honestly (`no_source_data`, recorded in `LearningState(source "performance")`) — no empty snapshots for orgs with nothing to learn from. The `performance_learning_sweep` job walks all orgs (cap 200); one org's failure never stops the sweep.
- **Brain surface**: `OrgBrainService` internal contexts now carry `performance` + `performanceFacts` — period-labelled Bengali lines (period dates + window always named, so a metric is never mistaken for an all-time figure). Customer-class contexts carry `performance: null` and `performanceFacts: []` exactly the way `internalProfile` behaves — the numbers are INTERNAL class (L3) and never enter the serialized customer context (spec-proven with sentinels).
- **Findings → review queue**: the top-3 findings of the 7-day window (best-selling product, top inbox loss reason, best ad ROAS — only those whose underlying datum exists) are created as SUGGESTED `LearnedItem` facts with `sourceType "performance"` (the SA-B4 union extended). Because the finding text carries its period, a new week produces a new suggestion, while a same-week recompute is stopped by the dedupe wall (spec-proven). **LearningService rule added**: performance facts default INTERNAL and approval forces `internal` even when the approver explicitly requests `public` — a metric-bearing fact can never be made customer-quotable (L3). The snapshot id rides `sourceRef` as the evidence link.

## Item 2 — P8a Brand voice (commits 9c529fdb + the read side in 94f69e06)

- **Home decision (recorded)**: the profile lives in its own `AiBrandVoiceProfile` row (`organizationId @unique`), NOT as a LearnedItem kind — it is a structured per-org singleton with an activation lifecycle (suggested → active, pending re-learn), not a piece of quotable knowledge content. The human decision still flows through explicit audited endpoints, the same review discipline as LearnedItem approval.
- **VoiceLearningService** (`ai/voice-learning.service.ts`), mirroring the mining service's structure: the **D4 gate is checked before any provider resolution** (toggle OFF ⇒ skipped, zero LLM calls — spec-proven with a resolver spy); kill-switched orgs skip; provider resolution is the chat layer's own (`resolveOrgLlmConfig` → `effectiveLlmConfig` → `buildLlmProvider`), never forked. It samples recent **staff-sent** messages only (AI `autoReply` messages and unsent drafts never count as the humans' voice), **PII-masks every sample before prompt assembly** (`maskSensitiveText`; spec proves the provider never sees a planted phone number), and records `AIUsageRecord{feature: "brand_voice_learning"}`. Fewer than 5 staff samples ⇒ honest skip (`insufficient_staff_messages`), no profile.
- **Anti-invention validation** (`validateVoiceSummary`): traits are coerced to the closed vocabularies (`formality`, `emojiUse`, `languageMix`, `avgSentence`); `greetingStyle`, every `signaturePhrases` entry and every `exampleSnippets` entry must appear **verbatim** (whitespace-normalised) in the masked samples or they are dropped — spec-proven with an invented phrase + invented example planted in the model's reply. A new summary lands as status `suggested`; while a profile is `active`, a re-learn writes ONLY the `pendingTraits/pendingExamples` columns — the live voice never changes silently (D3).
- **Activation surface**: `BrandVoiceController` under `organizations/:organizationId/brand-voice` (GET profile; POST `activate` — promotes a pending proposal or flips suggested→active; POST `dismiss` — drops a pending proposal or deletes a never-activated suggestion; an active profile with nothing pending refuses dismissal). Same guard discipline as LearningController (TenantGuard + RolesGuard, `@PermissionArea("ai")`, writes OWNER/ADMIN/MARKETING_MANAGER). Both transitions write audit rows (`brand_voice.activate` / `brand_voice.dismiss`).
- **Consumption + precedence (recorded)**: `OrgBrainService` renders an ACTIVE profile into `styleInstructions` (traits + examples, examples labelled "style reference only — never quote as facts"), exposed separately from `facts`/`factsText` so style can never leak into the verified-fact surface (spec-proven). **Precedence**: when `BusinessProfile.brandVoice` text is set AND a learned profile is active, the owner's text leads the block under an explicit "takes precedence … wherever they conflict" label and the learned style follows as supplementary (spec-proven by position). When NO active learned profile exists, `styleInstructions` is **null** — even for orgs with owner brandVoice text — so inbox composition is byte-identical to before SA-B5 (the owner's text keeps serving its pre-existing consumers via `publicProfile.brandVoice`, untouched). The inbox LLM prompt gains the style block beside the owner-instructions block, labelled "shapes WORDING ONLY — never facts, prices or promises"; customer-class contexts expose only an ACTIVE profile (the internal audience also sees suggested/pending state for the review surface).

## Item 3 — P8b Customer memory (commit 94f69e06)

- **Key choice (recorded)**: `customerKey = "<channel>:<externalContactId>"` — the identity the conversation table already enforces unique per org. **Limits**: one human on WhatsApp + Messenger is two memories (no
...[truncated 7021 chars]