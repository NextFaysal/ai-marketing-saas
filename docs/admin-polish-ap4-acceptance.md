# Admin Polish AP4 — Acceptance (HTML Invoice Email)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/admin-polish-plan.md`.
This completes the Admin Polish package (AP1–AP4).

## What was built
- `EmailProvider.send` accepts an optional `html`
  part (nodemailer passes it through; the text part
  remains the fallback). Sends still count only on
  a returned message id — unchanged discipline.
- `buildInvoiceHtml` gains a `forEmail` rendering:
  inline styles for mail clients, no print button,
  a Bengali pointer to the downloadable copy. The
  web/print rendering is byte-identical to before.
- The B5 invoice email now sends that HTML built
  from the STORED payment row + org + billing
  profile — one builder, one data path, so the
  emailed numbers are the downloadable invoice's
  numbers by construction.

## Verification
- 3 new specs (B5 suite green alongside): the
  activation email carries html with the invoice
  number, exact amount, org name and BIN, inline
  styles and no print machinery, with the text
  part intact; the print rendering is unchanged;
  the provider passes html to the transport and
  still refuses to count a send without a
  message id.
- **Live proof**: a local SMTP sink received a real
  message from the real EmailProvider carrying the
  real builder's output — multipart text + HTML,
  invoice number and BDT 1,500.00 in the HTML, no
  print button. (A positive send through the
  owner's real SMTP remains an M30 item, as with
  every email path in this codebase.)
- Package totals at close: API 1331 tests with the
  only failures being the M38 harness (fixed in
  the AP2 follow-up commit — its fakes predated
  the session registry); web + admin builds green.

## Package close-out (AP1–AP4)
TOTP enrolment shows a scannable QR on both the
admin and tenant surfaces (AP1); view-as sessions
live in a server-side registry and die the moment
they are revoked (AP2); admin API keys carry
enforced area scopes with a documented legacy rule
(AP3); invoice emails render the real invoice as
HTML (AP4). All four Admin Master Plan residuals
are closed.
