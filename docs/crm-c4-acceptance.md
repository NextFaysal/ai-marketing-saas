# CRM C4 — Custom Fields · Acceptance

Package: Leads & CRM Remaining Package (docs/leads-crm-package-plan.md), Batch 2, item C4.
Before C4 there were **no custom fields anywhere**: the Lead and Customer schemas were fixed, and customers had no update endpoint at all. C4 adds per-org field definitions, one JSON value column per entity, a single server-side validation gate, and typed editing in both detail views.

## Schema — ONE additive migration

`20261010800000_c4_custom_fields` (applied in the sandbox; Prisma client regenerated):

- New table `CustomFieldDef`: `id, organizationId, entity ("lead" | "customer"), key, label, type ("text" | "number" | "date" | "select"), options Json? (string[] for select, else null), required Boolean default false, sortOrder Int default 0, archivedAt DateTime?, createdAt, updatedAt`. `@@unique([organizationId, entity, key])`, FK to Organization with cascade delete.
- `Lead.customFields Json?` and `Customer.customFields Json?` — values live ONLY here, keyed by def.key. No per-field columns exist or will be added.

## Definition API — `organizations/:id/crm/custom-fields`

| Route | Roles | Behaviour |
|---|---|---|
| `GET ?entity=lead\|customer` | any member (PermissionArea "customers") | All defs of the org (archived included, flagged), ordered by sortOrder then creation |
| `POST` | OWNER / ADMIN | Create. Key: supplied or slugged from the label (lowercase, non-alphanumerics → `_`); must match `^[a-z][a-z0-9_]{0,59}$` else 400 |
| `PATCH :defId` | OWNER / ADMIN | Label, type, options, required, sortOrder, archived. **A different `key` in the body is a 400** — keys are immutable because stored values reference them |
| `POST :defId/archive` | OWNER / ADMIN | Sets archivedAt (same as PATCH `{archived: true}`; PATCH `{archived: false}` un-archives) |

Rules: duplicate key within org+entity is a 400 **even if the existing def is archived** (the key stays reserved so stored values keep their meaning; the same key on the OTHER entity is fine). Select defs require ≥1 cleaned option (trimmed, deduped, ≤100 chars each); non-select defs store `options: null`. Changing a def's `type` re-validates future writes against the new type — stored values are NOT converted (they render as-is in detail/exports).

## Validation matrix (verbatim — `CustomFieldsService.validateAndSanitize`, the only gate)

Applied on: lead create, lead update, the new customer PATCH. Values are a PARTIAL object keyed by def.key:

| Case | Result |
|---|---|
| Key not among the org's **non-archived** defs for that entity (incl. keys of archived defs, other org's keys) | 400 `Unknown custom field: "<key>" for <entity>` |
| Value `null` or empty/whitespace string | A **clear marker**: the key is removed from the stored object |
| text, non-string value | 400 `Custom field "<label>" must be text` |
| text, longer than 500 chars after trim | 400 `Custom field "<label>" is too long (max 500 characters)` |
| text, valid | Stored trimmed |
| number, a finite number or a numeric string ("1250.50") | Stored as a **number** |
| number, anything else (incl. booleans, "abc", NaN) | 400 `Custom field "<label>" must be a number` |
| date, a string matching `YYYY-MM-DD` AND a real calendar date (round-trip checked; `2026-02-30` fails) | Stored as the string |
| date, anything else (incl. datetimes, `20-10-2026`) | 400 `Custom field "<label>" must be a date in YYYY-MM-DD format` |
| select, a string in the def's options | Stored as-is |
| select, anything else | 400 `Custom field "<label>" must be one of: <options>` |
| `customFields` itself not a plain object | 400 |

**Required**: enforced ONLY on lead create — every non-archived `required` lead def must resolve to a non-empty value or the create 400s with `Custom field "<label>" is required`. Two documented exceptions/boundaries:

- **CSV import (C3)** creates leads WITHOUT the required check (opts flag on the shared create path): bulk legacy rows carry no custom values, so one required def must not fail a whole import. Imported leads simply have no value for the field until someone edits them. Type validation is moot there (no values are supplied).
- **Customer PATCH** never enforces required: customers are born from store/chat sync, not forms, and the PATCH is partial by design. Lead UPDATE likewise never enforces it (partial writes; rows predating a def are unaffected).

If values are supplied to a deployment where the service is not wired, the write 400s rather than silently dropping them ("Custom fields are not available in this deployment").

## Surfaces

- **Lead create/update**: `CreateLeadDto`/`UpdateLeadDto` accept `customFields` (object). Update semantics: partial merge onto stored values (present keys overwrite, null clears, absent keys untouched); `customFields: null` on update clears ALL values. Lead detail/list responses carry `customFields` (the row spread), so the score/list surfaces are unchanged in shape plus one field.
- **Customer PATCH — new endpoint** `PATCH /organizations/:id/customers/:id`, roles OWNER / ADMIN / SUPPORT_AGENT: `{ firstName, lastName, email, phone }` (trimmed; empty → null; email lowercased) + `customFields` with the same merge/clear rules. Audited as `customer.updated` with the changed field names in metadata. Returns the full Customer 360 detail.
- **Merges**: lead merge and customer merge gap-fill custom fields with the platform's merge discipline — the survivor keeps its own values; keys it lacks (or holds as null) fill from the source. Implemented via one shared `fillGaps` helper and tested on both.
- **Exports (C3)**: both CSV exports append the org's non-archived defs of that entity as extra columns AFTER the core columns, headered by **label**, in def order; values rendered raw (numbers as-is, dates as stored). Archived defs' values no longer export (the values remain stored).
- **Web**: shared `components/custom-fields.tsx` — a defs manager (entity tabs Lead/Customer: list with key/type/options, create form, required toggle, archive/unarchive) on the Leads page; typed value editors (select → dropdown, date → date input, number → number input, text → text input, required marked *) in the lead create form, the lead detail panel, and a new customer detail "তথ্য সম্পাদনা" card (contact basics + custom fields, saving through the new PATCH). Def management for customers is intentionally in the same manager (entity tab) rather than duplicated on the Customers page — the customer card links to it.

**Deliberate non-surface**: list/board columns for custom fields were NOT added. The leads surface is a Kanban board and the customers surface a card list — neither is a table, and squeezing two extra values per card would clutter both. Values show on the detail views and in exports. (The C4 task text allowed detail-only with an honest note; this is that note.)

## Tests

- `apps/api/src/crm/custom-fields.spec.ts`: slug derivation; def create (key from Bengali-mixed label, select option cleaning, options forced null for non-select); duplicate-key rejection incl. archived; invalid entity/type/key; key immutability; archive/unarchive; org isolation on list/update; the full value-validation matrix (text/number/date/select); sanitize clear markers; unknown + archived key rejection; required-on-create semantics (incl. satisfied-by-existing, not enforced on update); mergeValues/fillGaps primitives.
- `apps/api/src/crm/c4-leads-custom-fields.spec.ts`: create stores sanitized values; required + type + unknown-key rejections through LeadsService; partial merge + single-key clear + clear-all on update; CSV import succeeds despite a required def; lead merge gap-fill; leads export gains label columns.
- `apps/api/src/customers/c4-customers.spec.ts`: customer PATCH (basics normalization, custom merge, audit entry with field names, bad date/unknown key 400s, cross-org 404, clear-all); customer merge gap-fill alongside scalar gap-fill; customers export gains label columns.

## Honest limits

- A def whose options are edited afterwards can strand stored values outside the new option set; those values still display/export (validation gates writes, not reads) until the record is next edited, at which point saving that field requires a valid option.
- `sortOrder` is stored and used for def ordering, but the manager UI does not yet offer drag-reorder (PATCH accepts it; ordering falls back to creation order by default).
- Live check: migration applied to the sandbox DB and endpoints exercised over real HTTP — see the milestone report for the transcript summary; unit/service suites above are the regression gate.
