# GB8 Acceptance — G8 Reports & Finance Completion (GC19 + GC20)

Status: **CODE-COMPLETE** — local commits only on branch `completion`; **NOT pushed**.

Migration: `20261013980000_gb8_finance` — verified in the full fresh-PostgreSQL sequence in the build sandbox; **NOT run on any real DB**. Required at deploy. The `scheduled_report_sweep` job requires per-org enablement before scheduled reports run automatically.

## GC19 — Reports completion

### Five reports

API base: `GET /organizations/:organizationId/finance/reports/:type`, with `GET .../reports/:type/export?format=csv|xlsx`. All ranges are Dhaka calendar days, default last 30 days, maximum 366 days. Counted orders exclude practice orders and cancelled/failed/refunded orders unless a report definition says otherwise. Exports are built from the same payload as the JSON view through one sections exporter: stacked sections for CSV and one worksheet per section for XLSX (exceljs).

| Report | Exact source definition |
|---|---|
| Discounts | Two distinct layers. Order-level: Σ `Order.discountMinor` for counted orders in the period, per Dhaka day and in total. Stamp layer: entries in `Order.appliedDiscounts` grouped by coupon code / promotion / referral; coupon and referral applications are distinct orders, promotion applications are stamped entries. Coverage returns stamped orders vs all orders in period. The stamp layer exists only after GB7 stamping began; it is not merged into a fake complete history. |
| Refunds | `ReturnRequest` rows judged by `createdAt`: counts by status; completed rows grouped by recorded `resolution`; amounts are Σ recorded `refundAmountMinor` only, with `amountsKnown`. Completed refund-resolution rows are full when recorded amount ≥ the order's `totalMinor`, partial when below, unknown when no amount is recorded. A separate order-level lens returns orders touched in period (`updatedAt`) with cumulative `Order.refundedMinor > 0`; it overlaps return-recorded refunds and must not be added to them. |
| Payment-wise sales | Counted orders grouped by `Order.paymentMethod`; blank method falls back to `cod` only when `isCod`, otherwise `unknown` (“অন্যান্য/অজানা”). Separately, `TenantPaymentTransaction` rows with status `verified_paid`, judged by `updatedAt`, are grouped by provider × source. These are distinct questions and are never blended. |
| Category-wise sales | Sold-bucket orders only, using the ON7/EC33 predicate mirror. Items join to the product's CURRENT category: `Product.categoryId → Category.name`, else legacy `Product.category`, else `শ্রেণিবিহীন` (including items with no linked product). Revenue = Σ `OrderItem.totalMinor`; quantity and distinct order count are returned. Caveat: recategorizing a product moves its historical sales to the current category because no order-time category snapshot exists. |
| Shipping cost | All non-practice orders in period. Charged = Σ `Order.shippingMinor`, attributed to the provider of the order's earliest shipment; orders with no shipment use an explicit `unshipped` bucket. Actual uses ON7/GB5 precedence per shipment: `ReconciliationLine.sheetChargeMinor` for matched/amount_mismatch/already_collected lines first, else `CourierShipment.chargeMinor`. A provider actual is null when none of its shipments has an actual. Coverage = orders with any actual ÷ orders with any shipment, plus counts. |

The GB4 gateway fee report and settlements were **not rebuilt**. The reports hub links to their existing accounting-page home and existing endpoints.

### Reports hub

New web routes:

- `/dashboard/commerce/reports` — index cards for the five reports, Promotions report, gateway fee report + settlements, ON7 profit, ON9 analytics, and Finance. It is an index, not a re-render of those existing reports.
- `/dashboard/commerce/reports/[type]` — range picker, table, coverage/definition copy, CSV/XLSX downloads.
- Commerce navigation links Reports and Finance from both the Commerce home and Accounting page.

### Scheduled reports

Models: `ScheduledReport` and `ScheduledReportRun` in migration `20261013980000_gb8_finance`.

- Types: the five GC19 reports plus `profit`.
- Cadence: `daily` (yesterday, Dhaka) or `weekly` (the seven Dhaka days ending yesterday).
- Format: `csv` or `xlsx`.
- Recipients: validated, trimmed, lower-cased, de-duplicated email list, 1–10 recipients.
- Runs record `periodLabel`, `testRun`, status `sent | failed_no_provider | failed_error`, and per-recipient detail.
- Staff CRUD and “এখনই পাঠান” are OWNER/ADMIN-only and audited. Test sends do **not** stamp `lastRunAt`.
- Scheduled runs stamp `lastRunAt` before generation/delivery. This is the exactly-once stance: a process crash mid-run can lose that period's send rather than duplicate it; the missing send is visible because no run row is created for that period.
- Due rule: daily when the Dhaka date of `lastRunAt` is before today or never run; weekly when `lastRunAt` is at least seven days old or never run.
- Job wiring: `scheduled_report_sweep` added to job types, templates, AutomationModule, and `executeJob`. It is per-org like the other sweeps.

#### EmailProvider attachment verdict

Before GB8, `EmailProvider.send()` and `sendTenant()` exposed **no attachments parameter**, although the underlying nodemailer transport supports attachments. GB8 adds an optional `attachments` pass-through to both methods. Behaviour without attachments is unchanged and spec-pinned. Scheduled reports therefore deliver a real generated CSV/XLSX as an email attachment. A run is `sent` only when at least one recipient send returns a provider message id. If email is not configured, the run is `failed_no_provider`, nothing is sent, and no attachment/delivery is claimed. No general file-store promise is made.

## GC20 — Finance completion

### Expenses

Model `Expense`: organization, fixed category vocabulary (`rent|salary|marketing|packaging|delivery|utilities|inventory_purchase|other`), `amountMinor` BigInt paisa, `spentAt`, optional note, optional payment method (`cash|bank|bkash|other`), optional validated http(s) `receiptUrl`, `createdById`, timestamps.

- API: list with optional range/pagination, create, update, delete, and `GET /finance/expenses/summary?month=YYYY-MM`.
- `spentAt` input is `YYYY-MM-DD`, stored as the Dhaka-midnight instant and returned as a Dhaka date.
- Writes are OWNER/ADMIN-only and audited (`finance.expense_*`).
- Monthly summary groups by the Dhaka month of `spentAt` and returns total, count, and per-category totals.
- The receipt URL is only a link; GB8 does not host receipt files.

### Ledger views

API: `GET /organizations/:organizationId/finance/ledgers/:kind`. Web: `/dashboard/commerce/finance`.

| Ledger | Definition and source |
|---|---|
| Sales | Sold-bucket orders in range, paginated. Columns include date, number, customer, status, total, discount, delivery, tax, paid and due. Paid = Σ approved `PaymentVerification` amounts capped at order total for display. Due = `total − refunded − approved advances`, floored at zero. Period totals cover the whole filtered set, not just the page. |
| COD receivable | Outstanding is a current snapshot, not a historical range view: sold COD orders with due > 0, oldest first, max 200 rows with `truncated`, and age buckets 0–7 / 8–30 / 31+ days. Collections are `CourierShipment` rows with `codCollectedAt` in range; amount is recorded `codCollectedMinor`, courier is the shipment provider. |
| Gateway settlements | Existing GB4 `payment-settlements`/`payment-fee-report` endpoints are surfaced/linked. GB8 does not recompute them in a second implementation. |
| Courier settlements | `ReconciliationImport` rows in range, provider via `courierIntegrationId → Integration.provider`; row/matched/mismatch counts come from the import, matched amount is Σ sheet amounts of matched lines, mismatch delta is Σ (`sheetAmountMinor − expectedMinor`) over amount_mismatch lines. The mismatches ledger lists those lines with import/provider/row/tracking/order/shipment refs and signed delta. |
| Refunds | Completed `ReturnRequest` rows judged by `updatedAt`, using the same loader and partial/full derivation as GC19's refunds report. Amount total includes only known refund-resolution amounts. |

### Settlement mismatch alert (GC20.3)

At the end of `ReconciliationService.importSheet`, after counts are persisted:

- It acts only when the import has `amount_mismatch` lines.
- It claims `ReconciliationImport.mismatchAlertedAt` with a conditional update before notifying, giving exactly one alert opportunity per import row.
- It creates one GB6 `createAgentNotification` per ACTIVE OWNER/ADMIN membership, type/category `billing`, containing count, signed total delta, provider, and the Finance path in the body (AgentNotification has no link column).
- The whole hook is failure-isolated: alert failures cannot fail the import.
- A new import row for the same courier file is a distinct import and may alert again; the same import row cannot alert twice.

Spec coverage calls the private hook directly with a fake Prisma and proves recipient scoping, the stamp, and no second notification. It does not claim a live SMTP or production import proof.

### Net profit extension (GC20.4)

`OrderProfitService.getProfitReport` now has an additive optional `finance` object, also reflected in the profit CSV and scheduled profit report:

- `periodExpensesMinor`: Σ `Expense.amountMinor` with `spentAt` in the report range; always a string, including `"0"`.
- `gatewayFeesMinor`: Σ known `feeMinor` over `verified_paid` `TenantPaymentTransaction` rows judged by `updatedAt`; `"0"` if no verified transactions, otherwise null if any verified transaction lacks a fee.
- `estimatedNetMinor`: present only when gross margin is non-null, `costCoveragePercent === 100`, expenses were read, and fees are known. Value = gross margin − expenses − fees.
- `reasons[]`: states the failed conditions when estimated net is null, including expense-read failure, unknown gateway fee, or incomplete product-cost coverage.

The UI label is **আনুমানিক নিট লাভ**. The accounting page renders it only beside its caveats; when null, it shows expenses/fees and the reasons rather than a bare invented number.

### Generic double-entry export (GC20.5)

API: `GET /organizations/:organizationId/finance/gl-export?from&to&format=csv|xlsx`.

Columns: `date, account, debit_minor, credit_minor, memo`. Amounts are integer paisa/minor units. The export is labelled:

> সাধারণ ডাবল-এন্ট্রি CSV — Tally/QuickBooks-এ import-এর আগে আপনার হিসাবরক্ষকের সঙ্গে মিলিয়ে নিন

This is a generic double-entry table, **not** a native Tally or QuickBooks file.

#### Fixed GL mapping

Per sold order (effective date in range):

| Leg | Debit | Credit | Amount |
|---|---|---|---|
| Sale | Payment-reality account | `Sales` | Debit `totalMinor`; credit `subtotalMinor` |
| Discount | `Discounts` | — | `discountMinor`, only if > 0 |
| Delivery income | — | `Delivery Income` | `shippingMinor`, only if > 0 |
| Tax | — | `Tax Payable` | `taxMinor`, only if > 0 |
| Remainder | `Other Adjustments` if negative | `Other Income` if positive | `total − subtotal + discount − shipping − tax` (typically gift wrap/adjustments) |

Payment-reality account: `Gateway Clearing` if a verified_paid transaction exists for the order; else `COD Receivable` if `isCod`; else `Cash` if approved advances > 0; else `Receivable`.

Other rows:

- Gateway fees: for verified transactions in range with known positive `feeMinor`, debit `Gateway Fees`, credit `Gateway Clearing`.
- Expenses: debit `Expense: <category>`, credit `Cash`.
- Refunds: for completed refund-resolution return requests judged by `updatedAt` with a recorded amount, debit `Refunds`, credit the order's payment-reality account (`Gateway Clearing`, `COD Receivable`, or `Cash`). Refund requests with no recorded amount are skipped and counted in the export notes.

The GB8 spec asserts total debits equal total credits on the fixture set.

## Gates (coordinator-run, exit-code checked)

| Gate | Result |
|---|---|
| API jest (chunked by directory; one monolithic chunk was OOM-killed at exit 137 after 51 suites passed with 0 failures, then re-run split) | **363 suites / 3,848 tests — ALL PASS** (baseline 361/3,824 → +2 suites/+24 GB8 tests). Chunks: 66/589, 78/775, 106/1,180, 27/423, 25/189, 3/41 (purchasing), 58/651 |
| API tsc (`tsc --noEmit`) | exit 0 |
| Web vitest | **55 files / 419 tests — ALL PASS** (baseline 407 → +12 finance-gb8 lib tests) |
| Web tsc (`tsc --noEmit`) | exit 0 |
| Full build (`pnpm -r build`, incl. `next build` for web + admin) | exit 0 — 7/7 workspace projects Done; API package build re-run exit 0 after a late fix |
| Prisma validate | exit 0 |
| Fresh-DB full sequence (PostgreSQL 16, throwaway cluster) | **172/172 migrations applied clean**, 244 public tables; `Expense`, `ScheduledReport`, `ScheduledReportRun` tables and `ReconciliationImport.mismatchAlertedAt` present |
| Migration↔schema drift for GB8 objects | zero (a global `migrate diff` shows only pre-existing, unrelated artifacts from older hand-written migrations) |
| Runtime boot smoke | compiled API started against the fresh DB — `FinanceModule dependencies initialized`; finance routes (reports / expenses / gl-export) answer **401** unauthenticated, not 404 |

One real-schema defect was caught and fixed during the build: the sales/COD ledgers initially read a non-existent `Order.customerName` scalar — customer names now come from the Customer relation (firstName + lastName, the EC23 composition), spec-pinned. A second near-miss was caught in design: `Order` has no `shipments`/`paymentVerifications` relations, so all finance reads load those tables flat (the ON7/EC23 pattern).

## Honest limits

- Reports and ledgers are Prisma in-memory aggregations with explicit caps (normally 5,001 primary rows and 20,001 related shipment/line rows) and truncation/coverage signals where applicable. They mirror the EC23/ON7 pattern; they are not yet SQL-scale reporting for very large organizations.
- Discount history has two eras: complete order-level totals and GB7-onward stamp detail. GB8 states the coverage rather than fabricating pre-stamp source history.
- Refund reporting uses recorded return/refund fields only. A store refund push success is not stored as a separate field on `ReturnRequest`, so GB8 does not claim a pushed-vs-record-only split that the source cannot prove.
- Category history follows the product's current category. There is no category snapshot on order items.
- Shipping actuals exist only when a reconciliation sheet line or a provider booking charge exists. Missing actual remains null and coverage is stated; no zero is invented.
- Gateway settlements are an existing GB4 source. They are records-based expectations from the app's own payment transactions, not a provider settlement statement.
- COD outstanding is a current snapshot. Collections depend on EC26 stamps/imports; a delivered status alone is not treated as cash collected.
- Scheduled email uses the platform EmailProvider (owner-digest precedent), not tenant SMTP. Attachments were added as an optional provider capability; no live SMTP delivery is proven by unit specs.
- `lastRunAt` is stamped before delivery for scheduled runs. A hard process crash can lose a period rather than duplicate it; test sends do not stamp.
- The mismatch hook fires only when `importSheet` completes after GB8 is deployed. Existing imports are not retro-alerted and their `mismatchAlertedAt` remains null.
- GL export is a fixed, documented generic mapping. It is not a native Tally/QuickBooks format and does not replace an accountant's chart-of-accounts mapping.
- No migration in this batch has run on the real database, no job has been enabled in production, and no live email/courier/gateway proof is claimed.
