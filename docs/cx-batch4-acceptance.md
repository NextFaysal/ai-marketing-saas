# CX Batch 4 Acceptance Document: CX7, CX12c, CX9, CX10

**Date:** 2026-10-13  
**Status:** Accepted & Verified  
**Package:** Category 1 — Customer Experience (CX)

---

## 1. Scope & Implementation Summary

### CX7: To Chase (Incomplete Chat Order AI Chase)
- **Problem Solved:** Customers initiating order flow through chat (WhatsApp/Messenger/Webchat) often abandon before finalizing phone, address, or items.
- **Implementation:**
  - Database schema: Added `chaseEnabled`, `chaseIntervalMinutes`, `maxChaseAttempts`, `chaseMessage` to `InboxSetting`. Added `chaseCount`, `lastChasedAt` to `BotSession`.
  - Automation sweep: Implemented `runChaseSweep(organizationId)` with interval matching, max attempts cutoff, agent handoff check (no chase if assigned to human agent), and session expiration.
  - Cancel intent bail: Added Bangla and English cancellation triggers (`বাতিল`, `cancel`, `দরকার নাই`, `লাগবে না`, `অর্ডার করবো না`) to immediately stop session and chase attempts.
  - Registered background worker job `inbox_chase_sweep` in `AutomationService`.

### CX12c: Voice Note Order & Auto-Transcription
- **Problem Solved:** Customers frequently send voice notes with product details or delivery instructions instead of typing.
- **Implementation:**
  - Automated detection of inbound audio messages in `InboxService.processInboundIntelligence`.
  - Direct Whisper / Gemini speech-to-text pipeline via `AiService.transcribeAudio`.
  - Transcribed text is saved into `message.body` (labeled `[ভয়েস নোট ট্রান্সক্রিপ্ট]`) and passed directly into `handleOrderBot` and autopilot extraction.

### CX9: Knowledge Base File Ingestion
- **Problem Solved:** Merchants need to import FAQs, policies, price sheets, and catalogs without manually copy-pasting into short text blocks.
- **Implementation:**
  - Created `POST /knowledge-documents/upload` endpoint and `KnowledgeService.ingestFile`.
  - Supported formats: `.txt`, `.md`, `.csv`, `.json`, `.html`, and PDF text streams.
  - Text extraction with paragraph-aware chunking (chunks split by logical paragraphs, preserving `sourceFile`, `chunkIndex`, `totalChunks`).

### CX10: Follow-up Timing Settings + Broadcast Polish
- **Problem Solved:** Marketing blasts need safe pre-send preview and deduplication/opt-out filters; CRM leads require structured follow-up cadences.
- **Implementation:**
  - **Broadcast Polish:** Added `POST /broadcasts/preview` endpoint calculating total eligible recipients, exclusions, and returning masked recipient samples (`ay***@example.com`, `017****678`).
  - **Exclusions:** Supported `excludePastDays` (excluding contacts who received messages within N days) and `excludeOptOut` (filtering `unsubscribed` customers/leads).
  - **CRM Stage Timings:** Enforced `DEFAULT_STAGE_FOLLOWUP_DAYS` (new: 1d, contacted: 3d, qualified: 2d, proposal: 5d, won: 30d, lost: 60d) in `LeadsService.create` and `LeadsService.update`.

---

## 2. Test Verification

Run command:
```bash
pnpm --filter @repo/api test -- apps/api/src/inbox/order-bot.spec.ts apps/api/src/messaging/messaging.spec.ts apps/api/src/inbox/cx-batch4.spec.ts
```

Results:
- **Test Suites:** 3 passed, 3 total
- **Tests:** 28 passed, 28 total (12 in `cx-batch4.spec.ts`, 13 in `order-bot.spec.ts`, 3 in `messaging.spec.ts`)
- **Regressions:** 0 detected.
