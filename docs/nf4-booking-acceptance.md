# NF4 (FB2) — Service & Appointment business type: acceptance

Greenfield module: bookable services, staff (existing org
members), weekly availability, a pure slot engine, bookings with
transaction-enforced overlap refusal, manual-only deposits, a
public storefront booking page, and an hourly reminder sweep on
the existing automation rails.

## What shipped

- **Schema + migration `20261031000000_nf4_service_bookings`**
  (commit 907b7222): `ServiceOffering`, `ServiceStaff`
  (membershipId → existing `Membership`, unique per org),
  `StaffAvailability` (weekday 0=Sunday..6=Saturday JS
  convention, minutes-from-midnight org-local), `ServiceBooking`
  (status pending|confirmed|cancelled|completed|no_show;
  depositRequiredMinor + depositState
  not_required|unpaid_manual|paid_manual; reminderSentAt /
  reminderStatus). Back-relations on Organization / Membership /
  Customer. Prisma validate: OK.
- **API** (commit ce1cfb34) — `apps/api/src/booking/`:
  BookingService + tenant controller
  (`organizations/:organizationId/booking/*`, PermissionArea
  "orders", TenantGuard + RolesGuard; reads
  OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT, service/staff/
  availability writes OWNER/ADMIN, booking handling the four
  working roles) + SEPARATE public controller
  (`public/booking/:orgSlug/{services,staff,slots,book}`,
  @Public, org by slug, unknown slug 404).
  - Slot engine `computeSlots` (pure, `slots.ts`): org-timezone
    windows (Organization.timezone, default Asia/Dhaka, Intl
    only) minus non-cancelled bookings expanded by the service
    buffer on both sides; a slot must fit fully in a window.
  - Create (one shared path for dashboard + storefront) runs
    the overlap re-check + insert in a transaction: same staff,
    pending|confirmed, interval intersection → 409
    "এই সময়ে স্টাফের অন্য বুকিং আছে"; touching boundaries pass.
  - Guest → Customer: CustomersService has no create, so the
    service links/creates directly — find by (org, phone),
    else create `source: "booking"`.
  - **Deposit honesty**: quote via `fraud/deposit.depositFor`
    kind "manual" against the service price. A booking NEVER
    creates a PaymentVerification or gateway transaction;
    depositState is manual-only and every booking response
    carries a Bengali `depositLabel` stating that. Staff mark
    paid via `POST booking/bookings/:id/deposit-paid` (only from
    `unpaid_manual`, audited).
  - V1 rule (stated in the service): staff are org-level — any
    active staff can take any active service.
  - Audit: service_create/update, staff_add/active,
    availability_set, booking.create, booking.confirm/cancel/
    complete/no_show, booking.deposit_paid, booking.reminder.
- **Reminder sweep**: job type `service_booking_reminder_sweep`
  + JOB_TEMPLATES entry (Bengali, 60 min) + executeJob case +
  @Optional BookingService in AutomationService + BookingModule
  import in automation.module.ts. NOT enabled for any org by
  default. Send path = the EXISTING
  `ShopAccountService.sendShopSms` (the installments /
  order-notifications helper — tenant SMS gateway → platform
  fallback). Exactly-once: `reminderSentAt` is stamped BEFORE
  the attempt; outcomes recorded as `sent` /
  `failed_no_channel` (no SMS sender configured — the honest
  no-channel result) / `failed_error`, never silently resent.
- **Specs** (commit ae2341ad) — `booking.spec.ts`, 24 tests:
  slot math (window − booking − buffer, window-end crossing,
  empty weekday, cancelled frees), overlap refusal + touching
  boundary success through the service path, org isolation
  (public + tenant), guest→customer reuse, deposit quote
  (percent / cod-only-not-covered / none), deposit-paid guard,
  transition guards, reminder exactly-once incl. failed-channel.
- **Web** (this commit): `lib/booking.ts` + `lib/booking.test.ts`
  (12 tests: label maps, time/slot formatting, day-range,
  availability editor conversion/validation, staff grouping,
  action table). Dashboard `/dashboard/services` (offerings
  CRUD-lite + active toggle; staff add-by-membership from the
  Team members API + availability editor with start/end time
  inputs) and `/dashboard/bookings` (date picker, staff/status
  filters, grouped-by-staff list, status actions, deposit
  mark-paid, phone-booking form with live slots). Public
  `/shop/[orgSlug]/booking` (service → staff → date → slot →
  name/phone → pending confirmation + deposit note). Nav:
  "সার্ভিস" + "বুকিং" in nav.ts NAV_ITEMS and the commerce-sell
  section (layout.tsx commerce groups are built from those
  sections, so no literal layout edit was needed — same as
  live-commerce).

## Gates (this batch, serial)

- API jest booking.spec: 24/24. Automation suites (touched
  wiring): 14 suites, 83/83.
- API `tsc --noEmit`: clean.
- Web vitest booking.test 12/12; nav-commerce 6/6 (nav touched).
- Web `tsc --noEmit`: clean.
- NOT run here (coordinator): full web suite, fresh-PG, boot
  smoke.

## Honest limits / NOT built

- No live proof of anything (no DB run, no deploy, no SMS sent).
- Availability editor is single-window-per-weekday; extra
  windows on a day are counted and the editor warns that saving
  replaces them (the API itself supports multiple windows).
- No per-staff service mapping, no recurring bookings, no
  customer self-cancel/reschedule, no online deposit collection
  (deliberate — manual-only honesty above).
- The reminder sweep sends SMS only (sendShopSms); there is no
  WhatsApp reminder — WhatsApp would need a template flow that
  does not exist as a per-recipient path today.
