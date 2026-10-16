# Shop Design v2 — Screenshot QA Checklist (EB3 / ED7–ED9)

Execution: AFTER deploy, on a real shop — once with themeId classic
(control: everything must look exactly as before EB3) and once with
a test shop switched to v2 (plus ?themePreview=v2 spot-checks on
the classic shop). Devices: 360px Android, 390px iPhone, 768px
tablet, 1440px desktop. ALL boxes unchecked — nothing here is
verified until a human/agent with a browser ticks it post-deploy.

## Control — legacy themes unchanged (classic shop)
- [ ] Home renders identically to pre-EB3 screenshots (hero, chips, grids, cards)
- [ ] PDP renders identically (gallery, buy box, rails)
- [ ] Cart + checkout render identically; place-order works end to end
- [ ] Header: same single-row layout as before (no hamburger, no bottom nav)
- [ ] Footer identical (links, COD note, bKash/Nagad, support, return policy)
- [ ] Bold + minimal shops spot-checked unchanged
- [ ] Overlays still trigger with their old frequency rules (popup, social proof, push, install)

## ED7 — v2 chrome
- [ ] v2 header is slim/sticky; logo + shop name not overflowing at 360px
- [ ] Header search icon opens the search row; submitting searches (lands on home with ?q= results)
- [ ] Bottom-nav খুঁজুন scrolls to top and opens the header search
- [ ] Hamburger (< lg) opens the drawer with home/blog/merchant pages/account/wishlist; tapping a link navigates + closes
- [ ] Desktop (≥ lg): inline nav links + icon buttons; no hamburger, no bottom bar
- [ ] All header icon buttons are easy to tap (≥44px) — wishlist/cart badges show correct counts
- [ ] Mobile bottom nav: হোম/খুঁজুন/কার্ট/অ্যাকাউন্ট labels + icons; cart badge correct; active tab highlighted
- [ ] Bottom nav hides on scroll down, reappears on scroll up, visible at page top
- [ ] Bottom nav never covers footer content (bottom padding present) at 360px
- [ ] Merchant brand colour drives v2 surfaces (header accents, CTAs, bottom-nav active state)
- [ ] Footer v2: same content blocks as classic, token styling, no missing links
- [ ] Theme picker (dashboard storefront settings): v2 option visible with mock preview; selecting + saving applies v2
- [ ] ?themePreview=v2 on a classic shop shows v2 without saving; removing the param returns to classic
- [ ] Preview link in settings opens the merchant's own shop with ?themePreview=v2 in a new tab

## ED8 — PDP + listing v2
- [ ] ProductCard v2: image, badges in one row, brand-coloured price, quick view + wishlist hit areas easy to tap
- [ ] Legacy cards on classic/bold/minimal unchanged
- [ ] PDP sticky buy bar appears on mobile when the main buy box scrolls out; price matches selected variant
- [ ] Buy bar কার্টে যোগ adds to cart (header badge increments); এখনই কিনুন follows the same path as the main buy button
- [ ] Buy bar hidden/disabled correctly when out of stock
- [ ] While the buy bar is visible, the bottom nav is NOT visible (buy bar owns the bottom)
- [ ] PDP info panel v2: price block, stock badge, trust rows (delivery/return/support) with icons, no content lost
- [ ] Related + bought-together rails use v2 cards on a v2 shop
- [ ] Listing filter drawer (mobile v2): ফিল্টার button shows active-filter count; drawer lists category/brand/sort links; tapping one applies it (URL params change, results update)
- [ ] Desktop listing: chips + sort select unchanged

## ED9 — overlays, cart drawer, checkout v2
- [ ] Only ONE bottom-corner overlay visible at a time (trigger popup + install + push + social proof in one session and observe the queue order: popup → install → push → social proof)
- [ ] Dismissing the active overlay reveals the next queued one
- [ ] Contact buttons never overlap the active overlay; they shift up above it and return after dismissal
- [ ] On PDP (v2), bottom overlays sit above the buy bar, not covering it
- [ ] On v2 mobile, bottom overlays sit above the bottom nav
- [ ] Overlay visuals themselves unchanged vs pre-EB3
- [ ] Cart drawer (v2 header): opens from the header cart button; line items, qty steppers and remove work; subtotal updates; badge stays in sync
- [ ] Cart drawer checkout CTA reaches checkout; full cart page still works unchanged
- [ ] Checkout v2: three step groups visible (তথ্য → ডেলিভারি → পেমেন্ট), no field moved or lost vs classic checkout
- [ ] Checkout sticky bar (mobile v2): total matches the summary; place-order button submits via the same flow (order lands, idempotency intact)
- [ ] Inline field errors appear under fields where validation exists; top banner still appears as fallback
- [ ] Express checkout sheet opens and completes as before (visual polish only)
- [ ] Single-product checkout + landing CTAs show the merchant brand colour (only where EB3 item 4 found payload data — see acceptance for the verdict per surface)

## Cross-cutting
- [ ] No horizontal scroll at 360px on home/PDP/cart/checkout (v2)
- [ ] ISR: a price edit appears on the storefront within ~60s on v2 pages, same as classic
- [ ] prefers-reduced-motion: animations collapse as before
- [ ] Keyboard: drawer + cart drawer trap/return focus acceptably; Esc closes
