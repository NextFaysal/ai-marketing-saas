# Advanced AI Support System — Technical Acceptance

**Date:** 2026-10-16  
**Scope:** Full-stack (`packages/db`, `apps/api`, `apps/web`, `apps/admin`)  
**Status:** Verified & Production Built Green

---

## 1. Executive Summary

The support ticketing system in `next-ai-marketing` has been upgraded from a basic text message exchange into a comprehensive, enterprise-grade, **AI-First Modern Support Platform**.

Key capabilities introduced:
- **Instant AI Deflection & Smart Solutions:** Automatically detects customer issues as they type the subject/body and suggests immediate self-service troubleshooting steps before a ticket is opened.
- **Media & Screenshot Attachments:** Drag-and-drop and native clipboard image paste (`Ctrl + V`) support for both tickets and replies.
- **Dual-Mode Admin Superdesk:** Allows support agents to post public replies (with email & in-app notifications) or create internal whisper notes (`isInternal: true`) private to the platform team.
- **1-Click AI Draft & Thread Summarizer:** Support agents can generate context-aware, polite Bengali/English resolution replies or 2-sentence thread summaries using LLM completion.
- **Canned Responses (Saved Replies / Macros):** Pre-configured shortcuts (`/meta-reauth`, `/billing-bkash`, `/pixel-test`, `/campaign-review`, `/resolved-closing`) and CRUD management for instant replies.
- **Customer 360° & Diagnostics:** Automatic capture of client environment (URL, UserAgent, screen resolution), organization active integrations, and team size.
- **SLA & CSAT Metrics:** Priority-based SLA deadlines (`urgent` = 4h, `high` = 12h, `normal` = 24h) and post-resolution 5-star customer feedback ratings.
- **In-App Notification Integration:** Automatically alerts tenant users via the topbar `NotificationBell` when an agent responds.

---

## 2. Database Schema Changes (`packages/db/prisma/schema.prisma`)

### Model: `SupportTicket`
- `category`: `String @default("general")` (`general`, `billing`, `technical`, `campaigns`, `integration`)
- `priority`: `String @default("normal")` (`normal`, `high`, `urgent`)
- `diagnostics`: `Json?` (environment, url, user agent, viewport)
- `tags`: `String[] @default([])`
- `slaDueAt`: `DateTime?`
- `firstRepliedAt`: `DateTime?`
- `resolvedAt`: `DateTime?`
- `csatRating`: `Int?` (1 to 5)
- `csatFeedback`: `String?`
- `messages`: Relation to `SupportTicketMessage[]`

### Model: `SupportTicketMessage`
- `isInternal`: `Boolean @default(false)` (private internal notes)
- `attachments`: `Json?` (array of `{ name, url, size, mimeType }`)
- `ticket`: Relation to `SupportTicket` with cascade delete

### Model: `SupportCannedResponse`
- `id`: `String @id @default(cuid())`
- `shortcut`: `String @unique` (e.g. `/meta-reauth`)
- `title`: `String`
- `body`: `String`
- `category`: `String?`
- `createdAt`, `updatedAt`

---

## 3. API Endpoints (`apps/api/src/support`)

### Tenant Endpoints (`/organizations/:organizationId/tickets`)
- `POST /` — Create ticket with category, priority, attachments, and diagnostics.
- `GET /` — List tickets with message count, category, and status.
- `GET /:ticketId` — Get ticket details (filters out `isInternal: true` messages).
- `POST /:ticketId/messages` — Send reply with attachments (reopens closed/resolved tickets).
- `POST /:ticketId/status` — Close or reopen ticket.
- `POST /:ticketId/csat` — Submit 1-5 star CSAT rating and qualitative feedback.
- `POST /suggest-solutions` — AI deflection and smart troubleshooting suggestions.
- `POST /upload` — Base64 file/screenshot upload with size validation.
- `GET /attachments/:fileId` — Stream stored attachment files.

### Admin Endpoints (`/admin/tickets`)
- `GET /` — Filter by status, category, priority, or organization.
- `GET /analytics/metrics` — Aggregate support metrics (FRT, MTTR, CSAT average and breakdown, SLA compliance rate, category distribution, recent feedback).
- `GET /:id` — Get ticket details with Customer 360 overview, diagnostics, and internal whisper notes.
- `GET /:id/stream` — Realtime Server-Sent Events (SSE) stream for admin (pushes public messages, internal notes, and typing state).
- `POST /:id/typing` — Broadcast admin typing state to tenant.
- `POST /:id/messages` — Send public reply to tenant (dispatches email and in-app notification).
- `POST /:id/notes` — Save internal whisper note (does not email tenant or alter public status).
- `POST /:id/status` — Update status, priority, category, SLA, or assign admin.
- `POST /:id/ai-draft` — Generate AI draft reply using LLM factory.
- `GET /:id/summary` — Generate AI summary of thread.
- `GET /canned/all` — List all canned responses.
- `POST /canned` — Create canned response.
- `PATCH /canned/:cannedId` — Update canned response.
- `DELETE /canned/:cannedId` — Delete canned response.

### Tenant SSE Endpoints
- `GET /organizations/:organizationId/tickets/:ticketId/stream` — Realtime SSE stream for tenant (instant message push, internal notes strictly filtered out).
- `POST /organizations/:organizationId/tickets/:ticketId/typing` — Broadcast tenant typing state to admin desk.

---

## 4. UI/UX Verification

- **Tenant Web Portal (`apps/web`):**
  - `/dashboard/support` (Production build size: 8.87 kB)
  - Instant live updates via SSE stream (`subscribeTicketStream`) with 30s polling fallback.
  - Live typing indicator: Shows pulsing "সাপোর্ট টিম উত্তর লিখছেন..." when agent types.
  - Quick action to Support Hub in user dropdown menu & GlobalAssistant starter chip.
  - Image paste (`Ctrl+V`) and attachment chips with deletion controls.
  - Interactive CSAT rating card displayed upon ticket resolution.
- **Admin Superdesk (`apps/admin`):**
  - `/tickets` (Production build size: 8.71 kB)
  - Realtime SSE stream (`subscribeAdminTicketStream`) for instant message delivery.
  - Live typing indicator: Shows pulsing "গ্রাহক মেসেজ টাইপ করছেন..." when customer types.
  - Canned Response Creator Modal: 1-click modal to create and save custom canned macros.
  - Dual-mode composer (`📢 Public Reply` vs `🔒 Internal Note`).
  - `✨ AI Draft Reply` button for 1-click LLM assistance.
  - Customer 360° overview card displaying active channels and member count.

---

## 5. Automated Tests

- **Spec File:** `apps/api/src/support/support-advanced.spec.ts`
- **Result:** `9 passed, 9 total` (100% green)
  - Ticket Creation & SLA assignment
  - AI Deflection Suggestions (Pixel & Billing)
  - Internal Whisper Notes vs Tenant Privacy Isolation
  - CSAT Ratings & Feedback
  - Default Canned Responses seeding & custom creation
  - Support Analytics Calculation
  - Realtime SSE Streams & Typing Indicators (Tenant vs Admin privacy enforcement)
