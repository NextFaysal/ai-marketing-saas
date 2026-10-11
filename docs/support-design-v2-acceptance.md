# Support System Design v2 — Acceptance

Date: 2026-10-11 · Scope: `apps/web` only (no API, no schema, no data changes) · Builds on Tenant Web Design v2 (`a6b9c5e`)

## What changed

A presentation-only redesign of the tenant support page (`apps/web/src/app/dashboard/support/page.tsx`), on top of the additive v2 design system in `globals.css`. Every endpoint, payload, handler, validation and error path is the M38/M41 behaviour unchanged:

- `GET /organizations/:id/tickets` (list, `messageCount` added by the API)
- `GET /organizations/:id/tickets/:ticketId` (detail with `messages[]`)
- `POST /organizations/:id/tickets` (create — same fields, same verbatim server errors)
- `POST /organizations/:id/tickets/:ticketId/messages` (tenant reply)
- `POST /organizations/:id/tickets/:ticketId/status` (tenant close/reopen — `closed`/`open` only, as the API allows)
- `POST /organizations/:id/feedback` (M41 NPS card — same flow, restyled container)

New CSS is additive only, in one marked block in `globals.css`: `.ticket-card`, `.count-chip` (+ value/label), `.msg-avatar` (+ `-support`/`-own`), `.msg-bubble` (+ `-support`/`-own`), `.date-sep`. No existing class was renamed or altered; brand tints keep deriving from `--brand-from`/`--brand-to`, so M59 white-label colour flows into the selected-ticket state, avatars, own-message bubbles and the NPS selection exactly as it does on Overview/Billing.

## Element → data source

| Element | Source |
|---|---|
| Hero strip (title, guidance, quick actions) | Static UI text; the guidance sentence is the pre-existing page copy (admin replies do notify by email — `SupportService.replyAsAdmin`). Quick actions are in-page anchors (`#new-ticket`, `#ticket-list`) |
| Status summary chips (মোট / খোলা / উত্তরের অপেক্ষায় / সমাধান হয়েছে / বন্ধ) | Counts computed in-memory from the fetched ticket list, grouped by the API's exact status vocabulary (`open`/`pending`/`resolved`/`closed`) |
| Ticket card — subject | `ticket.subject` |
| Ticket card — status badge | `ticket.status` mapped to the pre-existing Bengali labels; unknown values fall back to the raw string (same fallback as before) |
| Ticket card — জরুরি badge | Shown only when `ticket.priority === "high"` (the API stores only `normal`/`high`) |
| Ticket card — message count | `ticket.messageCount` from the list payload |
| Ticket card — শেষ কার্যকলাপ | Relative Bengali time computed from `ticket.lastMessageAt` ("এইমাত্র / N মিনিট আগে / N ঘণ্টা আগে / N দিন আগে", absolute bn-BD date after 7 days) |
| Thread meta — ticket reference | `#` + last 6 chars of the real `ticket.id` |
| Thread meta — খোলা হয়েছে | `ticket.createdAt`, full bn-BD locale string (same formatting the old UI used for timestamps) |
| Thread meta — বার্তা count | `selected.messages.length` of the detail payload |
| Status banner | Text keyed by `ticket.status` only; every claim is a behaviour the API itself implements (admin reply moves open→pending; a tenant reply reopens a resolved/closed ticket — `replyAsTenant`; tenants may close/reopen — `setTenantStatus`). No SLA or response-time promise appears anywhere |
| Timeline — date separators | Day boundaries of the real `message.createdAt` values, bn-BD long date |
| Timeline — bubbles | `message.body` verbatim; side/tint from `message.authorKind` (`admin` → support, left, white surface; otherwise own, right, brand gradient). Avatar letters are the initials of the displayed role labels (প্ল্যাটফর্ম টিম / আপনি) — the payload carries no author names |
| Timeline — per-message time | `message.createdAt`, bn-BD time (the old UI showed full date+time per message; the date now lives in the separator) |
| Composer | Shown for every selected ticket, exactly as before (the old UI never disabled reply by status — parity kept). Disabled only when the draft is empty, as before |
| Create form | Same three fields (`subject`, `body`, `priority` select সাধারণ/জরুরি), same disabled rule (subject + body non-empty), same success path (clear → reload list → open the new ticket), server validation errors surfaced verbatim in the same error banner |
| Status actions | "বন্ধ করুন" when status ≠ closed; "আবার খুলুন" when closed or resolved — identical conditions and endpoint as before |
| NPS feedback card | Unchanged logic and texts; container/score buttons restyled (44px targets, brand-gradient selection). Score digits render in Bengali numerals, consistent with the rest of v2 |

Deliberately **not** shown: a last-message snippet (the list payload carries no preview field — inventing one client-side would require fetching every thread), unread indicators (no unread field exists), response-time/SLA copy (the platform makes no such commitment).

## Layout model

The existing structure is a single page with a two-column grid on desktop (list column + thread panel) — kept and polished rather than restructured:

- **Desktop (≥ lg):** two panes side by side, `380px` list column (create form + status summary above it full-width) and the thread panel; placeholder empty state when nothing is selected, as before.
- **Mobile (< lg):** list↔thread takeover, mirroring the inbox pattern — with no ticket open, hero/summary/create/list are shown; once a ticket is opened (or created), the thread takes the screen and the other blocks yield (`hidden lg:block`), with a "← তালিকা" back button in the thread header (`setSelected(null)` — pure client navigation, no server behaviour). While a thread fetch is in flight, skeleton bubbles show in the thread pane.
- **Sticky composer:** the reply bar is `position: sticky` inside the thread card, offset on mobile by `calc(62px + env(safe-area-inset-bottom))` so it floats above the M60 fixed bottom nav (whose own spacer is 64px), and `lg:bottom-4` on desktop. The thread card intentionally has **no** `overflow-hidden` — it would break sticky positioning.
- Opening a thread (or a new reply landing) scrolls the newest message into view — presentation only.

## Responsive strategy

- Breakpoints follow the app: single column → `lg` two-pane (1024px); summary chips 2 → 3 (`sm`) → 5 (`xl`) columns; ticket cards and thread are fluid width with `min-w-0` truncation on subjects, so nothing forces horizontal overflow at 360px.
- Tap targets ≥ 44px on all touched controls: quick actions (`.quick-action` already min-44), create button, priority select, status action buttons, back button, NPS score buttons (now 44×44), composer send button.
- Loading: skeleton chips + ticket rows during the first list fetch; the list's previous "honest empty" behaviour on fetch failure is preserved (a failed load still ends at the honest empty state, never a fake list).
- Empty states: no tickets → dashed guidance card with a create CTA (the pre-existing "কোনো Ticket নেই।" sentence kept verbatim); no selection (desktop) → guidance placeholder with the pre-existing sentence kept verbatim.

## Invariants preserved

- `layout.tsx` untouched — M59 shell branding (logo/name/`--brand-*` overrides), subscription banner, M60 bottom nav and PWA all behave as before (manifest + SW verified 200 in the live check).
- All M38/M41 behaviours verified by construction: handlers copied 1:1; the only logic additions are `loading`/`opening` flags for skeletons and the scroll-into-view effect.
- `git diff` contains zero `apps/api` files.

## Verification

- `tsc --noEmit` clean; web tests 20/20 pass; `next build` green (`/dashboard/support` 5.54 kB).
- Sandbox live check on the new build (`next start`): `/dashboard/support`, `/login`, `/manifest.webmanifest`, `/sw.js` all 200; built page chunk contains the new markers (উত্তরের অপেক্ষায়, শেষ কার্যকলাপ, ticket-card, count-chip-value, msg-bubble-own, date-sep) and the compiled CSS contains the new primitives.

## Honest limits

- No real-browser pixel QA was performed (headless sandbox): responsiveness is established by the breakpoint structure, fluid/truncating layout and code-level audit, not by screenshots.
- The sandbox session used for the live check had no seeded tenant session, so the redesign was verified at build/serve/marker level against the exact payload shapes read from `SupportService`; the data paths are byte-identical to the previous (live-proven) implementation — only rendering changed.
