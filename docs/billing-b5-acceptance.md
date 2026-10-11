# Billing Package B5 — Acceptance (Billing Contacts + Invoice Delivery)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11),
except the positive email send itself (no SMTP server exists
in the sandbox — see Verification). Plan:
`docs/billing-package-plan.md`. Schema **110**
(migration `20261010810000_b5_billing_contacts`).

## What was built
- **Billing contacts on the Business Profile**:
  `billingEmails` (max 3, validated, lowercased, deduped —
  an empty list clears), `billingAddress`, `billingBin`,
  edited from a new "বিলিং তথ্য" card on the Billing page.
  B1's reminders already read billingEmails, so they pick
  the recipients up automatically.
- **Invoice buyer block**: the printable invoice (tenant
  AND admin render paths) now prints the org's billing
  address + BIN under "Billed to", HTML-escaped.
- **Automatic invoice email**: every confirmed activation
  emails the invoice (text form of the same content) to
  OWNER/ADMIN members + the billing recipients, via an
  optional EmailProvider on PaymentsService. The send is
  audited (`billing.invoice_emailed` with the recipient
  count) ONLY when at least one email actually went out;
  a failing provider never affects the payment and is
  never claimed. The admin's manual invoice email also
  includes the billing recipients now.

## Verification
- API jest: full suite green (4 new B5: activation emails
  owner + billing inbox with the right invoice number and
  amount, audited with recipients=2; a throwing provider
  leaves the activation successful with NO invoice_emailed
  audit; the invoice HTML prints the buyer block escaped;
  profile validation — >3 rejected, bad email rejected,
  list normalized + deduped).
- Full build green; API boots with the new
  PaymentsModule → MessagingModule wiring.
- **Live proof** (T1 Shop): PATCH business-profile saved
  the contacts (3 inputs → 2 unique normalized emails,
  Bengali address, BIN) and a bad email was refused with
  a Bengali 400. A payment recorded via the real Admin
  API rendered a tenant invoice containing the address,
  the BIN and the exact amount.

## Not live-proven
- The positive email delivery itself: the sandbox has no
  SMTP server to receive it (the platform SMTP config is
  unset and no local sink exists). The send path is
  unit-proven with a fake provider and mirrors M39's
  admin invoice email, which uses the same provider.
