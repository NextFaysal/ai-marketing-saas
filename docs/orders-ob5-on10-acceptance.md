# Orders Next — OB5 / ON10 Acceptance (Print & Document Center)

Worktree `~/workspace/ai-marketing-saas-on`, branch `orders-next`. Local commits only — NO push.
Process note: two delegated builders died in daemon restarts; the second left the complete API
implementation uncommitted on disk. The coordinator audited it file-by-file, fixed one strict-null
TS error (lazy CourierService resolution), and finished the batch in-session (specs, web, this doc).

## Delivered

- **Schema** (migration `20261013800000_on10_print_center`): `PrintJob` (type, orderIds Json,
  orderCount, failedOrderIds Json?, status done|failed, error, createdById; index org+createdAt) and
  `PrintTemplateSetting` (one row per org, @unique organizationId; logoUrl/footerText/termsText/
  invoiceNote). The PDF itself is streamed and never stored — the row is the job's honest record.
- **Print jobs API** (`PrintCenterController`, registered FIRST in OrdersModule so the literal
  `print-jobs`/`print-template` segments beat `:orderId` — the ON9 pattern; `PrintCenterService`
  resolves the app's single CourierService lazily via ModuleRef because Orders → Courier would close
  a module cycle, Courier → Inbox → Orders):
  - `POST orders/print-jobs` {type, orderIds 1–100 deduped}. Foreign/nonexistent ids fail the WHOLE
    request with 400 listing them, before any row exists. Per-order problems (a label for an order
    with no shipment, or a shipment with no tracking code yet) land in `failedOrderIds` with a
    per-order Bengali reason; the PDF carries the rest. A generation throw writes a `failed` row and
    the controller answers 422 with the Bengali error — never a phantom PDF. If EVERY label order is
    unprintable the job is `failed` (nothing to stream). Success streams the PDF via the courier
    controller's own sendPdf mechanism + `X-Print-Job-Id` / `X-Print-Job-Failed-Order-Ids` headers.
  - `GET orders/print-jobs` (paged history) + `GET orders/print-jobs/:jobId` (org-scoped, foreign → 404).
- **Builders** (CourierService + courier/pdf.ts — the one home of PDF generation):
  - `invoicesPdf` gained an optional `{ template, maxOrders }` param; `labelsPdf` an optional
    `{ maxLabels }`. The legacy direct endpoints pass no options and keep pre-ON10 behaviour, error
    text and output bytes (spec-pinned: empty template ≡ no template, `Buffer.compare === 0` — the
    dependency-free toolkit is deterministic, no embedded dates).
  - `challansPdf` (new): delivery challan per order — number, customer + phone, address, item lines
    (name × qty, NO prices), COD due = total − Σ APPROVED PaymentVerification amounts (EC19 grouped
    math, capped at total; pending verifications never count), terms/footer applied.
  - `packingSlipsPdf` (new): the server-side packing slip (see verdict below).
- **Template settings**: `GET/PUT orders/print-template` — logoUrl must be http(s) when set (400
  otherwise), field caps 500/200/1000/500, full-replace semantics, audited with field-presence
  metadata only (never the merchant's text). Applied to invoices/challans/slips on the print-job
  path only.
- **Bulk reroute**: ON1 bulk `print_labels`/`print_invoices` create ONE print job through
  PrintCenterService (appended @Optional constructor dep, house discipline; without wiring the
  legacy id-collection path is kept). The per-order results shape is preserved: done job → orders
  ok carrying `printJobId`; the job's failedOrderIds → those orders failed with the job's per-order
  reason; a failed job fails every candidate with the job error. `out.print` now names the job.
- **Web**: "🖨️ প্রিন্ট সেন্টার" panel (`on10-print.tsx`, header + bulk-bar entry; opens with the
  current selection): type picker with per-type hints, selection chips + pasted-id entry (duplicates
  counted and shown, 100 cap enforced client-side too), one-click job → PDF download + per-job
  outcome notice (counts + failed ids), template form (with the honest logo note below), job history
  table (time, type, counts, failed count, status, failure detail). `lib/orders-on10.ts` + 6 vitest.

## Packing-slip verdict: SERVER BUILDER (built, not page-only)

Evidence: the web print page (`apps/web/.../commerce/print/page.tsx`, kind=slip) renders from the
order record fetched via `GET orders/:orderId` — items, address, gift fields — i.e. the same stored
fields the API already serves. No web-only business logic exists to fork, so `packingSlipPage` in
pdf.ts mirrors the page field-for-field (org, order no/date, customer + phone, address, item lines
with SKU + gift marker + bundle name, the EC29 gift message in a boxed block, footer) and
`CourierService.packingSlipsPdf` composes one page per order from Order/OrderItem/Customer rows.
Spec asserts the slip carries the gift message, the `GIFT -` marker and the SKU. The web page
remains available for single-order printing; nothing was removed.

## Gates (coordinator-run for this batch's scope)

- API `on10-print.spec.ts`: **14/14 PASS** (exit 0) — invoices job + done row; labels partial
  failure; all-unprintable failed job; foreign id 400 before any row; generation-throw failed row;
  slip builder contents; org-scoped history/404; template validation + audit; templateForPrint
  null-at-empty; **byte-identity** (empty template ≡ none) + footer/note change output; challan COD
  math (approved only, partial advance → ৳1,000.00 due; fully paid → "No COD due"); bulk reroute ×2.
- Regression: `on1-bulk.spec.ts` + `m53-bulk-pdf.spec.ts` **18/18 PASS** (exit 0).
- API `tsc --noEmit` exit 0 · Web `tsc --noEmit` exit 0 · Web vitest `orders-on10.test.ts` **6/6**.
- Full API suite / full build / fresh-PG run for this batch are covered by the OB5 closing gate
  (see docs/orders-ob5-acceptance.md).

## Honest limits

- **logoUrl does not render.** It is stored + validated, but the dependency-free PDF toolkit has no
  raster-image embedding, so no logo appears on any document yet. The schema comment, the service
  comment and the Print Center UI all say this plainly — it is recorded as a stored setting awaiting
  an image-capable toolkit, not as a working feature.
- The legacy 50-cap stays on the direct courier endpoints; only print-center jobs lift it to 100
  (validated up front). PrintJob rows record ids + outcomes only — re-printing means a new job.
- Bengali text on PDFs hits the toolkit's documented WinAnsi limitation exactly like the pre-ON10
  labels/invoices (merchant template text in Bengali will not render glyphs) — unchanged behaviour,
  stated here so it is not mistaken for an ON10 regression.
- Nothing live-proven: no real printer/browser download exercised; migration not run on any real DB.
