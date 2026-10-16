# EB3 Feature Inventory — shop tree (BEFORE state, at base d3787107)

Compiled by the EB3 coordinator from the tree before any EB3 edit.
AFTER column filled at batch close (HEAD 9faee566 + docs commits):
every row reads "present". Behaviour notes where EB3 intentionally
changed presentation/coordination (all theme-gated to v2 except the
overlay queue, which is behaviour-only on all themes):

- ShopHeader row: on v2 shops the header is the new v2 chrome
  (search row + drawer nav + icon buttons); legacy themes keep the
  exact pre-EB3 header — the "present" verdict for the header row
  refers to legacy themes.
- Overlays row group: trigger/frequency/dismissal logic unchanged;
  ED9's queue now serializes bottom overlays (one at a time,
  popup > install > push > social proof) and lifts them above the
  v2 bottom nav / PDP buy bar. Visuals unchanged.
- Cart row: the full cart page is untouched; v2 adds a header cart
  DRAWER as an additional surface (same lib calls).
- Checkout row: v2 adds step chrome + sticky bar + section-anchored
  inline copies of the existing error string; the form, fields,
  validation and submit path are the pre-EB3 ones.
- Single checkout + landing rows: unchanged — ED9 item 4 found no
  brand colour in either payload (API-verified), so no CTA swap
  was made (see docs/design-eb3-acceptance.md).

## Routes

| Route | Features (before) | After |
|---|---|---|
| `/shop/[orgSlug]` (home/listing) | hero (themeClass) + meta description; search form (settings.showSearch) GET `?q=` (+hidden category/brand); category chips (showCategories) w/ counts; brand chips w/ counts; bundles strip (hidden while filtering); flash-sale section + countdown (server clock); featured grid (showFeatured); recently-viewed strip (hidden while filtering); product grid + SortSelect (featured/price/name) + pagination (URL params); empty states (filtered / no products); JSON-LD Organization+WebSite; AffiliateRefCapture (?ref=) | present |
| `/shop/[orgSlug]/products/[productSlug]` (PDP) | gallery + lightbox (dynamic); video poster; variants/qty; add-to-cart + buy-now (.btn-brand); ExpressCheckout sheet (dynamic); flash pricing + countdown; stock badge; reviews summary + ReviewInsightBox; ProductQuestions (Q&A); StockAlertForm; CrossSellRail; recently-viewed recording; ProductLightbox; JSON-LD product + rating; deposit notice/stamp (AB4) | present |
| `/shop/[orgSlug]/cart` | line items w/ MediaImage thumbs; qty steppers; remove; subtotal; checkout CTA (.btn-brand); ExpressCheckout (dynamic, SSR) | present |
| `/shop/[orgSlug]/checkout` | 1,020-line client form: contact/shipping info; delivery options; payment methods (COD, gateways, deposit AB4); AB4 custom fields (unknown keys rejected server-side); gift wrap; coupon / loyalty / gift-card evaluator lines; fraud/risk signals; place-order (idempotent); error banner | present |
| `/shop/[orgSlug]/success` | order confirmation (Suspense) | present |
| `/shop/[orgSlug]/account` | session login/register; orders list; wishlist (?wishlist=1); addresses; loyalty view | present |
| `/shop/[orgSlug]/blog`, `/blog/[postSlug]` | post list (covers 4/3), post page (cover 16/9, body blocks) | present |
| `/shop/[orgSlug]/brands/[brandSlug]` | brand hero/logo, brand product grid, search params | present |
| `/shop/[orgSlug]/p/[pageSlug]` | merchant pages via PageBlocks; ContactForm; PageFaq | present |
| `/shop/[orgSlug]/gift-cards` | gift-card balance check (GiftCardBalanceClient) | present |
| `/shop/[orgSlug]/[...rest]` + not-found | branded shop 404 (shop logo via MediaImage) | present |
| `/shop/[orgSlug]/manifest.webmanifest`, `icon.svg`, `robots.txt`, `sitemap.ts` | per-shop PWA manifest (AX22), generated icon (white-label), robots, sitemap | present |
| `/track/[orgSlug]` | public order tracking (phone + order no) | present |
| `/checkout/[slug]` | single-product checkout (client page, no shop layout) | present |
| `/l/[slug]` | landing page (server wrapper + LandingClient sections: hero/gallery/FAQ/reviews/upsell/bump/order form) | present |

## Layout chrome (every shop page)

| Element | Before | After |
|---|---|---|
| Announcement bar | settings.announcementText, accent bg | present |
| ShopHeader | logo (MediaImage) or initial tile (accent); nav: home, blog (if posts), wishlist (badge, header-cache), account, cart (accent bg, badge), merchant menu pages inline — one unwrapped row (mobile overflow) | present |
| Footer | shop name; footer page links; COD note; payment note; bKash/Nagad numbers; support phone; return policy text | present |
| ShopContactButtons | fixed bottom-5 right-5 z-40, WhatsApp/Messenger (renders only when set) | present |
| ShopPopup (deferred) | modal fixed inset-0 z-50; fetch + delay/scroll/exit triggers; per-popup frequency | present |
| ShopSocialProof (deferred) | fixed bottom-5 left-5 z-40; feed rotation; themeOf(themeId).headerDark styling | present |
| ShopPushPrompt | fixed bottom-5 left-5 z-50; shop-scoped push worker | present |
| ShopInstallBar | fixed bottom-0 z-40 full-width; beforeinstallprompt + iOS copy; per-shop dismissal | present |
| TrackingTags / AttributionCapture / custom CSS+JS (AX23) | settings-driven; JS host-gated | present |

## Shared components

ProductCard (image MediaImage 640², QuickViewButton, WishlistHeart overlay, flash badge + countdown, price + compare-at, stock badge, free-shipping badge), BundleCard, CrossSellRail, RecentlyViewed(Strip), FlashCountdown, SortSelect, StockAlertForm, ProductQuestions, ExpressCheckout, PageBlocks, QuickView (.btn-brand buy/checkout), GiftCardBalanceClient.
