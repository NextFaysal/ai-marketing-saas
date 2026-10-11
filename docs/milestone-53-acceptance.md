# Milestone 53 Acceptance — Bulk Courier Booking + Label/Invoice PDF

## Bulk booking semantics (as implemented)
- `POST /organizations/:id/courier/shipments/bulk` (OWNER/ADMIN/
  MARKETING_MANAGER/SUPPORT_AGENT). Cap 50 enforced twice: DTO
  `ArrayMaxSize(50)` and a service-level check; empty batch refused.
- Each order is booked through the EXISTING `bookShipment` path
  (same validations, same per-booking audit, same duplicate guard).
  Per-order recipient name/phone default from the order's customer
  exactly as single booking; the address is the order's own stored
  address unless one shared `recipientAddress` is supplied.
- Results array per order: `{ orderId, ok, shipmentId?,
  trackingCode?, status?, skipped?, error? }`:
  - booked -> ok with the provider's tracking id;
  - already booked (active shipment for same org+order+provider)
    -> `skipped: true` with "ইতিমধ্যে বুক করা আছে (Tracking: ...,
    স্ট্যাটাস: ...)" — never double-booked;
  - provider failure -> the provider's error VERBATIM (via the
    existing courierError mapping inside bookShipment);
  - unknown order -> "Order not found in this organization".
- One failure never stops the rest. Response totals
  { requested, booked, skipped, failed }; the UI reports partial
  success as partial. One batch audit entry
  `courier.shipments.bulk_booked` with provider + counts (each
  successful booking also writes its own `courier.shipment.booked`).
- UI (Orders page): row checkboxes (50 cap, select-all), a bulk bar
  with provider select (connected only; RedX area picker when RedX
  is chosen — RedX booking genuinely requires it), per-order
  results list, and a "সব লেবেল এক PDF এ" download.

## PDF + barcode (how produced)
- Dependency-free, hand-rolled PDF 1.4 writer
  (`apps/api/src/courier/pdf.ts`): object/xref assembly, built-in
  Helvetica, content streams; responses carry
  `Content-Type: application/pdf` and attachment disposition.
  No new dependency was added (checked: no pdf/barcode library
  exists in any workspace package.json).
- Genuine Code128 (`apps/api/src/courier/barcode.ts`): the full
  107-symbol width table, code set C for even-length numeric
  payloads (dense consignment ids), set B otherwise, spec checksum
  (start + Σ value×position) mod 103, drawn as vector rectangles.
  Unit tests assert the table invariants (11 modules/symbol,
  13-module stop) and textbook vectors: "HI" -> [104,40,41,20,106],
  "123456" (C) -> [105,12,34,56,44,106], "A" -> [104,33,34,106].
- Label (4x6"): sender (org name + business-profile phone),
  recipient name/phone/address, order invoice no, provider, COD
  amount, Code128 of the tracking id + the id in plain text.
  `GET shipments/:shipmentId/label.pdf`; bulk:
  `GET labels.pdf?ids=a,b,c` (one PDF, one page per shipment,
  org-scoped, cap 50).
- Invoice: `GET orders/:orderId/invoice.pdf` built from the same
  stored data as the M39 printable invoice: org name/phone, invoice
  no (externalNumber), date, customer, items, subtotal/shipping/
  discount/total, COD/payment label.
- Honest limitation: built-in PDF fonts are WinAnsi — text outside
  printable ASCII (e.g. Bengali script inside a name/address) is
  replaced with "?" IN THE PDF ONLY; tracking ids, amounts and
  phones are ASCII and exact, and the app data is unaffected.
  Embedding a Bengali font is a documented future iteration.

## Verification
- New `apps/api/src/courier/m53-bulk-pdf.spec.ts` (10 tests):
  Code128 vectors + table invariants; label/invoice PDF bytes start
  with %PDF and contain the tracking id / items / totals; bulk
  partial-failure matrix (book / provider-422 verbatim /
  missing-address validation / already-booked skip / unknown
  order), second-run skip (no double booking), cap + empty-batch
  refusals, batch audit metadata, org isolation on PDFs.
- Full monorepo build green; full API suite 539 pass / 77 suites
  (baseline before Batch 2: 519/75).
- Live (sandbox, fresh tenant, API restarted on the new build,
  Steadfast seeded CONNECTED with fake credentials):
  1. Bulk over 3 orders -> ord1 failed with Steadfast's REAL host
     answer verbatim: "Steadfast request failed (401):
     Unauthorized Access (invalid API credentials)"; ord2 SKIPPED
     (pre-seeded shipment, tracking SFTRACK53 named in the
     message); ord3 failed with the address-validation message.
     Totals { requested: 3, booked: 0, skipped: 1, failed: 2 } —
     the batch ran to completion per-order.
  2. 51 order ids -> 400 "orderIds must contain no more than 50
     elements" (DTO).
  3. label.pdf -> 200, Content-Type application/pdf, attachment
     filename, body starts %PDF-1.4 and contains SFTRACK53.
  4. labels.pdf combined -> %PDF-1.4 with the page objects.
  5. invoice.pdf -> %PDF-1.4 containing "Cotton T-Shirt" and
     "Invoice: M53-1" from the seeded order rows.
  6. Another org's label URL -> 403 (TenantGuard).

## Not claimed
- No bulk run against a REAL courier account (needs the owner's
  credentials — M30 courier sessions); Steadfast's real refusal
  proves the per-order error path against the live host.
- No visual/pixel QA of the PDFs or the bulk UI (bytes, headers,
  content strings and API behaviour verified).
