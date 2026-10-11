# CRM C3 — Leads/Customers CSV Import-Export · Acceptance

Package: Leads & CRM Remaining Package (docs/leads-crm-package-plan.md), Batch 2, item C3.
Before C3 the CRM had **no CSV import or export at all** (orders and products had importers; leads/customers had none). C3 follows the EXISTING M65/M2 import dialect — Papa parser, case-insensitive header aliases with spaces→underscores, `{ row, message }` per-row errors with 1-based data-row numbers, ImportJob bookkeeping, money in major units via `parseMoneyToMinor` — no second dialect was invented. New code: `parseLeadsCsv` + shared CSV-writing helpers (`csvEscape`/`toCsv`/`minorToMajor`) in `apps/api/src/imports/csv.ts`; import/export on `LeadsService`/`CustomersService`.

## Leads import — `POST /organizations/:id/leads/import`

Roles: OWNER / ADMIN / MARKETING_MANAGER (same guard style as lead create). Body: `{ fileName?, csvText }` — the same shape as the products/orders import DTO (2 MB text cap from the DTO).

### Column mapping (verbatim; case-insensitive, spaces or underscores; unknown columns ignored)

| CSV header (aliases) | Lead field | Rule |
|---|---|---|
| `name` (`lead_name`, `full_name`, `customer_name`) | name | **Required** — missing/empty → row error `Missing required column: name` |
| `phone` (`mobile`, `customer_phone`, `phone_number`) | phone | Optional; the dedupe key (below) |
| `email` (`customer_email`, `email_address`) | email | Optional; lowercased by create, as manual |
| `source` | source | Default `manual`; must be one of **manual, whatsapp, messenger, woocommerce, website** (the `LeadsService.LEAD_SOURCES` manual-create vocabulary) else row error naming the value. `facebook_lead_ads` is deliberately NOT importable — that source is reserved for the Meta webhook ingestion, which dedupes on `externalId` |
| `stage` (`status`) | stage | Default `new`; must be one of **new, contacted, qualified, proposal, won, lost** else row error naming the value |
| `tags` (`tag`) | tags | Split on `\|` or `;`, trimmed, empties dropped; normalized by the create path |
| `value` (`lead_value`, `amount`, `estimated_value`) | valueMinor | BDT taka in major units ("2500.50"), parsed with the shared `parseMoneyToMinor`; invalid or negative → row error |
| `next_follow_up_at` (`next_follow_up`, `follow_up_at`, `follow_up_date`) | nextFollowUpAt | Must parse as a date (ISO recommended) else row error |
| `notes` (`note`, `comment`) | notes | Optional free text |

### Semantics (verbatim)

- **Creation path**: every created row goes through `LeadsService.create()` — identical source/stage validation, `LeadActivity` row of type `created`, owner = the importing user, `lead.created` event, email lowercasing, tag normalization. (create() gained an optional service-level `tags` input for this; the public create DTO is unchanged.)
- **Dedupe rule — skip, never overwrite**: the key is the phone with non-digits stripped, last 10 digits (the same discipline as the duplicates board); keys shorter than 6 digits are too weak and never dedupe. A row whose key matches an existing **non-merged** lead **of the same org** is SKIPPED and reported in `details.skipped` as `{ row, leadId, phone }` with the EXISTING lead's id. Leads created earlier in the same file join the key set, so a phone repeated inside one file skips against the just-created lead. Rows without a usable phone are never deduped. Another org's lead with the same phone has no effect.
- **Row cap**: the orders importer has no row cap (only the DTO's 2 MB text cap), so the plan's fallback applies: **1000 data rows**. More → the whole request is rejected with a 400 (Bengali message stating the cap and the file's row count) BEFORE any job or lead is created.
- **Per-row results**: the response is the completed ImportJob (`kind: "leads"`, `totalRows`, `successRows`, `skippedRows`, `failedRows`, `errors` capped at 200, same `{row, message}` shape as the other importers) plus `details: { created: [{row, leadId}], skipped: [{row, leadId, phone}] }`.
- **Audit**: exactly ONE entry per batch — action **`leads_import`**, entityType `ImportJob`, metadata `{ totalRows, created, skipped, failed, fileName }`. (Plus each created lead's own `created` activity, which is the create path's normal record, not an audit entry.)

## Exports

Both are GETs returning `text/csv; charset=utf-8` with `Content-Disposition: attachment`, declared BEFORE the `:id` routes so the literal wins, strictly the caller's org (TenantGuard), merged records excluded. Escaping matches the inbox scorecard CSV (quote on `"`/`,`/newline, quotes doubled). Money is written in taka with exactly two decimals via integer math (`minorToMajor`), so an export can be re-imported as-is.

- **`GET /organizations/:id/leads/export`** — columns: `id, name, phone, email, source, stage, tags` (`|`-joined), `value, currency, next_follow_up_at, notes, created_at`. Newest first, capped at 5000 rows.
- **`GET /organizations/:id/customers/export`** — columns: `id, name, first_name, last_name, phone, email, source, order_count, total_spent, created_at`. Rows and lifetime figures come from the list's own computation, refactored into a shared `rowsWithStats` (list = first 100, export = the full fetched window of 500): `order_count`/`total_spent` count orders **excluding status `cancelled`** — exactly what the Customers page shows. No column exists that the service doesn't already compute.

## Web

- Leads page: "📥 CSV ইমপোর্ট" toggles a panel (file picker; the column/dedupe/cap rules stated in the panel) posting `{ fileName, csvText }` like the orders importer UI, then showing the returned summary (মোট/তৈরি/বাদ/ব্যর্থ counts, skipped rows with the existing lead id prefix, failed rows with reasons, first 20 of each). "📤 এক্সপোর্ট" downloads via the blob+auth-header pattern used by the orders PDF downloads (apiFetch is JSON-only).
- Customers page: "📤 CSV এক্সপোর্ট" button, same download pattern.
- A paste-text fallback was NOT added: the orders import UI (the precedent named in the plan) is file-only too — the panel matches it exactly.

## Tests

- `apps/api/src/imports/leads-csv.spec.ts` (new): full-row mapping incl. aliases and `|`/`;` tags; defaults; missing-name row error; invalid source/stage errors naming the value; `facebook_lead_ads` rejected; invalid/negative money and invalid date rejected; friendly header aliases; `minorToMajor` exactness; `toCsv` quoting.
- `apps/api/src/crm/c3-leads-import-export.spec.ts` (new): create-path semantics (activity, owner, money, tags); phone-dedupe skip with the existing id + no overwrite; same-file repeat skips; merged lead is not a dedupe target; no-phone rows never dedupe; parse failures counted; cross-org dedupe isolation; the 1000-row cap 400s before creating anything; export shape/org isolation/merged exclusion.
- `apps/api/src/customers/c3-customers-export.spec.ts` (new): export reuses the list computation (cancelled orders excluded from lifetime), merged shells and other orgs excluded.

## Honest limits

- Import is synchronous (like products/orders): fine at the 1000-row cap; larger files remain future S3+worker work, as noted on the imports module since M2.
- Export caps (5000 leads / 500 customers) mirror the fetch windows the codebase already uses; they are stated here rather than silently truncating — a customer export for an org with >500 customers covers the newest 500, the same window the list fetches.
- C4 note for later: imported leads carry no custom fields; how that interacts with C4's required-on-create rule is decided and documented in docs/crm-c4-acceptance.md.
