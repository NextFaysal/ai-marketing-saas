# Completion GB1 Acceptance — G1 Storefront Completion (GC1–GC5)

Date: 2026-10-15 · Branch `completion` (base: orders-next `55858ff`) · **Local commits only — NOT pushed, NOT deployed.**
Program plan: `Ecommerce-Completion-Plan-2026-10-15.md` (GB1 section). Gap audit: `Ecommerce-Gap-Audit-2026-10-15.md`.

Commits (15, oldest → newest): `80349da` shop i18n + theme lib · `cbf3899` layout favicon/header/popup/contact buttons · `787a40f` home sort + quick view · `2785c18` PDP video + zoom/lightbox · `9e790e2` branded 404 + content pages route · `365965f` dashboard settings (theme/favicon/contact/popup/pages card) · `0a55626` dashboard pages manager · `0013fda` landing drag-reorder + product video fields · `157a4bf` editor flat-block normalize + popup CTA placeholder · `2bf01dd` schema + migration · `a55cc7f` API settings/sort/video · `42bb4dc` API content pages · `6651218` API popup + contact · `1236700` **contract fix: blocks `{type, data}`** · `73ad455` GB1 API spec · this doc.

## Migration (Completion range 20261013900000+)

| Migration | Contents |
|---|---|
| `20261013910000_gb1_storefront_completion` | `StorefrontSetting` += `themeId` (default `"classic"`), `faviconUrl`, `whatsappNumber`, `messengerUrl` · `Product` += `videoUrl`, `videoPosterUrl` · new `ShopPage` (unique org+slug; index org+published), `StorePopup` (unique org), `ShopContactMessage` (index org+createdAt) — all org-Cascade |

**Deploy notes:** this migration has NOT been run on any real database. Fresh-Postgres-16 verification WAS run by the coordinator (throwaway cluster): `prisma migrate deploy` over the full sequence — **165/165 applied clean, 226 tables**; the 3 new tables and all 6 new columns verified present via information_schema.

## GC1 — Themes + favicon, delivered
- `themeId` ∈ {classic, bold, minimal} on StorefrontSetting (DTO-validated, audited settings PATCH). One token map (`apps/web/src/lib/shop-theme.ts`) drives header variant, hero classes, listing/featured grid density and card classes — NO separate page copies. **classic = today's exact class strings**, so existing shops render unchanged.
- Dashboard: theme picker with pure-CSS mock previews (header + hero + product tiles per theme) inside the existing settings card, saved through the same settings PATCH.
- `faviconUrl` (http/https-validated): the shop layout's `generateMetadata` emits `icons.icon = faviconUrl ?? org logoUrl`; when neither exists no icon link is emitted (never a broken link).

## GC2 — Content Pages, delivered
- `ShopPage` with structured blocks ONLY — `{ type, data }` everywhere (validator, seeds, storage, public payload, both web consumers). Types: heading, paragraph (plain text, React-escaped — **no raw merchant HTML anywhere**), list, faq, image, contact_info. Validator: max 40 blocks / 30 KB JSON, Bengali 400s, flat-shaped blocks rejected.
- System pages seeded idempotently on first staff list access: about, contact, faq, privacy, terms, returns, shipping — all **unpublished drafts** with honest generic Bengali template text using bracketed blanks ([দোকানের নাম] etc.). The dashboard editor shows the required amber draft banner ("⚠️ এটি একটি খসড়া টেমপ্লেট — প্রকাশের আগে নিজের ব্যবসার প্রকৃত নীতি অনুযায়ী লেখা সম্পাদনা করুন।"); system slugs are immutable and system pages cannot be deleted (unpublish instead).
- Public render at `/shop/:orgSlug/p/:pageSlug` (unpublished/missing ⇒ branded 404); menu/footer links come from published pages via the shop-home payload (failure-isolated — a pages error can never break the shop home). FAQ blocks render as an accordion mirroring the landing FAQ.
- Contact page: `contact_info` is resolved server-side from BusinessProfile (contactPhone ?? settings.supportPhone, contactEmail, address). The form POSTs to `POST /public/shop/:slug/contact` (rate-limited 5/60): creates a `ShopContactMessage` row, fans out AgentNotifications to ACTIVE OWNER/ADMIN members, and emails BusinessProfile.contactEmail via EmailProvider when set. `deliveredVia` records exactly what happened — `agent_notification`, `email`, both joined, or `stored_only` — and the shopper-facing success copy distinguishes delivered vs stored-only. The row is the record; nothing claims delivery that didn't happen.

## GC3 — Promotional Popup, delivered
- Single `StorePopup` config per org: enabled, title/body/image/CTA, trigger (delay_seconds | scroll_percent | exit_intent), frequencyDays, startsAt/endsAt schedule, showOn (home | all). The **server** decides visibility (`GET /public/shop/:slug/popup` returns null outside the window/disabled); the client additionally enforces the per-visitor frequency cookie (frequencyDays 0 ⇒ sessionStorage flag).
- Beacons: `POST /public/shop/:slug/popup-event` (rate-limited 60/60, no PII, always `{ok:true}`, failure-isolated) increments real `impressions`/`clicks` counters, displayed in the dashboard popup editor next to a static shopper-view preview. The shop component swallows every error — a popup can never break the shop.

## GC4 — Shop Engagement, delivered
- **Contact buttons:** `whatsappNumber` + `messengerUrl` settings; the shop renders a floating button stack (wa.me / merchant's m.me URL — plain outbound links, no embedded-chat claim) ONLY when set; unset ⇒ nothing renders.
- **Quick view:** listing cards gain a quick-view action (clear of the wishlist heart) opening a modal fed by the same ShopProduct payload: gallery, variant picker, quantity, and add-to-cart through the **identical server-cart path** as the PDP (fetchCart → merge → patchCartLine). Full PDP extras (Q&A, reviews, bought-together) are not duplicated into the modal; a full-details link is provided.
- **Image zoom:** PDP gallery — desktop hover magnify (transform-origin follows the pointer, hover-capable pointers only) + click-to-open lightbox (all image slides, prev/next, Escape/backdrop close).
- **Product video:** `Product.videoUrl`/`videoPosterUrl`, accepted on the staff product write path with validation (YouTube/Vimeo/.mp4/.webm, http/https only — one shared normalizer `apps/api/src/products/product-video.ts`); the PDP gallery's first slide is the video (embed iframe for YouTube/Vimeo, native `<video>` for direct files). **No uploads, no transcoding.**
- **Sorting:** listing + search accept `sort` = featured (default; unknown values fall back, never 400) | newest | price_asc | price_desc | best_selling | name_asc. best_selling reuses EC19's exact sale qualification over a 30-day window (failure-isolated aggregation; sellers first, the rest newest). The shop UI is a URL-persisted select preserving q/category.
- **Custom 404:** branded shop not-found surface (shop name/logo when fetchable, search box, home link, featured links) + a catch-all route so unknown shop subpaths land on it; product-not-found uses the same surface.

## GC5 — Section drag-ordering, delivered
- Landing sections (dashboard landings editor) and ShopPage blocks (pages manager) are now HTML5-draggable with grip handles + drag-over highlight, writing through the **existing** order mechanism (the same local state + index re-stamp + wholesale save — no API shape changed, no new endpoint). The pre-existing ↑/↓ buttons remain as fallback.

## Gates — coordinator's own final run (exit-code verified, read from logs)

| Gate | Result | Baseline |
|---|---|---|
| API jest (5 chunks, `--runInBand`, every chunk exit 0, zero FAIL lines) | **341 suites / 3511 tests PASS** (580+647+909+768+607) | 340 / 3489 → +1 suite / +22 tests = the GB1 spec exactly |
| API `tsc --noEmit` | exit 0 | — |
| Web vitest | **48 files / 343 tests PASS**, exit 0 | 341 tests → +2 |
| Web `tsc --noEmit` | exit 0 | — |
| Full build `pnpm -r build` | exit 0 (7/7 packages incl. next build) | — |
| `prisma validate` | exit 0 (with DATABASE_URL set) | — |
| Fresh-DB migration sequence | **165/165 applied clean** (164 + GB1), 226 tables, new tables/columns verified | 164 |

No flakes in the coordinator's run. Process note: a mid-batch service restart killed the coordinator's first background jest attempt; the suite was re-run in chunks in the foreground. One real integration defect was caught during the batch — the API's first block implementation used a flat `{type, text}` shape against the fixed `{type, data}` web contract; it was corrected in `1236700` (validator/seeds/specs), and the dashboard editor additionally normalizes any legacy flat block on load as a defensive measure.

## Honest limits
- **Themes are token-level**, not separate templates: header/hero/grid/card styling varies; page structure, checkout and PDP layout are shared. No per-theme custom CSS, no theme marketplace.
- **Content pages are structured blocks only** — no markdown/HTML editor, no page-level SEO fields, no page versioning. Paragraph text is plain text by design (XSS-safe by construction).
- **Popup** is a single config per org (no multiple campaigns/A-B); analytics are aggregate counters only (no per-visitor or per-page breakdown); exit-intent is inherently desktop-pointer oriented.
- **Quick view** intentionally covers the buy decision only (gallery/variant/quantity/cart) — reviews, Q&A and recommendations stay on the PDP.
- **Video** is URL-embed only; a merchant URL that doesn't match the supported shapes stores nothing playable (write-path validation rejects it).
- **best_selling sort** computes over the bounded ACTIVE scan + one 30-day orders aggregation per request (same accepted v1 cost shape as EC19's top-sellers); no materialized sales index.
- **No live proof:** no real shop, browser, or merchant was exercised; no screenshot QA of the new shop/dashboard surfaces. The migration has not run on any real DB; deploy still needs the owner's Dokploy redeploy. EC12/M30 live verification remains owed.
