# Completion Program GB5 — Acceptance (GC13 + GC14 Courier Completion)

Worktree: `~/workspace/ai-marketing-saas-gc`, branch `completion`,
base `f7f6d5b` (GB4). LOCAL COMMITS ONLY — nothing pushed.
Migration: `20261013950000_gb5_courier_ops` — **NOT run on any
real DB**; deploy runs it with the rest of the pending sequence.

## GC13 — Adapter framework

- **Explicit contract**: `apps/api/src/courier/courier-client.ts`
  — `CourierClient` (`book()` / `statusOf()`), `CourierBookingRequest`
  / `CourierBookingResult` / `CourierStatusResult`,
  `COURIER_PROVIDERS` + `COURIER_STATUSES` (the internal
  vocabulary), and the registry: `createCourierClient(provider,
  creds, hooks)` (the ONE construction site, incl. Pathao's
  token-persistence hook) + `courierAdapter(provider, client)`.
- **Zero behaviour change for the existing three**: each adapter's
  `book()` is the EXACT payload build + validations that
  `bookShipment` used to inline (moved, not changed); Pathao's
  `createOrder` and RedX's `createParcel` gained only an ADDITIVE
  `rawStatus` field, plus additive `orderStatusDetail` /
  `parcelStatusDetail` reads (`orderStatus` / `parcelStatus`
  delegate, signatures untouched). CourierService now books and
  syncs ONLY through the adapter; concrete clients are reached
  via `rawClientFor` for provider extras (stores/areas/cities,
  price plans, verify calls) and `connect()` constructs through
  the factory too.
- **Existing specs**: 9 courier suites / 90 tests pass. ONE spec
  stub changed — disclosed, not hidden:
  `cx6-tracking.spec.ts` stubbed the private `clientFor` seam
  with a Steadfast-shaped object (`statusByTrackingCode`); GB5
  changed that seam's contract by design (it now returns the
  adapter), so the stub speaks `statusOf()`. Every assertion in
  the test is unchanged. `on1-queues.spec.ts`'s pinned queue-key
  list gained `rto_attention` — the deliberate GC14 surface
  extension (§GC14.4), with all existing keys/counts untouched.
- **Adding a provider after GB5** (the recipe): (1) one client
  class with the provider's documented calls + a status mapper
  into the internal vocabulary; (2) one `case` in each factory
  in `courier-client.ts` + one adapter class + the key in
  `COURIER_PROVIDERS`; (3) a `connect()` branch (verify-before-save
  or honest "configured") + DTO fields; (4) one credentials-form
  entry in the web (connect panel + orders page). Nothing else
  in CourierService changes — booking, sync, events, RTO and
  profit all ride the contract.

## GC13 — Provider verdicts (research: docs/gb5-courier-research.md)

- **eCourier — BUILD.** Documented in eCourier's own versioned
  merchant API documents (General v5.2/v5.5 + Reseller v5.5,
  linked from ecourier.com.bd/resources; citations in the
  research doc): ALL operations are POSTs; auth is three
  headers (API-KEY / API-SECRET / USER-ID, hyphenated per §1.0;
  underscore spellings also sent because eCourier's web
  materials have shown them); credentials are provider-issued
  for a merchant account (no self-serve generation is evidenced
  in the documents). Verify-before-save = the documented
  assigned-package list (`POST /packages`). Booking
  (`POST /order-place`) implements the document's full
  mandatory set — recipient city + thana + area + zip by name,
  an ASSIGNED package_code (weight lives in the package; there
  is no weight field), product_price as the collect amount
  (there is no cod_amount field), payment_method COD|POS|MPAY|
  CCRD (COD defaulted only when the order collects at the
  door; a prepaid order requires a staff choice — no documented
  default exists). Tracking (`POST /track`) parses the
  documented query_data status triples; only eight statuses are
  evidenced in the documents and those are mapped first, other
  free-text statuses degrade defensively with the raw string
  preserved on the event log. A documented staging base exists
  (staging.ecourier.com.bd/api); no sandbox credentials are
  published. NOTE: eCourier's developer-portal pages diverge
  from the versioned documents (methods, field sets, status
  list); an early GB5 implementation followed the portal and
  was corrected to the documents within the batch — the shipped
  code follows the documents everywhere.
- **Paperfly — NO-BUILD.** No developer documentation exists on
  any Paperfly-owned domain (bounded search found none); their
  own material frames API access as a per-enterprise partner
  arrangement ("Paperfly Go" is a token-gated partner API); the
  staging host that public material names answers 401s behind a
  Cloudflare wall and publishes no auth model, endpoints or
  payload shapes. Building a client would mean fabricating an
  integration. Paperfly is absent from the registry and the UI;
  GC14's manual tracking update is the honest loop for API-less
  couriers. Revisit when Paperfly publishes docs or the owner
  obtains partner API access + documentation.

## GC13 — Multi-account honesty

In THIS tree an org effectively has ONE usable account per
courier provider: `CourierService.integration()` resolves one
Integration row per (org, provider) with `findFirst`, and every
flow (connect, book, sync, quote, rules) uses that row. EC22
rules name a `courierAccountId`, but `bookShipment` resolves the
account through the same single-row path. GB5's registry factory
therefore takes the credentials of that same resolved row — no
second selection model was invented. (CC-Next's multi-account
model unions later, on its own line.)

## GC14 — Courier ops

1. **Shipment event log** — `CourierShipmentEvent`
   (organizationId, shipmentId, kind status|error|note, status?,
   rawStatus?, source api_sync|manual|booking|system, actorId?,
   message? ≤500, createdAt; FK cascade; indexes (org, shipment,
   createdAt) + (shipment, kind, createdAt)). Written
   failure-isolated by a single guarded writer: booking (initial
   status, source=booking), every sync status CHANGE (transitions
   only, raw provider string preserved; an unchanged poll writes
   nothing), sync provider errors (kind=error, provider message
   snippet — the error still surfaces exactly as before), manual
   updates + notes. NO backfill — the log starts at GC14, and
   the shipment-detail UI says so in words. Booking-time
   provider errors have no shipment row to attach to; they keep
   surfacing verbatim in the API response (not fabricated into
   the log). The ON2 order timeline gains the status-kind events
   as a source (booking rows skipped there — the booking entry
   already exists).
2. **Manual tracking update** — `POST courier/shipments/:id/
   manual-status {status, note?}` (internal vocabulary only,
   validated against `COURIER_STATUSES`). It routes through
   `applyShipmentStatus` — the single applicator extracted from
   syncShipment's post-fetch body (row update + GC14 event +
   S1 return-restore hook + A2 workflow event + legacy
   notifyCustomer + ON5 engine notifications) — so a manual
   "delivered"/"returned" behaves exactly like a synced one;
   the event is stamped source=manual + actorId, and the change
   is audited (`courier.shipment.manual_status`). A same-status
   call with a note writes only a kind=note row. On the check
   the brief asked for: there is NO separate "manual/other"
   provider concept in this tree (providers are the four
   registry keys + the Steadfast connect on the orders page);
   manual-status therefore completes the loop for any shipment
   whose provider API is unavailable, which the UI copy says.
   (Extraction note: the applicator's S1 comparison uses the
   pre-update `previousStatus` capture instead of re-reading
   `shipment.status` after the update — strictly more correct,
   and required for correctness when the row object is shared.)
3. **Booking charge** — `CourierBookingResult.chargeMinor` +
   `CourierShipment.chargeMinor` (BigInt, serialized like the
   COD amount). Per provider (research doc table): **Pathao YES**
   (`delivery_fee` at booking — stored); Steadfast NO, RedX NO
   (charge exists only via its pre-booking calculator = a
   quote), eCourier NO (no documented charge field) — null
   forever, never estimated, never backfilled from quotes.
   ON7 profit: per-shipment actual resolution is now sheet line
   (EC26) → else booking charge, response gains
   `deliveryActualSource` (`reconciliation_sheet` | `booking` |
   `mixed` | null); the all-shipments-covered rule is unchanged.
   chargeMinor is surfaced on the shipment detail UI + list
   responses; ON9's scorecard is untouched.
4. **RTO** — a shipment is RTO when `classifyShipmentStatus`
   (the existing classifier, reused by ON9) says returned.
   (a) ON1 queue **`rto_attention`** ("RTO — ফেরত পার্সেল দেখা
   বাকি"): non-practice orders with a returned-family shipment,
   order status NOT in (returned, refunded), and no completed
   return resolution — resolution defined precisely as a
   ReturnRequest in status received|completed OR with
   restockAppliedAt set; open requests (requested / approved /
   return_shipped) do NOT clear the order. It resolves through
   the same `resolveQueueOrderIds`, so count == list by
   construction (spec-pinned). (b) **RTO report**
   `GET courier/rto-report?from&to` (Dhaka days, default last
   30): per provider {booked, delivered, returned, rtoRatePct =
   returned/booked, avgDaysToReturn, timingN} + totals; rendered
   as a section on the Dispatch board. (c) avgDaysToReturn is
   computed ONLY from event-log pairs (booking status event →
   first returned-family status event) for shipments in the
   cohort; timingN states the n; pre-GC14 shipments (no events)
   are excluded, never estimated.

## Web surfaces

- Connect Center courier panel + Orders-page legacy forms:
  eCourier card (API Key / API Secret / User ID / optional
  partner Base URL), verify-before-save copy, live test via the
  cities read; connections page copy updated (four providers).
- Orders page: eCourier in the provider filter, both bulk bars
  (with shared city/area inputs on the legacy bulk card), and
  the booking form (city/area selects from eCourier's own
  lists with typed fallback; booking button disabled until
  city + area are present); quote for eCourier shows the API's
  honest quotable:false reason.
- Shipment detail (orders page, per-shipment "📜 ইতিহাস ও
  ম্যানুয়াল স্ট্যাটাস"): booking charge when present, the
  event history list (kind, mapped status, raw provider string,
  source, time, message), and the manual status form (internal
  vocabulary select + note).
- Dispatch board: the RTO report section (date range, per-provider
  table + totals, timing-n caveat copy).

## Specs added

- `apps/api/src/courier/gb5-courier.spec.ts` (19 tests):
  registry contents + factory + adapter contract; eCourier
  verbatim-status mapping (incl. Return Pending); EcourierClient
  verify/place/track/error shapes (fetch-stubbed); eCourier
  connect verify-before-save + nothing-saved-on-bad-creds;
  booking city/area requirement + null charge + booking event;
  eCourier quote quotable:false; Pathao chargeMinor stored
  (8000n) with deliveryFeeMajor unchanged; sync transition /
  unchanged-poll / error event discipline; manual delivered +
  returned through the applicator (restore hook fires, audit
  written); unknown manual status refused; note-only event;
  org-scoped event listing; RTO report math incl. timing n.
- `apps/api/src/orders/gb5-rto-profit.spec.ts` (5 tests):
  rto_attention inclusion/exclusion matrix + count==list;
  ON7 booking fallback, sheet precedence, mixed label,
  chargeless ⇒ null.
- Existing suites: courier 90/90, orders incl. on1/on2/on7
  green (see gates).

## Gates (verified personally, exit codes)

- API jest (full, corrected tree): **354/355 suites PASS in the
  full run with 3,709/3,709 executed tests PASS, zero test
  failures**; the one remaining suite
  (automation/a4-job-templates) lost its worker to an OS SIGKILL
  (OOM on this memory-tight, concurrently-loaded box — not a
  test failure) and passes standalone: **8/8, exit 0**. Net:
  all 355 suites / 3,717 tests green (GB4 baseline 353/3,692 →
  +2 suites / +25 tests = the two GB5 spec files). Two earlier
  full runs aborted outright (exit 134) under concurrent load;
  the numbers above are from the completed run + the standalone
  re-run, per the standing flake discipline. The previously
  flaky cx3 suite passed inside the completed run.
- API tsc: exit 0. Web tsc: exit 0.
- Web vitest: **367/367 PASS, exit 0** (baseline preserved).
- Full build (`pnpm build`, 7 workspace projects incl. BOTH
  next builds — web + admin): **exit 0**.
- Prisma validate: exit 0 ("The schema is valid").
- Fresh-DB full sequence: **169/169 migrations applied cleanly**
  on a throwaway PostgreSQL 16 database (`prisma migrate
  deploy`, exit 0), finishing with
  `20261013950000_gb5_courier_ops`; 235 tables;
  `CourierShipment.chargeMinor` + the 10-column
  `CourierShipmentEvent` table verified present.

## Migration + deploy notes

- `20261013950000_gb5_courier_ops`: additive only
  (`CourierShipment.chargeMinor` BIGINT nullable +
  `CourierShipmentEvent` table). NOT run on any real DB. Deploy
  runs the full pending sequence as usual; fresh-DB proof
  above. No data backfill by design.

## Honest limits

- **No live courier proof for anything in GB5** — every provider
  behaviour is fixture/doc-proven only. eCourier's own sources
  diverge (developer-portal pages vs the versioned API
  documents); GB5 follows the documents, but only M30 with a
  real merchant account (and eCourier-issued credentials —
  including a staging set, which is not published) settles the
  remaining uncertainty, e.g. whether their gateway accepts the
  documented hyphenated headers exactly as specified.
- The owner's Pathao sandbox returned Cloudflare 522 in earlier
  milestones; no sandbox success is claimed here — Pathao paths
  are covered by the pre-existing fetch-stubbed specs, unchanged.
- Paperfly NO-BUILD is a documentation verdict, not a claim
  that Paperfly has no API at all: a partner-gated API exists
  ("Paperfly Go"); it is simply not implementable from public
  documentation.
- Booking-time provider errors are not attached to the event
  log (no shipment exists yet); sync errors are.
- The event log knows nothing before GC14: RTO timing and the
  shipment history grow from deploy day forward.
- Multi-account per provider remains one usable account in
  this tree (see GC13 note).
