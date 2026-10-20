# Multi-Language — Live QA Checklist (post-deploy, owner-run)

Prepared by MB6 (ML16) of the Multi-Language i18n Program. **Every item
is UNCHECKED.** The program's evidence is tests, builds and the
hardcoded-string gate — no screen in either language has been
visually verified by the program (this environment cannot do
screenshot QA), and nothing here is live-proven. Run this list
against a real deployment (or a local run with real data), in
**both** languages, and tick items only from what you actually see.

How to switch: dashboard header language switcher (staff
preference) · Organization Settings → Language (org default) ·
Admin shell switcher · Storefront follows the shop's configured
locale / shopper choice on shop surfaces.

## 1. Language switching & resolution

- [ ] Dashboard: switching the header switcher to English re-renders the shell, nav and the open page 100% in English — no Bengali chrome strings remain on screen
- [ ] Dashboard: switching back to বাংলা re-renders 100% in Bengali script (no Roman transliteration)
- [ ] A second staff account with no personal preference sees the Organization default language
- [ ] An org whose default is English opens English for a brand-new staff user
- [ ] Admin: shell switcher flips the admin app between বাংলা and English completely (nav, pages, dialogs, toasts)
- [ ] Refresh / re-login keeps the chosen language (preference persisted)

## 2. বাংলা format (bn) — spot checks

- [ ] Money renders as ৳ with Bengali digits and lakh grouping, e.g. ৳১,০০,০০০ (orders list, dashboard cards)
- [ ] Dates render in Bengali, e.g. ১৯ অক্টোবর ২০২৬ style (long form), on orders / inbox / analytics
- [ ] Times render with Bengali digits (note: the AM/PM marker itself stays Latin — "২:৩০ PM" — this is the pinned Intl behaviour, not a bug)
- [ ] Counts inside sentences use the Bengali classifier pattern (e.g. ৫টি অর্ডার) with no leftover English plural forms
- [ ] Bengali text uses the Hind Siliguri font and is not clipped at buttons/labels (line-height check on dense pages: orders, inbox, campaign builder)

## 3. English format (en) — spot checks

- [ ] Money renders with Latin digits and lakh grouping, e.g. ৳1,00,000 (not 1,000,000 Western grouping)
- [ ] Dates render day-first, e.g. 19 October 2026 (never October 19, 2026)
- [ ] Times render like 2:30 pm
- [ ] Plural sentences read correctly (1 order / 2 orders) on dashboard cards and inbox
- [ ] No Bengali script anywhere in en-mode chrome (merchant-entered data — product names, customer messages — may of course stay as authored)

## 4. Dashboard surfaces (both languages, quick pass each)

- [ ] Orders + order detail (incl. courier stepper labels follow the language)
- [ ] Products / inventory / POS
- [ ] Inbox (conversation list, handover labels, courier widget)
- [ ] CRM / customers (segment builder labels)
- [ ] Ads + campaign builder (budget figures follow the language format)
- [ ] Messaging (broadcast composer, template list)
- [ ] Automations / workflows (blueprint catalogue renders in the UI language; blueprint preset TEXT stays as data per D7)
- [ ] Analytics / reports
- [ ] Settings pages incl. Organization Settings → Language section itself
- [ ] Delivery page: rider "fix age" labels follow the language (MB6 sweep)

## 5. Storefront & public (shopper side)

- [ ] Shop home / PDP / cart / checkout render in the shop's configured locale
- [ ] Shopper-visible money + dates follow that locale's format (both bn and en shop configurations)
- [ ] Order-tracking page: courier stepper labels follow the shop locale (MB6 sweep)
- [ ] Product/category names show the approved NF5 translation in en mode; unapproved drafts never appear
- [ ] Single-product checkout + landing pages render in the payload locale
- [ ] Platform landing / pricing / auth pages render in the platform default

## 6. Notifications & documents (send real samples)

- [ ] Order-placed SMS/email to a customer whose languagePref is bn arrives in Bengali; to an en customer, in English
- [ ] A customer with languagePref "mixed" receives Bengali (pinned rule)
- [ ] Order-notification merchant override: an org with per-locale template variants sends each recipient their locale's variant; the other locale's text never leaks
- [ ] Invoice + packing slip (print view) generate in the org's language
- [ ] KNOWN PARTIAL: courier PDF stays EN/ASCII (the PDF writer cannot embed Bengali glyphs) — Bengali documents are print-HTML only. Verify the PDF at least renders correctly in English
- [ ] Report/CSV export headers follow the org language

## 7. API & AI behaviour

- [ ] An API error (e.g. a validation failure) returned to an en-locale session carries the English message + a stable `code`
- [ ] Owner daily briefing arrives in ONE language (title and body the same language) following the org's AI reply language
- [ ] AI inbox reply to a Bengali-writing customer is Bengali; to an English-writing customer, English (customer chain unchanged by the program)
- [ ] Copilot / owner chat answers in the business's configured language
- [ ] Admin → Translations coverage page shows real per-org coverage numbers (content locales bn/en/hi labelled separately from UI locales)

## 8. Known standing partials (verify they behave as documented, not as bugs)

- [ ] Platform blueprint ad copy (primary text/headline) stays Bengali in both locales (CA26 seed pin)
- [ ] Merchant-authored notification templates send exactly as the merchant wrote them (never machine-translated)
- [ ] Abandoned-checkout recovery messages have no per-locale variants yet (fixed preset texts)
- [ ] Blog post TITLES translate via NF5; post body content does not
- [ ] Category descriptions: translation management exists in the dashboard; no public payload serves them yet

 Sign-off: __________  Date: __________  Deployment/commit tested: __________
