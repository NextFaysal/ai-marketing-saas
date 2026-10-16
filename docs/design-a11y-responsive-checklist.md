# EB6 Post-Deploy Checklist — Responsive + Accessibility (ED15/ED16)

Runs ONLY after the design line is deployed (owner's push instruction +
Dokploy Redeploy). Every box is executed on the LIVE build with a real
device or browser device-emulation + a screen reader where marked.
All boxes start UNCHECKED. Code-level proof lives in
`docs/design-eb6-acceptance.md`; this checklist is the on-device proof
EB6 deliberately does not claim.

## A. Responsive — no horizontal page scroll at 360px (Android phone or emulation, portrait)

- [ ] Commerce hub (/dashboard/commerce) — both tables render as cards; page does not scroll sideways
- [ ] Finance (commerce/finance) — all 9 ledgers render as cards; totals card readable
- [ ] Accounting (commerce/accounting) — COD board + profit table as cards
- [ ] Reports (commerce/reports/<type>) — each report type as cards
- [ ] Reconciliation (commerce + orders) — batch/missing-parcel cards; tab strip scrolls internally only
- [ ] Warehouse — assignments / count lines / balances / by-location / transfers as cards
- [ ] Inventory intelligence — all 7 tables as cards
- [ ] Dispatch — escalations / manifest / RTO as cards
- [ ] Purchasing — suppliers / PO list / PO detail (receive inputs usable in card) 
- [ ] Subscriptions, Installments — cards show every column incl. overdue state
- [ ] Sync — listings / outbox / conflicts; conflict resolve panel works inside a card
- [ ] Feeds — preview items as cards
- [ ] Abandoned / Affiliates / Bundles / Discounts / Gift cards — cards complete; gift-card row tap still opens detail
- [ ] Landings — list + A/B stats as cards; copy/open actions work
- [ ] Promotions — main + both report tables as cards
- [ ] Quotes — detail lines as cards; line add/delete work
- [ ] Customers — khata / loyalty / price-list / per-courier as cards
- [ ] Orders — courier-performance table as cards; main list cards unchanged
- [ ] Orders analytics (on9) + team (on12) — cards complete
- [ ] NDR — tab strip scrolls internally; incident cards render
- [ ] Order drawer / action panel — installment card collect form submits like the desktop cell
- [ ] Every converted card shows the SAME fields as the desktop table (spot-check 5 pages field by field)
- [ ] Desktop ≥1024px: every converted page's table is pixel-equivalent to pre-EB6 (columns, order, totals)

## B. Touch targets (device)

- [ ] Row-action buttons in converted tables are comfortably tappable (≥44px) on a phone — spot-check warehouse, orders-reconciliation, finance expenses
- [ ] Filter/tab chips on converted pages ≥44px tall — spot-check quotes, reconciliation, storefront settings sub-nav
- [ ] Mobile bottom nav: POS shortcut present and tappable; all 6 slots reachable by thumb
- [ ] POS (tablet + phone): sticky pay bar + search still behave as EB5 left them (regression spot-check)

## C. Keyboard + focus (desktop browser)

- [ ] First Tab press on any dashboard page lands on the "মূল কন্টেন্টে যান" skip link; Enter jumps focus into main content
- [ ] First Tab press on a shop page (bn and en shop) lands on the skip link; Enter jumps to shop main
- [ ] Open a kit Modal (e.g. products dialogs): focus starts inside the dialog
- [ ] Tab repeatedly inside the Modal: focus cycles, never escapes to the page behind
- [ ] Shift+Tab from the first control wraps to the last control
- [ ] Escape closes the Modal and focus returns to the button that opened it
- [ ] Same trap cycle verified in a kit Drawer and in a Confirm dialog (danger action)
- [ ] Prompt dialog: focus starts in the input (autoFocus not stolen by the trap)
- [ ] Dashboard mobile drawer (narrow viewport): Escape closes it
- [ ] Shop listing filter drawer + shop drawers: Escape closes (kit Drawer inheritance)

## D. Screen reader + language (NVDA/VoiceOver/TalkBack)

- [ ] Dashboard page is announced/read with Bengali pronunciation (subtree lang="bn")
- [ ] A bn shop reads as Bengali; an en shop reads as English (shop root lang follows org locale)
- [ ] Skip link is announced as the first element on dashboard + shop pages
- [ ] Icon-only buttons converted in EB6 announce their Bengali labels (spot-check: orders view-delete ✕, reconciliation modal close, drawer close)
- [ ] Orders/products/POS search fields announce their labels (not placeholder-only)

## E. Contrast (visual spot-check)

- [ ] Meta text under values (dates, SKUs, hints) on converted pages is comfortably readable outdoors/at low brightness — spot-check finance, warehouse, customers
- [ ] Kit hints (KpiCard/StatChip/form hints) read clearly on the hub + products form

## F. Known residuals to re-check after deploy (from the EB6 acceptance)

- [ ] NDR mobile cards: confirm the 5 desktop-only fields (createdAt, customerFeedback, notes, rescheduleDate, lastContactedAt) are acceptable missing on mobile, or schedule the parity fix
- [ ] Nested kit dialogs (Confirm over a page Modal): confirm Escape behaviour in real use; stacking manager is a future item if it bites
