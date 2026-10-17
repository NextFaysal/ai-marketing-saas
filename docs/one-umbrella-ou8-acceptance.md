# OU8 — Storefront Freedom: Acceptance (One-Umbrella)

- Branch: `one-umbrella` · Base HEAD: `708d5ba8` (OU7 complete) · Final HEAD: see git log (this doc committed last)
- Migration claim: **`20261023100000_ou8_storefront_freedom`** (OU7 claimed 20261023000000; OU8 claims from 20261023100000 per dispatch)
- Local commits only — NO GitHub push (owner-only trigger, as always).

## Step-0 audit (verified in this tree at base)

1. **Theme system** — `apps/web/src/lib/shop-theme.ts`: 4 presets (`classic` legacy-pinned, `bold`, `minimal`, token-native `v2` from ED7). Themes are `ShopTheme` class-string records consumed via `themeOf/effectiveThemeId` (with `?themePreview=` support). `ProductCard` detects token themes by presence of the optional `cardBodyClass/cardPriceClass/sectionTitleClass` fields. Existing shop home (`apps/web/src/app/shop/[orgSlug]/page.tsx`) rendered sections in a FIXED order: hero (with search), categories, brands, bundles, flash, featured, recently-viewed, product grid. **Bug found:** the settings DTO (`UpdateStorefrontSettingsDto.themeId`) only allowed `classic|bold|minimal` — `v2` could be previewed but not saved as a theme through the DTO (class-validator would 400). Fixed in OU8 (v2 + the two new ids added).
2. **StorefrontSetting** — already had `showFeatured/showCategories/showSearch` booleans + `customCss/customJs(+Enabled)`, `themeId`, scheduling-free simple fields; settings flow = DTO → `StorefrontService.updateSettings` generic copy loop + `serializeSetting` → dashboard PATCH; shop reads via `shopHome()` settings payload. No section-order or hero/brands/bundles/flash/recently toggles existed.
3. **ED shop v2 structure** — shop pages consume theme tokens from `themeOf(effThemeId)`; layout sets `--brand` from org primaryColor; token-native themes resolve colours through EB1 CSS variables. New themes therefore had to be token-native records in the same `SHOP_THEMES` map to render the FULL shop (header dark flag, hero, grids, cards) — no separate template system exists.
4. **Popups — the task brief says "the social-proof popup is the only popup"; the tree actually has TWO:** (a) **StorePopup (GB1/GC3)** — the merchant promotional popup: one row/org, `title/body/imageUrl/ctaText/ctaUrl`, triggers `delay_seconds|scroll_percent|exit_intent`, `frequencyDays` cookie/session cap, `showOn home|all`, schedule window, and REAL `impressions/clicks` counters incremented only by the public `popup-event` route; rendered by `ShopPopup.tsx` via `ShopDeferredOverlays` in the shop layout. (b) **SocialProofSetting (AB7/AX17)** — a separate feed of anonymized REAL recent orders rotating bottom-left with its own `maxPerSession` + sessionStorage shown-count and a single impression counter. OU8 extends (a) — it is the merchant popup machinery; (b) was not touched.
5. **Support tickets** — `SupportTicket`/`SupportTicketMessage` are the PLATFORM support system: a TENANT org's staff (`createdById` = tenant user) ↔ platform SUPER/SUPPORT admins. Statuses in service: `open|pending|in_progress|resolved|closed`. The internal/public distinction EXISTS and is enforced: `SupportTicketMessage.isInternal` (admin internal notes via `addInternalNote`), tenant reads filter `isInternal:false`, the SSE stream drops internal events for non-admins. **There is NO shop-customer ticket system and NO inbox→ticket conversion in this tree** — searched inbox/conversations; tickets are created only via the tenant dashboard (`TenantSupportController`). `authorKind` vocabulary: `tenant|admin|system|ai`.
6. **Signed-token public page pattern** — MS2 (`apps/api/src/messaging/unsubscribe-token.ts`, also `open-token.ts`, `link-tracking.ts`): HMAC-SHA256 over base64url JSON payload, secret = `JWT_SECRET`, `timingSafeEqual` verify, `purpose` field scopes the token, `exp` checked on verify; the token is the only credential on `@Public()` routes. OU8's ticket token reuses this pattern verbatim in shape (`support/ticket-tracking-token.ts`, purpose `ticket-track`, 90-day expiry).
7. **Lead machinery** — the CRM `Lead` table + `LeadsService.create` is THE lead store: vocabulary `source ∈ manual|whatsapp|messenger|woocommerce|website` (+ ingested `webchat/facebook_lead_ads/...`), `stage=new` default, creation writes a `LeadActivity(type:"created")`. Shop contact forms today create `ShopContactMessage` rows (NOT Leads); Meta LeadForms are a different model (form definitions). A shop-originated lead honestly uses `source:"website"`.

## Item 1 — Theme gallery + section customizer: SHIPPED

- **Two new honest preset themes** in `shop-theme.ts`, both token-native like v2 (full `ShopTheme` records — hero/grid/featured-grid/card/card-body/price/section-title + `headerDark`):
  - **`warm`** — amber-tinted surfaces, `2rem` hero radius, roomier grid gaps, light header.
  - **`ocean`** — deep-teal dark header + dark hero, tighter 3-col desktop grid, cyan price accent.
  They render the full shop through the exact same consumers as v2 (page, ProductCard, layout, social proof dark-mode flag). Gallery: dashboard storefront page gains both options with mini previews (`THEME_OPTIONS`/`ThemePreview`). API DTO now accepts `classic|bold|minimal|v2|warm|ocean` (v2 save bug fixed, see Step-0.1). Proof: `shop-sections.test.ts` asserts both ids resolve via `themeOf/themeIdOf/effectiveThemeId`, hero classes are unique across all 6 presets, and the token fields exist; existing `shop-theme.test.ts` byte-pins for the 4 old presets still pass unchanged.
- **Section customizer** — `StorefrontSetting` gains `showHero/showBrands/showBundles/showFlashSale/showRecentlyViewed` (all default ON) + `sectionOrder Json?` (migration 20261023100000). The two pre-existing toggles for categories/featured (and hero-embedded search) are reused, not duplicated. The shop home page was refactored: the seven sections are collected into a keyed `sectionNodes` record and rendered EXACTLY as `orderedVisibleSections(settings.sectionOrder, sectionVisibilityOf(settings))` from new `lib/shop-sections.ts` returns — that pure function is the render list, so a hidden section cannot render and order is honoured by construction. Server side validates order entries strictly (unknown key → Bengali 400) and stores them sanitized/deduped (`storefront/shop-sections.ts`). Dashboard: an OU8 "হোমপেজের সেকশন সাজান" editor lists the 7 sections in current order with per-section show/hide checkboxes (wired to the same state the old featured/categories toggles used) and ↑/↓ reorder buttons. **The product grid is deliberately NOT toggleable/reorderable** — it is the shop itself; documented in UI copy and here.
  - Proof: web `shop-sections.test.ts` (4 tests: defaults, hide-removes-from-render-list, reorder + unknown/dup collapse); API `ou8-storefront.spec.ts` (settings round-trip stores toggles + sanitized order, unknown key refused, themes accepted). Render-level proof is by construction + helper tests; no screenshot QA was run (see live checklist).

## Item 2 — Marketing popup builder (lead capture): SHIPPED

- StorePopup gains `mode: promo|lead` (default `promo` — **the pre-OU8 promo behaviour is byte-identical when mode is promo**), `captureName/capturePhone/captureEmail` flags, `successMessage`, and `captures` counter (same migration). Merchant UI: popup card gains a ধরন (kind) selector; lead mode shows capture-flag checkboxes + success-message field + honest copy that CTA URL is unused in lead mode; the status line shows `লিড সংগ্রহ: N` only in lead mode. A lead popup capturing NOTHING is refused at save (API spec-proven) — a form that collects nothing is a fake feature.
- Shop render: `ShopPopup.tsx` renders a real form (only the enabled fields, all required) when `mode==="lead"`, reusing the existing trigger/frequency/showOn/schedule machinery unchanged; success UI appears only after a real 2xx from the new endpoint; merchant `successMessage` overrides the i18n default (bn/en strings added to `shop-i18n`).
- Submissions: `POST /public/shop/:orgSlug/popup-lead` → `submitPopupLead` creates a REAL `Lead` row (org-scoped, `source:"website"`, `stage:"new"`, note marks the popup origin) + its `created` LeadActivity, then increments `captures`. Required-field enforcement follows the capture flags server-side. Promo-mode or disabled/scheduled-out popups refuse submissions (spec-proven). When name capture is off, `Lead.name` (non-nullable) is filled from phone/email — recorded here honestly.
- **Analytics honesty:** `captures` counts ONLY real Lead creations (incremented in the same call, after the create). `impressions/clicks` keep their pre-existing meaning (real popup-event posts). No new "shown" number was invented.

## Item 3 — Customer ticket tracking page: SHIPPED (population recorded honestly)

- **Served population:** the only tickets in this tree are platform `SupportTicket`s created by tenant-org staff from the dashboard Support page (Step-0.5). The "customer" of the tracking page is that ticket's creator side (the tenant) — there is no shop-customer ticket population to serve, and none was invented.
- **Token:** `support/ticket-tracking-token.ts` — MS2-pattern HMAC token, purpose `ticket-track`, payload `{ticketId, orgId, exp}`, 90 days.
- **Issuance (how the link reaches the customer):** a tenant-authenticated `GET /organizations/:orgId/tickets/:ticketId/tracking-link` returns `{token, path}`; the dashboard Support ticket header gains a "🔗 ট্র্যাকিং লিংক কপি" button that fetches it, copies the full URL, and displays it. The tenant can then send that link over whatever channel they already use with the platform team. **No new notification channel was invented:** ticket creation today sends NO notification (only admin replies email OWNER/ADMIN + in-app notify), and OU8 does not claim otherwise — the link is issued on demand from the ticket view, not auto-emailed.
- **Public page:** `GET /public/tickets/track/:token` (`@Public`, token = only credential) returns status/subject/category/timestamps + PUBLIC messages only — `isInternal:false` is in the query itself, diagnostics/SLA/assignee never enter the payload (spec asserts the serialized payload contains neither the internal note text nor diagnostics). Web page at `/ticket/track/[token]` (bn UI): status + thread + reply form; a bad/expired token shows ONE honest not-found state, no login wall.
- **Public reply:** `POST /public/tickets/track/:token/reply` lands as a public `SupportTicketMessage` with `authorKind:"customer"` (new honest kind value; consumers treat non-`admin` as the other side), `authorId` = the ticket's `createdById` (the token names exactly that ticket), `isInternal:false`, and reopens a resolved/closed ticket — mirroring the tenant reply semantics. It broadcasts the same SSE `message.created` event the dashboards already listen to.
- Proof: `support/ou8-ticket-tracking.spec.ts` (5 tests): token round-trip/tamper refusal; internal-note exclusion incl. full-payload string scan; bad + cross-org token 404; customer reply stored public + reopens; cross-org issuance refused.

## Explicit NOT BUILT list

- Drag-drop page builder / free-form section builder (explicitly out of scope) — reorder is ↑/↓ buttons over a fixed section vocabulary only.
- New section TYPES (no testimonial/video/custom-HTML sections invented).
- Hiding/reordering the product grid; hiding the shop header/footer/announcement (not home "sections" in the theme system).
- Per-page (product/checkout) section control — customizer is shop-HOME only, as the machinery supports.
- Exit-intent/scroll/delay trigger changes — lead popup reuses StorePopup's existing three triggers verbatim.
- Popup A/B variants, multi-popup rotation, popup targeting by audience/UTM.
- Lead dedupe/merge on popup submission (LeadsService.create itself does not dedupe manual creates either; popup creates follow the same semantics) and popup→campaign attribution.
- Shop-customer support tickets (no such system exists — see Step-0.5); ticket creation from the public page (tracking + reply only); file attachments on public replies; CSAT via the public page; emailing the tracking link automatically (no creation-time notification exists to extend honestly).
- Token revocation/rotation for tracking links (MS2 tokens have the same property — link = credential until expiry).
- Screenshot/visual QA of the new themes and the section editor (build + type + unit gates only).

## Gates (as run, one heavy gate at a time)

- API jest — OU8 specs: `ou8-storefront.spec.ts` + `ou8-ticket-tracking.spec.ts` **14/14 pass**.
- API jest — touched areas regression: `src/storefront` + `src/support` **32 suites, 421/421 pass**.
- API tsc: **clean** (`tsc --noEmit`).
- Web vitest: OU8-related files 13/13 (`shop-theme`, `shop-sections`, `shop-card-v2`); FULL suite **111 files, 905/905 pass**.
- Web tsc: **clean**. Web build: **green** (`/ticket/track/[token]` route present in output).
- Fresh-Postgres FULL migration run: **219/219 applied, 0 unfinished** (218 at base + 1 OU8); all 12 OU8 columns verified present via information_schema.
- Known base-proven failures (cc26, adx3-nav-counts, gb9-public-docs) were not re-encountered in the touched suites; nothing in OU8 touches those areas.

## Live checklist (ALL UNCHECKED — owner-gated)

- [ ] Deploy (owner push instruction + Dokploy Redeploy) — migration 20261023100000 runs on the real DB
- [ ] Set a shop to `warm`, load the real shop home/product pages, confirm full render
- [ ] Set a shop to `ocean`, same check incl. dark header surfaces
- [ ] Hide `featured` + move `flash` above `hero` in the section editor; confirm the live shop matches
- [ ] Lead popup on a real shop: submit the form, confirm the Lead appears in CRM (source website) and `captures` increments
- [ ] Promo popup regression on a real shop (impressions/clicks still count)
- [ ] Copy a ticket tracking link from a real ticket, open it logged-out, confirm internal notes are invisible and a reply lands on the ticket
