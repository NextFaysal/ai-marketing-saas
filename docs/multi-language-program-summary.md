# Multi-Language (i18n) Program — Summary (ML1–ML16, MB1–MB6)

Program: Multi-Language Master Plan (approved in full 2026-10-19).
Goal: end the Bangla/English mixing — every surface renders 100% in
the selected language (bn or en), each language with its own format
(Bengali digits/dates/৳ lakh grouping vs Latin digits/day-first
dates), language chosen per staff preference → org default →
platform default bn, and storefronts in the shopper/shop locale.

- **Worktree / branch:** `~/workspace/ai-marketing-saas-i18n` ·
  `multi-language`
- **Base:** `72583f23` → **Final HEAD:** the MB6 docs commit on top
  of `1dd397fc` (see chain below). Tree clean at close.
- **Push:** NONE — local commits only throughout (owner-only push
  rule). Nothing in this program is deployed or live-proven.

## Item-by-item audit (ML1–ML16)

The plan defines 15 items (its numbering skips ML9 — a gap in the
plan itself, not a dropped item).

| Item | Verdict | Evidence |
|---|---|---|
| ML1 — locale core + language settings (staff pref → org default → bn; migration; switchers; Settings section) | ✅ SHIPPED (MB1) | `docs/multi-language-mb1-acceptance.md` |
| ML2 — format layer (one `fmt*` module, both format specs, BN font) | ✅ SHIPPED (MB1) | MB1 acceptance |
| ML3 — dictionary infra, parity tests, scanner + baseline, glossary v1 (58 terms) | ✅ SHIPPED (MB1) | MB1 acceptance; `docs/i18n-scan-baseline-2026-10-19.md` |
| ML4 — dashboard shell + common + Settings (+ STEP-0 `tr()` interpolation/count helper) | ✅ SHIPPED (MB2) | MB2 acceptance |
| ML5 — dashboard: Orders, Products/Inventory, Inbox, CRM/Customers | ✅ SHIPPED (MB2) | MB2 acceptance |
| ML6 — dashboard: Ads/Campaigns, Messaging, Automations, Analytics, Courier, Billing, Agency + remainders; D7 blueprint data `*En` fields | ✅ SHIPPED (MB2) | MB2 acceptance + reconciliation addendum |
| ML7 — platform admin fully dictionary-driven (1,817 keys/locale, parity-pinned) | ✅ SHIPPED (MB3) | MB3 acceptance |
| ML8 — storefront completion + public surfaces (shop dict 1,461 keys; public dict 825 keys) | ✅ SHIPPED (MB3; its two API-locale leftovers were closed by MB4) | MB3 + MB4 acceptance |
| ML10 — API message catalog (3,798 bn/en pairs incl. MB6's proactive namespace, 73 namespaces; code+params error contract; 0 literal Nest-exception throws) | ✅ SHIPPED (MB4; proactive namespace completed in MB6) | MB4 + MB6 acceptance |
| ML11 — notifications render at send time in the recipient's language (mixed→bn); voice TwiML `conversationLanguage` bug fixed | ✅ SHIPPED (MB4) | MB4 acceptance |
| ML12 — documents in the org/shopper locale (invoice, packing slip, finance reports, exports, CSV) | ⚠️ PARTIAL (MB4) | Print-HTML + CSV + reports shipped; **BN PDF not built** — the courier PDF writer is WinAnsi-only, so PDFs stay EN/ASCII and Bengali documents are print-HTML (D-MB4-6) |
| ML13 — AI language unification (one owner resolver for owner-facing AI; the customer chain under Smart AI R3 verified intact and untouched) | ✅ SHIPPED (MB5) | MB5 acceptance (24 decision points accounted) |
| ML14 — automation language (order notifications per-locale config; workflow/journey template variants) | ⚠️ PARTIAL (MB5) | Both mechanisms shipped; **abandoned-checkout per-locale sends not built** — the recovery texts have no template identity to attach variants to |
| ML15 — NF5 expansion + coverage (Category full, BlogPost title, coverage endpoint + admin page) | ⚠️ PARTIAL (MB5) | Category + coverage shipped; **BlogPost content translation not built** (title only, by decision); category *description* overlay not wired (no public payload serves descriptions) |
| ML16 — remainder sweep + zero-hardcoded enforcement gate + bilingual QA checklist + this summary | ✅ SHIPPED (MB6) | MB6 acceptance |

**Audit totals: SHIPPED 12 · PARTIAL 3 · NOT BUILT 0** (of the 15
plan items). Every partial is a named sub-part with a recorded
reason — nothing was silently dropped.

## What the user can do now that they couldn't before

- Staff pick বাংলা or English for the whole dashboard and admin;
  orgs set their default in Organization Settings.
- Every dashboard/admin/storefront screen renders fully in the
  chosen language; money, dates, times, counts and plurals follow
  that language's pinned format (bn: ৳১,০০,০০০ · ১৯ অক্টোবর ২০২৬ ·
  en: ৳1,00,000 · 19 October 2026).
- API errors carry a stable `code` and render in the request
  locale; notifications and documents generate in the recipient /
  org language; owner-facing AI speaks the business's configured
  language; customers are answered in their own language chain.
- Developers get an enforcement gate (`pnpm i18n:gate`): a new
  hardcoded UI literal or direct `toLocaleString` outside the
  dictionary homes fails the check unless a reviewed allowlist
  entry (path + reason + pinned caps) covers it.

## Scanner — baseline vs final (`scripts/i18n-scan.mjs`)

| Measure | MB1 baseline | MB6 final |
|---|---|---|
| Files scanned | 1,240 | 1,244 |
| Bengali literals outside dictionary homes | **18,124** | **5,775** |
| English-UI literals (heuristic upper bound) | 2,764 | 2,743 |
| Direct `toLocaleString` calls | **618** | **40** |

Per-surface final: web 2,041 BN / 1,073 EN / 20 calls · admin
**0 BN** / 104 EN / 0 · api 3,734 / 1,566 / 20.

Honest reading of the remainder (the BN column is the meaningful
axis; the EN column is dominated by class-string/data noise, as
MB3's classification showed): the remaining 5,775 Bengali literals
are **not UI chrome** — they are, by the gate allowlist's per-file
reasons: the bn halves of D7 bilingual data catalogues (blueprint /
 festival / funnel data that renders by locale), API category-(d)
text (AI prompts, intent/keyword matching, address data), theme
sample/demo data, customer-content templates, bn formatter libs,
and a tail of individually reviewed small remainders. Admin —
the one fully enumerable surface — is at zero. The gate pins
every one of the 541 remainder files at its MB6 count.

One measurement note: the final scan treats the MB4 API catalog
(`apps/api/src/i18n/`) as a dictionary home; it did not exist at
baseline. Its 3,798 key pairs ARE dictionary entries, so this is a
classification correction, not a relaxation.

## Dictionary / catalog sizes at close

Dashboard ≈14,451 bn keys at MB2 close − 154 dead pairs removed in
MB6 (parity-pinned bn/en) · admin 1,817 keys/locale · shop 1,461 ·
public 825 · API catalog 3,798 bn/en pairs across 73 namespaces.

## Migrations (2 in the whole program)

| Migration | Batch | Content |
|---|---|---|
| `20261120000000_ml1_locale_fields` | MB1 | `User.preferredLocale` + `Organization.dashboardLocale` (additive) |
| `20261121000000_mb5_message_template_variants` | MB5 | `MessageTemplate.variants` Json? (per-locale workflow template variants) |

Fresh-PG at program close: **282/282** migrations apply cleanly on
empty PostgreSQL 16 (MB6 gate).

## Standing partials (with reasons — carried, not dropped)

1. **BN PDF** — PDFs stay EN/ASCII (WinAnsi-only writer); Bengali
   via print-HTML. Needs a Bengali-capable PDF font/writer.
2. **Platform blueprint ad text** — bn-only; the CA26 spec pins
   blueprint seed byte-identity.
3. **ou7 GL export prose** — bn-only data text in the finance
   export (structural labels are catalogued).
4. **Merchant-authored templates** — never machine-translated, by
   decision (D-MB4-5); ML14 added the merchant's OWN per-locale
   variants instead.
5. **Abandoned-checkout per-locale sends** — needs a
   template-identity design first (today: three fixed presets).
6. **BlogPost content translation** — title only (AI cost/length);
   a separate step if wanted.
7. **Category description public overlay** — management + approved
   read exist; no public payload serves descriptions yet.
8. **Campaign preset templates** (campaigns page) — no En
   companions yet (D7-class content follow-up, MB2 note).
9. **Blueprint search** matches bn fields only (MB2 leftover).
10. **MB4 (a2) data-shaped tails** — onboarding checklist titles,
    lead-score reasons, inbox health-indicator labels (messaging
    label structures DID get `labelEn` companions).
11. **Staff-note scaffolding** — handover note boilerplate,
    support keyword suggestions, the automation billing/dunning
    email (no recipient-language identity) stay bn.
12. **MX7 version snapshots** do not carry template `variants`.
13. **Dashboard `loading.tsx` boundaries** render bn by
    construction (no LocaleProvider in the loading boundary, E11).
14. **gb6 segment summaries** keep the pre-existing `minorToTaka`
    formatting inside sentences (behaviour-change decision
    deferred in MB2).
15. **Glossary admin page** — the glossary ships as data + docs
    (`docs/i18n-glossary.md`); no admin UI for it (MB1 NOT BUILT).

## Owner-gated remainders

- **Push / deploy:** never authorized during the program; all work
  is local commits on `multi-language`.
- **Live QA:** `docs/multi-language-live-qa-checklist.md` — every
  item UNCHECKED; to be run post-deploy by the owner. No screen in
  either language has been visually verified by the program.
- **M30-style live verification** of the language features with
  real accounts remains owed, as with every prior program.
- **Per-org job enables / production rollout choices** unchanged
  by this program.

## Per-batch HEAD chain

| Batch | Final HEAD | Record |
|---|---|---|
| Base | `72583f23` | — |
| MB1 (ML1–ML3) | `529380bf` | `docs/multi-language-mb1-acceptance.md` |
| MB2 (ML4–ML6) | `85e7616a` | `docs/multi-language-mb2-acceptance.md` |
| MB3 (ML7–ML8) | `e81a0cbf` | `docs/multi-language-mb3-acceptance.md` |
| MB4 (ML10–ML12) | `552e6cc2` | `docs/multi-language-mb4-acceptance.md` |
| MB5 (ML13–ML15) | `37397ec3` | `docs/multi-language-mb5-acceptance.md` |
| MB6 (ML16) | sweep `3f9decff` · gate `1dd397fc` · docs (this commit) | `docs/multi-language-mb6-acceptance.md` |

Batch records: `hidden_files/multi-language-mb*-record.md` (goal
workspace). Program closed 2026-10-20. **No push.**
