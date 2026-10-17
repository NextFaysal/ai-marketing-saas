# NF5 Acceptance — Multi-language + Multi-currency Storefront (FB3, item 1)

**Package:** New Features Frontier FB3 · **Worktree/branch:** `~/workspace/ai-marketing-saas-nf`, `new-frontier` · **Base:** `37590745` (FB2 code-complete, 228 migrations)
**Local commits only — nothing pushed.** Migration claim used: `20261032000000` ONLY (later FB3 items take `20261033000000+`).

## Per-item record

| # | Commit | Item |
|---|---|---|
| 1 | `627e9bc9` | Schema + migration `20261032000000_nf5_translations`: `ContentTranslation` (org-scoped; entityType product \| storefront_string; field; locale; text; status draft\|approved; source ai\|human; createdBy/updatedBy; unique org+entity+field+locale; index org+entity+locale) + `DisplayCurrencyRate` (org-scoped; currency; ratePerUnit as string; required sourceNote; unique org+currency) |
| 2 | `532cffb5` | API `apps/api/src/translations/` (service / controller / module / DTO / pure helpers / public read functions) + `TranslationsModule` wired in app.module + storefront integration (shopHome + productDetail overlay, `?locale=` on the existing `public/shop/:orgSlug` routes, `settings.displayCurrencies`) |
| 3 | `924d57ff` | Specs `translations.spec.ts` — 19 tests (below) |
| 4 | `18a3143d` | Web: `lib/translations.ts` (+5 vitest), `components/product-translations.tsx` panel mounted in the dashboard product edit modal, display-price captions on shop product cards + PDP, `?locale=` forwarded by the shop home page |

## Locale choice (brief item 5) — **hi (Hindi)**, and why

The codebase's existing i18n machinery is strictly **bn | en**: `StorefrontSetting.locale` is `@IsIn(["bn","en"])`, products carry AB6 `nameEn`/`descriptionEn` alternates, and the web shop dictionary (`lib/shop-i18n.ts`) is typed `ShopLocale = "bn" | "en"` with a bn fallback for anything unknown. No third locale exists anywhere. NF5 keeps bn + en as the base pair and adds **hi** end-to-end through the new translation layer, because:

- `ContentTranslation.locale` is a free string — the mechanism is locale-agnostic by design, so hi needs no schema or routing change;
- every LLM provider behind the existing `LlmFactory` (OpenAI / Anthropic / Gemini) generates Hindi, so AI drafts work for hi through the org's own configured provider;
- the web shop renders product name/description from the payload generically, so approved Hindi content displays with zero dictionary changes. Shop *chrome* honestly falls back to the bn dictionary for hi (shop-i18n's own rule for an unknown locale) — no fake Hindi chrome was invented.

Locale resolution follows the existing routing, no second router: the shop is resolved by the same `:orgSlug` segment as always; an explicit shopper `?locale=` (bn|en|hi) wins when supported, otherwise the org's `StorefrontSetting.locale` (the EC19 pattern) applies.

## What shipped

- **Staff API** (`organizations/:organizationId`, TenantGuard + products WRITE_ROLES on writes): per-product translation list; human create/edit (source `human`; a save never silently approves — status changes only when explicitly sent; the panel also demotes edited approved text back to draft); approve/unapprove via PATCH; storefront-string list + drafts; display-currency rate list/upsert/delete. All writes audit-logged.
- **AI drafts ONLY via `providerForOrg` (the CC8 LlmFactory path)** — no new provider, no key in code. Kill switch (`killSwitches.aiDisabledOrgIds`) refuses with 403 like chat/voice. If the resolved provider is not a real LLM (dev-template = no working LLM config), generation fails with a clear Bengali error and writes nothing — a template "translation" is never fabricated. Usage is recorded (`AIUsageRecord`, features `product_translation` / `storefront_translation`). Every AI result is saved `status: "draft", source: "ai"` — including demoting a previously approved row back to draft, since the new text is unverified.
- **Public read path** (`public-translations.ts`, called by `StorefrontService.shopHome` / `productDetail` with its own prisma — no new DI edge): the query filters `status = "approved"` in the WHERE clause (never post-filters), is org-scoped, and overlays name/description + the announcement/return/delivery storefront strings. Missing or unapproved → the base-language original (with the AB6 nameEn rule intact underneath). Failure-isolated: a translations problem never breaks the shop.
- **Currency display**: rates are human-entered (`ratePerUnit` = base-currency units per 1 display unit) with a **required source note**; the base currency itself is rejected. Converted prices appear only as `displayPrices` strings on public product payloads, each carrying the honest label in the customer's language — bn: “আনুমানিক মূল্য — চেকআউটে দোকানের মূল মুদ্রায় (BDT) চার্জ করা হবে”, en/hi equivalents. No rate configured → no converted price anywhere. **Checkout, orders and payments never read the rate table** — spec (e) proves an order placed with a display currency active totals exactly the base amount (50000 + 6000 delivery = 56000 minor).
- **Web**: translation panel in the product edit modal (locale picker bn/en/hi, per-field editors with status/source chips, AI draft buttons for the product + storefront strings, approve/unapprove, currency-rate editor with the no-live-rate notice); shop product cards (both themes) and the PDP render the server-sent display-price caption; the shop home page forwards `?locale=`.

## Gates (targeted only, per brief — heavy gates are the coordinator finisher's)

| Gate | Result |
|---|---|
| `translations.spec.ts` (jest) | **19/19 PASS** — (a) draft never served publicly, incl. straight after AI generation and incl. a demoted previously-approved row; (b) missing → base fallback; (c) approved served for its locale (product name/description + announcement string), other locales unaffected; (d) org isolation on reads, the overlay helper, and staff writes (404); (e) order total = exactly 56000 minor base with USD display active; (f) AI draft = draft + source ai, never approved; honest no-LLM failure (Bengali, nothing written); kill-switch 403; strings draft skips fields without base text instead of inventing; currency validation (source note required, base currency rejected, bad rate rejected) |
| Storefront regression (touched service) | **28 suites / 389 tests PASS** |
| API `tsc --noEmit` | PASS |
| Web targeted vitest | translations 5/5 + shop-i18n 3/3 + booking 12/12 = **20/20 PASS** |
| Web `tsc --noEmit` | PASS |
| `prisma validate` | PASS (migration is hand-written to match; fresh-PG is the finisher's gate) |

## NOT BUILT / limits

- **Live proof of everything**: no migration has run on a real database, no real LLM call was made, nothing is deployed. M30-style verification owed.
- **Shop chrome (buttons/menus) in Hindi** — the shop-i18n dictionary stays bn/en; hi translates merchant *content* (product name/description, announcement, return/delivery copy). Extending chrome dictionaries is a separate, larger change.
- **Variant-level translations and variant display prices** — translations cover product name/description + the three storefront strings; variant names and per-variant converted prices are not translated/converted in v1 (the PDP caption hides when a variant is selected).
- **Other public surfaces** (brand page, recommendations, cart, checkout, single-product checkout, landings) do not overlay NF5 translations in v1 — shop home + PDP do. Cart/checkout always show base text + base currency, which is also the honesty-safe default.
- **No translation memory / glossary, no bulk translate-all, no auto-detection of the shopper's browser language** — locale comes from `?locale=` or the shop setting only.
- **Converted amounts assume 100 minor units per major unit** on both sides (true for BDT/USD/INR/EUR); zero-decimal currencies (e.g. JPY) are not special-cased — a merchant entering such a rate would show a mis-scaled *display* figure (checkout is never affected). Recorded here rather than silently claimed.
- Full API jest, fresh-PG, boot smoke and web build were **not** run — per the FB3 brief they belong to the coordinator's serial finisher.
