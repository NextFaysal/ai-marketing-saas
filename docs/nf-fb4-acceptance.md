# FB4 Acceptance — NF9 Rider Live GPS + NF10 Full Accounting + NF11 HR Lite + NF12 Supplier Portal & Dropship

**Batch:** New Features Frontier FB4 (NF package approved in full by the owner 2026-10-17)
**Worktree/branch:** `~/workspace/ai-marketing-saas-nf`, `new-frontier` · **Base:** `477c4cf9` (FB3 code-complete, 232 migrations)
**Local commits only — nothing pushed.** Migration claims used: `20261036000000` (NF9) + `20261037000000` (NF10) + `20261038000000` (NF11) + `20261039000000` (NF12).
Per-item detail: `docs/nf9-rider-gps-acceptance.md`, `docs/nf10-accounting-acceptance.md`, `docs/nf11-hr-lite-acceptance.md`, `docs/nf12-supplier-dropship-acceptance.md`. This doc is the batch record: the finisher's independent serial gates + the consolidated NOT BUILT list.

## Per-item record (20 FB4 commits, oldest → newest)

| # | Commit | Item |
|---|---|---|
| 1 | `44ab8fb3` | NF9: RiderShareLink + RiderLocationPing + RiderLocationLatest schema + migration `20261036000000_nf9_rider_gps` |
| 2 | `85976272` | NF9: API — RiderGpsService, public rider surface, staff fleet/share-link routes, CX6 + EC18 tracking payload extension |
| 3 | `f806522d` | NF9: specs — `nf9-rider-gps.spec.ts` (21 tests) |
| 4 | `2efe13f5` | NF9: web — fleet view `/dashboard/delivery`, public `/rider/[token]` share page, tracking-page location blocks, nav |
| 5 | `089c37cb` | NF9: acceptance doc |
| 6 | `4c31c5d5` | NF10: ChartAccount + JournalEntry/JournalLine schema + migration `20261037000000_nf10_accounting`, EC26 reconciliation extended for bank statements |
| 7 | `5c1ef1fb` | NF10: API — AccountingService + controller/module, FinanceService expense-create journal hook |
| 8 | `bac8db0b` | NF10: specs — `nf10-accounting.spec.ts` (18 tests) |
| 9 | `66e057ba` | NF10: web — `/dashboard/commerce/ledger` (accounts, journal, P&L/VAT + PDF, statement import + human confirm/reject), finance link |
| 10 | `6ccb7a1f` | NF10: acceptance doc |
| 11 | `6f451ba9` | NF11: HR schema + migration `20261038000000_nf11_hr_lite` (all on existing Membership — no parallel people table) |
| 12 | `de90e4cd` | NF11: API — HrService + staff/self controllers + module |
| 13 | `a6827185` | NF11: specs — `nf11-hr.spec.ts` (13 tests) |
| 14 | `b8bcb626` | NF11: web — `/dashboard/hr` (my-section + admin: profiles, attendance, roster, leave queue, payroll runs, payslips) |
| 15 | `dfa1e28e` | NF11: acceptance doc |
| 16 | `9efea814` | NF12: schema + migration `20261039000000_nf12_supplier_dropship` (SupplierPortalLink, PO supplier stamps, DropshipAgreement/Offer/Listing/OrderLink/LedgerEntry) |
| 17 | `1f4f7ad4` | NF12: API — SupplierPortalService + DropshipService + staff/public controllers + module |
| 18 | `9772ca3d` | NF12: specs — `nf12-supplier-dropship.spec.ts` (20 tests) |
| 19 | `a269053c` | NF12: web — `/dashboard/commerce/dropship`, public `/supplier/[token]` portal, nav |
| 20 | `74e1f313` | NF12: acceptance doc |

## NF9 — what shipped (detail: `docs/nf9-rider-gps-acceptance.md`)

- **Hashed-token rider share page:** `RiderShareLink` stores only a SHA-256 `tokenHash` (OrgInviteLink discipline — deliberately NOT the CX6 raw-token pattern); staff issue = create/rotate (old token dies immediately, raw token shown once), revoke is terminal; 30-day expiry. The ping DTO carries no riderId at all — a token can only ever post for its own rider (forged-riderId spec-proven).
- **Retention-conscious storage (the recorded choice):** `RiderLocationLatest` = one upserted latest fix per rider; `RiderLocationPing` = trail **capped at 200 rows per assignment**, pruned on insert. No unbounded history is kept.
- **Honest liveness:** fixes older than **5 minutes** are labelled stale ("পুরনো অবস্থান") in the fleet view and the customer payload — never presented as live. The public `/rider/[token]` page states plainly that sharing happens only while the page is open; there is **no background tracking** and none is claimed. Posting is refused with no active assignment and while sharing is OFF; stop-sharing takes effect immediately.
- **Surfaces:** dashboard fleet view at `/dashboard/delivery` (active assignments, order ref, coords + external "মানচিত্রে দেখুন" Google Maps link — no map vendor existed in deps and none was added); BOTH customer tracking payloads (CX6 `publicTracking` + EC18 `trackOrder`) carry `riderLocation` under one shared rule — order/shipment `out_for_delivery` **or** own-rider assignment `picked_up`, plus sharing ON plus an active assignment for that order; otherwise `null` and the pages render nothing (no placeholder, no fake location).

## NF10 — what shipped (detail: `docs/nf10-accounting-acceptance.md`)

- **Chart of accounts + double-entry journal:** org-scoped `ChartAccount` with BD-retail defaults lazily seeded per org on first use (system accounts renamable, not deletable/retypable). `JournalEntry`/`JournalLine` with the **balance invariant enforced at the single service door** — Σdebit == Σcredit, > 0, ≥ 2 lines; an unbalanced entry can never be saved (spec-proven).
- **Auto-entries, idempotent per source record:** sold-order (completed|delivered) revenue Dr AR / Cr Sales (net) + Delivery Income + VAT Payable; **COGS only from real `ProductCost`** — if any line lacks cost, the whole order's COGS is omitted and the gap is **counted on the P&L** (never invented); verified payments (**`PaymentVerification.status = "approved"`** is the codebase's verified state) settle AR by method (Dr Cash/bKash/Bank) — revenue is never double-counted; existing `Expense` rows become journal-backed via a hook on the create path + idempotent backfill (**the Expense model/API was not forked**); courier charges from real records — settlement-sheet `sheetChargeMinor` preferred, booking `chargeMinor` fallback, neither → no entry. Re-running generation creates no duplicates (spec-proven).
- **Statement reconciliation on the EXISTING EC26 machinery** (extended, not forked): CSV bank/mobile-banking import, amount + ±3-day match **suggestions only — nothing auto-confirms**; a human confirms/rejects each line (spec-proven).
- **Reports:** monthly P&L + VAT summary computed **only from journal data**; the VAT rate is read from the existing `TaxSetting.defaultVatBps` — unset → the report shows amounts with rate `null`, no rate is ever assumed. PDF via the existing courier/pdf toolkit. The disclaimer "এটি একটি হিসাব-সহায়ক টুল — অডিট করা বা বিধিবদ্ধ হিসাব নয়।" appears verbatim on the web reports and every JSON payload. **Known limitation (recorded, not hidden):** the shared PDF toolkit is WinAnsi-only, so Bengali glyphs render as "?" inside PDF bytes; PDFs therefore also carry the disclaimer in English gloss. Fixing that needs a Bengali-capable font embedded in the shared toolkit — out of this batch's scope.

## NF11 — what shipped (detail: `docs/nf11-hr-lite-acceptance.md`)

- **Payroll attribution finding (verbatim from the audit):** a REAL attribution source exists — `Order.agentId` (a User id, set by the existing assign flows) plus `Order.commissionMinor`, the commission amount **recorded at assignment time**. Payroll commission = Σ recorded `commissionMinor` over sold orders attributed to the member in the month. There is **no org-level commission % config anywhere**; the scoreboard's ৳50 is a read-time query-param fallback that is never stored — it was **not used** (spec-proven: attributed sold orders with 0 recorded commission yield payroll commission 0). The rule string (`recorded_order_commission`) is stored in `HrSetting` and snapshotted verbatim into every run.
- **Payroll:** salary profiles per Membership (OWNER/ADMIN; staff see their own summary; payout note is free text — no credential fields); the pro-rata rule is stored and explicit (`per_calendar_day`: deduction = round-half-up(base × unpaid days ÷ days-in-month)) and deductions come **only from APPROVED UNPAID leave overlapping the month** — paid/pending/rejected leave deducts nothing (spec-proven). Runs are DRAFT (lines editable only via labelled, note-bearing, audit-logged adjustments; regeneration replaces draft lines) → OWNER marks PAID (immutable). **Marking paid is a record, not a money movement** — stated in UI, JSON and PDF.
- **NF10 integration: BUILT, cleanly.** NF10's `AccountingService.createJournalEntry` is a clean public door and its defaults already include Salary Expense (5210) + Cash (1000) — mark-paid posts exactly ONE balanced entry (Dr Salary Expense / Cr Cash, `sourceType = "payroll_run"`, idempotent), failure-isolated: a journal failure leaves the paid record standing with `journalPosted: false` + the error reported, never a silent half-state.
- **Attendance/roster/leave:** self check-in/out keyed to the org's real timezone (`Organization.timezone`, NF4 `localParts` reused); admin corrections require a note and always write an AuditLog; shift roster reuses NF4's availability shape on Membership; leave is a strict pending → approved|rejected machine (no re-deciding). Payslips are generated from the **stored line** (never recomputed), so payslip total == line total == run total (spec-proven). Staff see only their own payslip/attendance/leave (spec-proven).

## NF12 — what shipped (detail: `docs/nf12-supplier-dropship-acceptance.md`)

- **Supplier portal:** hashed-token link per (org, supplier) pair (NF9 discipline); the supplier sees **only their own POs from that one org** and the org's display name — no orders, customers, other suppliers (two-supplier isolation spec-proven: the other supplier's PO id returns 404, the victim row untouched). **PO transition mapping from the audit:** EC20's flow has NO supplier-side transitions at all, so portal *confirm* rides the existing `draft→ordered` transition + a `supplierConfirmedAt` stamp, and *mark shipped* is a `supplierShippedAt` **stamp only — no status was invented**; receiving stays buyer-only. Lead-time updates write only the supplier's own record.
- **Dropship agreements:** invite by org slug reveals **existence + display name only**; OWNER/ADMIN of the invited org accepts/declines; **before acceptance nothing is shared** — offers, listings and product reads all refuse (spec-proven for pending and declined). Revocation stops new listings/fulfilment; existing links keep their mirror.
- **Data minimisation (the core design):** the supplier-side fulfilment order is created via `OrdersService.createManual` priced at the **floor (wholesale) only**, carrying fulfilment data (items, quantities, customer delivery name/phone/address). The seller's retail price **does not exist** in the supplier order payload (spec-proven by string inspection) and is stripped from the supplier-side link view; retail lives only in seller-side snapshots + the ledger. Partner stock is read live from the source org's real stock truth (bin balances, else product counter) and labelled "পার্টনার স্টক"; the seller product's own `stockQuantity` stays `null` — partner stock is never merged into the seller's counts. Seller price < floor is refused server-side.
- **Exactly-once + mirror + ledger:** `DropshipOrderLink` unique per (sellerOrder × agreement) — a deliberate, documented deviation from a plain sellerOrderId unique, since one seller order can span two agreements — plus a deterministic `dropship:<sellerOrder>:<agreement>` externalRef upsert; double placement/replay yields one supplier order + one link (spec-proven). Status mirror is a read model refreshed on staff reads; the seller order's own lifecycle is untouched. Cancellation propagates only pre-fulfilment; after completion it is refused with the reason recorded on the link. The commission ledger entry is created exactly once when the supplier order reaches a sold status, computed from the **real order totals** (spec: 2×৳800 retail − 2×৳500 wholesale = ৳600 margin). **RECORDS ONLY — no payout is executed anywhere and no wallet is mutated; payouts remain behind the OU11 legal gate**, stated in the UI (records-only banner), the API payloads and this doc.
- **Recorded boundary:** fulfilment is triggered by the explicit `processSellerOrder` service path (dashboard/API) — the native checkout was **not forked** to hook it automatically (see NOT BUILT).

## Gates (finisher, run STRICTLY SERIALLY, recorded as they finished)

| Gate | Result |
|---|---|
| FB4 targeted jest — independent combined re-run of all four suites (`nf9-rider-gps`, `nf10-accounting`, `nf11-hr`, `nf12-supplier-dropship`) | **4 suites / 72 tests PASS** (21 + 18 + 13 + 20) |
| Worker-recorded regression (per item, during the build) | NF9: delivery + CX6/EC18/EC31 **26/26** · NF10: gb8-finance + ec26-reconciliation **49/49** · NF11: combined with nf10/gb8/ec26/scoreboard **83/83** · NF12: ec20 purchasing **38/38**, m65 manual-orders **26/26** |
| API tsc `--noEmit` | **PASS** (exit 0) |
| API build (`tsc -p tsconfig.build.json`) | **PASS** (`dist/main.js` produced) |
| Web tsc `--noEmit` | **PASS** |
| Web full vitest | **120 files / 975 tests PASS** (FB3 baseline 962; +3 rider-gps +3 accounting +3 hr +4 dropship = 975) |
| Web build (`next build`) | **PASS** — all six new routes in the output: `/dashboard/delivery`, `/dashboard/commerce/ledger`, `/dashboard/hr`, `/dashboard/commerce/dropship`, `/rider/[token]`, `/supplier/[token]` |
| Fresh-PG (throwaway local PG16 + pgvector, empty DB, `prisma migrate deploy`) | **236/236 migrations applied, 0 unfinished** (232 base + `20261036000000` + `20261037000000` + `20261038000000` + `20261039000000`); new tables verified present: RiderShareLink, RiderLocationPing, RiderLocationLatest, ChartAccount, JournalEntry, JournalLine, HrSetting, StaffSalaryProfile, AttendanceRecord, StaffShiftPattern, LeaveRequest, PayrollRun, PayrollLine, SupplierPortalLink, DropshipAgreement, DropshipOffer, DropshipListing, DropshipOrderLink, DropshipLedgerEntry |
| **Boot smoke** (API dist booted against the fresh-PG DB) | **PASS** — `GET /health` → `{status:"ok"}`; RouterExplorer mapped ALL new FB4 route families among 1,827 mapped routes: accounting (`…/accounting/accounts`, `journal`, `reports/pnl[/pdf]`, `reports/vat[/pdf]`, `statements…`, `sync`), delivery (`…/delivery/riders` + `:riderId/share-link` GET/POST/DELETE), HR (`…/hr/setting`, `salary-profiles`, `attendance` + `correction`, `me/attendance/check-in|check-out`, `leave` + `decide`, `shifts`, `payroll/runs` + `mark-paid` + payslip/PDF), dropship (`…/dropship/invite`, `agreements` + `respond`/`revoke`/`offers`, `listings`, `ledger`) + supplier portal-link routes on commerce suppliers. Live probes: `GET /public/rider/invalid-token-xyz` → **404 `{"message":"এই রাইডার লিংকটি পাওয়া যায়নি"}`** and `GET /public/supplier/invalid-token-xyz` → **404 `{"message":"পোর্টাল লিংকটি পাওয়া যায়নি"}`** — the designed Bengali 404s on both new public surfaces |
| Full API jest suite | Not run as a single gate (brief gates = the four targeted suites + recorded per-item regression + typecheck/build/web/fresh-PG/boot, as in FB1–FB3). No gate was marked green from an unrecorded run. |

**Environment note (pre-existing, recorded by the NF12 worker):** `prisma generate` could not run in this worktree because the previously generated client is root-owned; the codebase's `(prisma as any)` discipline kept tsc green and `prisma validate` + `migrate deploy` (fresh-PG above) both passed. The finisher's fresh-PG run used the migration SQL directly, so this did not affect any gate.

**Migration-collision watch (carried from FB2/FB3, still true):** the Campaign Advanced (CA) line circled the `20261030000000+` range in its plan from a different base. This line now owns folders `20261030000000_nf3_voice_conversation` … `20261039000000_nf12_supplier_dropship` (…28 NF1, …29 NF2, …30 NF3, …31 NF4, …32 NF5, …33 NF6, …34 NF7, …35 NF8, …36 NF9, …37 NF10, …38 NF11, …39 NF12); at union time check the CA line's actual folder names against these — same timestamp with a different name deploys lexicographically, an identical name would collide.

## NOT BUILT (consolidated, merged from the four per-item lists)

**Live proof — everything:** no FB4 migration has run on a real database, no real phone has posted a real GPS fix, no real bank statement has been imported, no real payroll has been run, no real supplier has used the portal, no real cross-org dropship order has flowed. **Nothing in FB4 is live-proven** (M30-style verification owed).

**NF9:**
- No native app, no background tracking (the share page posts only while open — by design, and the page says so), no embedded map / map vendor, no route optimisation, ETA or geofencing, no third-party courier GPS.
- Share links are delivered manually by staff (copy/paste) — no SMS/WhatsApp send automation for the rider link.

**NF10:**
- Expense EDIT/DELETE does not rewrite its journal entry (the original entry stands as the audit record; corrections are manual reversing entries).
- Courier entries are first-charge-wins — a later corrected charge does not amend the entry.
- Revenue recognition is order-status based only (completed|delivered); a shipment-delivered order whose status lags is not recognised in v1.
- A confirmed statement match records the reconciliation link only — it does not itself create a journal entry.
- PDF disclaimer limitation: Bengali disclaimer is verbatim on web + JSON; inside PDF bytes the shared WinAnsi toolkit renders Bengali as "?", so PDFs carry the English gloss (see NF10 section above).

**NF11:**
- Mark-paid moves no money — no payout integration (salary is actually paid outside the system; the run + journal entry are the record).
- No salary-profile history/versioning, no attendance reports/exports, no late/absent derivation, no attendance geolocation, no leave balance/accrual quotas, no off-cycle runs, no TDS/tax computation, no payslip sending (email/SMS).
- Attribution counts `agentId`-based recorded commission only; any `assigneeId`-style attribution is not counted.

**NF12:**
- **No payout execution of dropship margins — the OU11 legal gate stands; no wallet mutation anywhere in NF12.**
- **No cross-org anything beyond this design** — no shared customers, catalogues, analytics or messaging between orgs.
- No automatic checkout hook: dropship fulfilment is created by the explicit `processSellerOrder` path (dashboard/API), not by forking the native checkout.
- Delivery/shipping charges do not cross orgs (the supplier order carries items at floor price; shipping settlement between the orgs is a manual, off-system matter in v1).
- The supplier portal does not show dropship orders (they live in the supplier org's own Orders UI); portal link delivery is manual (no SMS/WhatsApp send).

## Owner decisions / actions still owed

1. **Push instruction** for this line (union release with the other lines; check the CA migration folders first — see the watch note above) + **manual Dokploy Redeploy**. FB4's four migrations (…36–…39) will run on the real DB at that deploy.
2. **Per-org adoption is staff work:** issue rider share links + supplier portal links per org (links are never auto-sent), seed/review each org's chart of accounts, set salary profiles + confirm the stored payroll rules per org, and create dropship agreements org-to-org (invite by slug → the other org's OWNER/ADMIN accepts).
3. **Payroll is record-only by design** — salaries are paid outside the system; marking a run PAID records that fact + posts the NF10 journal entry, it does not pay anyone.
4. **Dropship payouts stay blocked** behind the OU11 legal gate + the wallet legal review — the NF12 ledger is the record that a future payout would settle from; nothing moves until the owner clears that gate.
5. **Accounting disclaimer stands:** NF10 reports are an accounting aid, not audited/statutory accounts — the owner's accountant remains the statutory path; the PDF Bengali-glyph limitation (English gloss in PDFs) is accepted or a Bengali-font toolkit upgrade is commissioned separately.
6. **All live proof still owed:** a real rider GPS session end-to-end, a real statement import + reconciliation, a real month-end payroll with the journal entry verified, and a real two-org dropship order (invite → listing → order → mirror → ledger) on real accounts.
