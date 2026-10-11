# Admin Advanced AA6 — Console Completion Pack: Acceptance

AA6 is the final item of Admin Advanced Batch 2 (plan: `docs/admin-advanced-plan.md`; AA4 = 29ac759, AA5 = 803fbd8). It closes six small half-wired gaps found by the 2026-10-11 admin audit. All work is LOCAL ONLY — no commit / push in this acceptance step itself (per owner gate).

## 1. Announcement scheduling (D1) — SHIPPED

- Service: `AdminService.createAnnouncement` now validates the window before persisting, in the house style of the `maintenanceWindow` validation in `updateSettings`:
  - `startsAt` present and `Number.isNaN(Date.parse(startsAt))` → 400 `startsAt must be a valid ISO date`
  - `endsAt` present and unparseable → 400 `endsAt must be a valid ISO date`
  - both present and `endsAt <= startsAt` → 400 `endsAt must be after startsAt`
  - A valid window persists as `Date` objects (unchanged storage shape).
- UI (`apps/admin/src/app/settings/page.tsx`): the announcement form gains two optional `datetime-local` inputs — শুরুর সময় / শেষের সময়. They are sent as ISO strings only when set (`startsAt` / `endsAt` omitted otherwise), and cleared after a successful publish. Publish errors now surface via the page message instead of failing silently. Each announcement row in the list shows its window (`startsAt → endsAt`, `bn-BD` format) when either bound is set.

## 2. Org notes UI (D3) — SHIPPED

- Backend already existed (`GET/POST /admin/notes`, `targetType: "organization"` validated in `addNote`); only the UI was missing.
- UI (`apps/admin/src/app/orgs/[id]/page.tsx`): a notes card mirroring the user detail page exactly in behaviour — state (`notes`, `note`), load via `/admin/notes?targetType=organization&targetId=<id>` inside the page's existing `load()`, POST `{ targetType: "organization", targetId, body }` from the input + যোগ button, and a timestamped (`bn-BD`) list. Placed in the actions card flow, below the Danger Zone, separated by a border — the same placement pattern the user page uses inside its actions card.

## 3. Audit depth (C8/D4) — SHIPPED

- Service: `auditTrail()` filters gain `organizationId`, `entityType`, `dateFrom`, `dateTo`. Where-building is shared with the new export via a private `auditWhere()` helper:
  - `organizationId` / `entityType`: exact matches.
  - `dateFrom` / `dateTo`: `createdAt { gte, lte }` with `new Date(...)`; only provided bounds are included; unparseable dates are ignored (not a 400) so a typo in a filter never breaks the audit view.
  - Existing defaults unchanged: `action` is a `startsWith` prefix, `take` defaults to 50, capped at 200.
- Service: new `exportAuditCsv(filters)` — same where-building, `take` 1000, columns `createdAt,action,entityType,entityId,organizationId,userId,ipAddress,metadata`, `metadata` as `JSON.stringify(...)` or `""`, quote-escaping copied from `exportPaymentsCsv()` (`esc()` doubles double-quotes).
- Controller: `GET /admin/audit` gains the four query params; new `GET /admin/audit/export.csv` with the billing export's `@Header` pair (`Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename=audit-export.csv`) accepting the same filter params.
- UI (`apps/admin/src/app/audit/page.tsx`): Organization ID text input, Entity Type text input, From/To date inputs, Take select (50/100/200), keeping the action-prefix select. All filters feed the fetch query via a shared `buildQuery()`. A ⬇ CSV Export button uses the authed-download pattern (fetch `${API_URL}/admin/audit/export.csv?<same filters>` with the admin token → blob → anchor download as `audit-export.csv`).

## 4. Dunning coverage (C9) — SHIPPED

- Service: `dunningBoard()` additionally fetches `scheduledJob.findMany({ where: { type: "dunning_reminders" } })` (defensive `.catch(() => [])`), builds the set of organizationIds having an enabled job, and adds `reminderJobConfigured: boolean` to each row.
- Semantics (explicit): **configured = an ENABLED `dunning_reminders` job exists for the org.** An existing-but-disabled job sends nothing, so it counts as NOT configured. A different job type likewise does not count.
- UI (`apps/admin/src/app/billing/page.tsx`): `DunningRow` gains `reminderJobConfigured?: boolean`; when it is `false`, the dunning list item renders a red warning: `⚠ reminder job নেই — পাঠানো হচ্ছে না`. The pre-existing explanatory note (reminders need a per-org `dunning_reminders` job in Automations) stays.

## 5. Storage per tenant (C6) — SHIPPED

- Service: `usageBoard()` gains per-org storage:
  - Preferred path: one `mediaAsset.groupBy({ by: ["organizationId"], _sum: { sizeBytes: true }, _count: { _all: true } })` in a try/catch, mapped into a per-org map.
  - Fallback (defensive house style): if `groupBy` is unavailable or errors (older spec fakes lack it), per-org `mediaAsset.findMany({ where: { organizationId }, select: { sizeBytes: true } })` summed in JS. The fallback keeps older suites green.
  - Each row gains `storageBytes: number` and `mediaAssets: number`.
- UI (`apps/admin/src/app/usage/page.tsx`): `Row` gains both fields; a `Storage` column after `Order` formats bytes human-readably (B / KB / MB / GB, 1 decimal where sensible) with the asset count as small muted text beneath.
- Storage blind spot (honest): **channel/inbox media has NO byte-size data anywhere in the system, so it is not reported and nothing is estimated or invented. Only `MediaAsset` storage (social/media library) is counted.** If channel media ever stores byte sizes, it can be added as a separate, labelled figure.

## 6. Webhook explorer (C7) — SHIPPED

- Service: new `systemWebhooks({ provider?, organizationId?, hasError?, take? })`:
  - When `organizationId` is given, its integration ids are resolved first; an org with no integrations returns `[]` without querying events.
  - Where: `provider` exact, `error: { not: null }` only when `hasError`, `integrationId: { in: ids }` only for the org filter. Ordered `receivedAt desc`, `take` capped at 100 (default 50).
  - Rows are summaries only — `{ id, provider, topic, integrationId, organizationId, organizationName, deliveryId, signatureValid, processedAt, error, receivedAt }` — resolved via one integration lookup + one organization lookup over the involved ids. **The stored `payload` is never included in the list.**
- Service: new `systemWebhookEvent(id)`:
  - `findUnique` → 404 (`Webhook event not found`) if missing; org resolved via its integration.
  - Payload handling with a hard cap: `s = JSON.stringify(payload ?? null)`; if `s.length > 20000`, returns `{ ...summary, payload: s.slice(0, 20000), payloadTruncated: true }`; otherwise `{ ...summary, payload: payload ?? null, payloadTruncated: false }` (parsed value, not a string).
- Controller: `GET /admin/system/webhooks` (query `provider`, `organizationId`, `hasError` — `"true"`/`"1"` parsed as true, `take`) and `GET /admin/system/webhooks/:id`, with no `@AdminTier` restriction — the read-only system GET pattern of the neighbouring boards.
- UI (`apps/admin/src/app/system/page.tsx`): a new `🪝 Webhook Events` acard section after the Dead-Letter Queue card, self-contained with its own state + `loadWebhooks()` loader, which is also called from the page's `load()` flow. Provider text input + errors-only checkbox + reload button; a list (max 20 rendered) showing provider · topic · org name (link to `/orgs/:id`) · `receivedAt` (`bn-BD`) · error in red when present. Clicking an event fetches `/admin/system/webhooks/:id` and shows the payload in a `<pre>`, with a `কেটে দেওয়া হয়েছে (truncated)` note when `payloadTruncated`.

## Tests

New spec: `apps/api/src/admin/aa6-completion.spec.ts` (fake-prisma style of the existing admin specs; where-shapes + returned-row mapping asserted where fakes capture rather than evaluate):

- Announcement: `endsAt <= startsAt` → 400 (both `<` and `=`); invalid `startsAt` → 400; invalid `endsAt` → 400; valid window persists `Date`s; no window persists nulls.
- Audit: filters land in the where (`organizationId`, `entityType`, `createdAt` gte/lte as Dates); defaults unchanged with no filters; only the provided date bound is included and an unparseable bound is ignored.
- CSV export: header line, a row line, quote-escaping of metadata containing a double-quote, export take = 1000.
- Dunning: enabled job → `reminderJobConfigured: true`; only a disabled job → `false`; no (matching-type) job → `false`.
- Storage: a fake WITHOUT `groupBy` exercises the fallback (sum + count correct); a `groupBy` fake proves the preferred path (and that the fallback `findMany` is not called).
- Webhooks: provider + `hasError` filters land in results/where; org filter scopes via integrations and an org with no integrations returns `[]`; list items have NO `payload` key; detail returns a small payload parsed with `payloadTruncated: false`; a >20000-char payload returns a 20000-char string with `payloadTruncated: true`; unknown id → 404; webhook + audit-export routes carry no `@AdminTier` restriction.

## Evidence ceiling

Specs + full API suite + admin build only. The sandbox has no Postgres and no live HTTP against a running deployment, so: no live audit CSV download, no live webhook payload, no live dunning/storage figures from real tenant data were exercised. All figures above are computed from real stored rows by construction (no invented data), and live proof follows the M30 pattern — the owner's moment in the Admin Panel on the live deployment.
