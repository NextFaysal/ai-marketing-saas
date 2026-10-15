# Orders Next — Batch OB5 Acceptance (ON8 Automation Studio + ON9 Analytics & Digest + ON10 Print Center + ON12 Team Performance)

Date: 2026-10-14 · Branch `orders-next` (base: OB4 final `66dacf8`) · **Local commits only — NOT pushed, NOT deployed.**
Per-item acceptances: `docs/orders-ob5-on8-acceptance.md`, `orders-ob5-on9-acceptance.md`, `orders-ob5-on10-acceptance.md`, `orders-ob5-on12-acceptance.md`.
Program summary + the item-by-item audit table: `docs/orders-program-summary.md`.

## Migrations (Orders Next range 20261013700000+)

| Migration | Contents |
|---|---|
| `20261013790000_on8_order_automation` | `OrderAutomationRule` + `OrderAutomationLog` (unique [ruleId, orderId, triggerKey]) |
| `20261013800000_on10_print_center` | `PrintJob` + `PrintTemplateSetting` (unique org) |

ON9 and ON12 needed **no schema change** (digest sends are AuditLog rows; team metrics read existing
rows). Total sequence: **164 migrations**. Deploy: both migrations must run on the real DB; the two
new per-org jobs (`order_automation_sweep`, `owner_order_digest`) need per-org enablement like every
other sweep. **Neither migration has been run on any real database.**

## What was delivered (summary — details in the per-item docs)

- **ON8** — dedicated order-automation engine (verdict: the general WorkflowsService cannot express
  order-scoped actions or time triggers; documented in the ON8 acceptance): 4 triggers, 6 conditions,
  5 actions, reserve-first exactly-once via the log's unique key, event + sweep evaluation, 5 presets
  installed disabled, per-rule + per-order (timeline) logs. Hard boundary spec-pinned: rules never
  alter totals, payment state or status.
- **ON9** — `GET orders/analytics` (EC33 sold bucket, Dhaka ranges, repeat rate, courier scorecard
  with pair-counted averages and nulls instead of fake zeros, district demand, return warnings at
  named constants) + the daily owner digest job (email to OWNER memberships, AuditLog-recorded
  per-recipient results, send-now endpoint + status).
- **ON10** — Print Center: PrintJob records for invoices/labels/packing-slips/challans over 1–100
  orders (foreign ids 400 up front; per-order failures named in `failedOrderIds`; failed generation =
  failed row + 422), a new challan builder (EC19 COD due), a server packing-slip builder mirroring the
  web print page field-for-field, per-org template settings applied on the job path only (legacy PDF
  endpoints byte-identical — buffer-compared in spec), and the ON1 bulk print actions rerouted through
  jobs with their per-order results shape preserved.
- **ON12** — `GET orders/team-performance`: every ACTIVE member (zero-activity included) with
  assignedOpen (current snapshot, labelled), status changes, holds placed/released, COD calls, wave
  picks and comments — each counted from its exact AuditLog action or actor-stamped row; totals row;
  web panel whose rows deep-link into the assignee-filtered command center.

## Gates — coordinator's own final run (exit-code verified, read from the logs directly)

| Gate | Result | Baseline |
|---|---|---|
| API jest (5 chunks, `--runInBand`) | **340 suites / 3489 tests PASS**, every chunk exit 0, zero FAIL lines (607+640+698+834+710) | 335 / 3432 (+5 suites / +57 tests = ON8 23, ON9 14, ON10 14, ON12 6 — exact) |
| API `tsc --noEmit` | exit 0 | — |
| Web vitest | **341/341 PASS**, exit 0 | 316 (+25 = ON8 7, ON9 7, ON10 6, ON12 5 — exact) |
| Web `tsc --noEmit` | exit 0 | — |
| Full build `pnpm -r build` | exit 0 (7/7 packages incl. next build web + admin) | — |
| `prisma validate` | exit 0 | — |
| Fresh-DB migration sequence | **164/164 applied clean** (throwaway Postgres 16), 0 unfinished/rolled back, 223 tables; OrderAutomationRule/Log + PrintJob + PrintTemplateSetting verified present | 162 |

No flakes appeared in the closing run (the known cx3-debounce flake did not trigger).

## Honest limits (batch-level; per-item docs carry the rest)

- **Process:** four delegated builders died in sandbox daemon restarts during this batch (ON8 ×1,
  ON10 ×2, ON10 finisher ×1). All partial work was recovered from disk, audited file-by-file by the
  coordinator, and finished either by a finisher agent (ON8) or by the coordinator personally (ON10,
  incl. its 14-test spec). No number in any OB5 document comes from a dead builder's report.
- **ON9 delivered-timestamp basis:** CourierShipment has no `deliveredAt` and no persisted status
  history, so avgTransitDays pairs booking → `updatedAt` while delivered-classified (labelled in
  code, UI and doc; a persisted delivered-at needs a schema change that was not improvised).
- **Digest SMS leg can never fire today:** neither User nor Organization has a phone field — the leg
  is wired via sendShopSms and always records an honest `no_phone_on_record` skip.
- **ON10 logoUrl is stored + validated but does NOT render** (the dependency-free PDF toolkit cannot
  embed raster images) — stated in the schema comment, the service and the UI.
- **ON8 status-transition dedupe** relies on the `orders.status_changed` audit row's timestamp as
  the transition bucket (the emitter carries no `occurredAt`); two distinct transitions to the same
  status inside one audit timestamp would collapse into one firing.
- **Nothing is live-proven:** no real SMTP/SMS/WhatsApp/courier/printer was exercised; no screenshot
  QA of the four new panels; the migrations have not run on the real DB; deploy still needs the
  owner's Dokploy redeploy + per-org job enablement.
