# Multi-Language MB4 — Acceptance (ML10 API catalog · ML11 notifications · ML12 documents)

Batch: MB4 of the Multi-Language Master Plan (§৬), built on MB3 HEAD `e81a0cbf`,
branch `multi-language`, worktree `~/workspace/ai-marketing-saas-i18n`.
Final HEAD: `5a34c926`. Local commits only — **no push** (owner rule).
No migration in this batch (nothing needed one; the claim range was not touched).

## Commits

| Commit | Scope |
|---|---|
| `5cfd9b7e` | Step-0 plumbing: `apps/api/src/i18n/**` (catalog + core), `main.ts`, `app.module.ts` |
| `45fe4811` | ML10: API error/content conversion across all remaining API modules + web booking/landings locale fields |
| `5a178cee` | ML11: messaging, order-notifications, webpush, voice |
| `5a34c926` | ML12: finance, reports, orders/print-center, courier/pdf |

Worker split (disjoint, per the MB4 inventory): W-1 plumbing + error cluster A,
W-2 error cluster B + (a2) `*En` data, W-3 ML11 + ML12. W-3's agent died three
times in daemon restarts; its uncommitted tree work survived and was audited,
finished and spec-verified by the coordinator directly (see batch record).
Coordinator finishing-pass edits are interleaved by file inside the item
commits above (assembly note: per-file worker/coordinator hunks are not
separable in the final tree; the batch record lists every finishing-pass item).

## The 10 decisions (D-MB4-1…10) — as taken

All ten inventory recommendations were **adopted**; none conflicted with the
plan laws (ML-L1…L6).

1. **Error contract**: response keeps `message`, gains `code` + `params`;
   the exception filter renders `message` in the request locale; the web
   needed no change. ApiException `.message` is the bn catalog rendering at
   throw time (CD-1); the filter re-renders for en requests.
2. **Locale order**: public/shop routes → storefront locale; authenticated →
   `User.preferredLocale` → org `dashboardLocale` (via `:organizationId`
   when present) → bn.
3. **Plain `Error` throws**: converted selectively — user-visible only;
   internal / message-as-data / control-flow errors left as-is (listed below).
4. **Validation**: `ValidationPipe.exceptionFactory` renders from the catalog
   (framework-English DTO defaults are gone); the `details` array shape is
   preserved.
5. **Merchant-authored templates**: out of scope — they stay in the language
   the merchant wrote them (no migration, no machine translation).
6. **Documents**: org `dashboardLocale`; shopper documents in the storefront
   locale. **BN PDF is a documented partial** (see NOT BUILT / partial):
   `courier/pdf.ts` is a WinAnsi-only writer, so PDFs stay EN/ASCII and
   Bengali documents are served via print-HTML.
7. **`languagePref "mixed"` → bn** everywhere (send-locale normalizer).
8. **(a2) data-shaped content** takes `*En` data fields (plan D7), computed
   strings take catalog keys.
9. **Voice TwiML fallback honours `conversationLanguage`** — the known bug
   is fixed: `<Say>` language and the Polly voice follow
   `VoiceCallSetting.conversationLanguage`, and the spoken fallback lines
   come from the catalog.
10. **Catalog param syntax** is `{{name}}` throughout.

Coordinator decisions CD-1…CD-5 are recorded in the batch record
(`hidden_files/multi-language-mb4-record.md`): bn-at-throw-time rendering,
catalog layout (`apps/api/src/i18n/catalog/<domain>.ts`, coordinator-owned
index), MB3 leftovers (CD-3) assigned to W-1/coordinator, no migration (CD-4),
and the file-ownership map (CD-5). One assembly ruling: platform blueprint
ad-level copy (`primaryTextEn`/`headlineEn`) was deliberately reverted —
the CA26 spec pins blueprint seed byte-identity, so platform blueprint ad
text stays bn-only in MB4 (listed as a partial below; per-org/user content
is unaffected).

## Item audit

### ML10 — API message catalog
- Typed catalog mirroring the web dictionary laws: **3,785 bn/en key pairs**
  across 72 namespace files under `apps/api/src/i18n/catalog/`, wired into
  one `MESSAGE_CATALOG`; bn/en parity + placeholder parity pinned by
  `src/i18n/i18n-catalog.spec.ts`. Missing key → key + warn (never silent).
- Request-locale resolution: authenticated user pref → org default → bn;
  public/shop routes use the storefront locale (LocaleInterceptor +
  ApiI18nExceptionFilter + validation factory).
- Category (a): all 2,594 inventoried exception literals converted;
  **literal Nest-exception throws remaining in the API: 0** (verified by
  scan). 588 plain-throw sites reviewed; user-visible ones converted
  (incl. api-key scope validation in `common`, order-limit block errors
  carrying a `catalogCode` pointer on their concrete exception class).
- Category (a2): `*En` companions added for JOB_TEMPLATES (54),
  WORKFLOW_PRESETS (11), AUTOMATION_PRESETS (5), campaign BLUEPRINTS (5),
  journey + festival preset packs, shop-pages `titleEn`/`blocksEn`,
  connection-doctor `labelEn`/`messageEn` (94 keys), messaging
  journey/variables label structures (`labelEn` per entry). Computed
  strings render from the catalog (incl. messaging compose checks, A/B
  analytics + CSV, send-time/segment suggestions, geo-holdout
  method/note/reasons — the last added at assembly).
- MB3 leftovers (CD-3) closed: public landing payload's organization
  object now carries `locale`; checkout/product public payloads carry the
  product `locale` field; shop booking public payloads
  (services/staff/slots) carry the shop locale and the web booking page
  reads it (`shopT(locale)`) instead of hardcoding bn.
- The NF5 `translations` module was missed by the worker split; the
  coordinator converted its 21 user-visible throws into a new
  `catalog/translations.ts` (19 keys) at assembly.

### ML11 — Notifications in the recipient's language
- Send-time rendering from the catalog for messaging broadcasts,
  order-notifications, webpush and voice, plus the auth verification
  email (rendered from `catalog/auth.ts` at send time).
- Recipient locale: customer `CustomerMemory.languagePref` where known
  (the unsubscribe footer resolves it per recipient email; `mixed` → bn),
  else org default; staff-facing content in the staff user's locale.
- Voice: TwiML fallback honours `conversationLanguage` (bug fix, D-MB4-9).

### ML12 — Documents in the org locale
- Invoice, packing slip (print center), finance reports, report exports
  and CSV headers generate in the org locale; shopper documents in the
  storefront locale. Finance report labels derive from the documents
  catalog. PDF limitation per D-MB4-6 (below).

## Gates (all on the settled tree, serial, JSON/file-evidenced)

- **API jest, full suite, chunked per directory** (a single-process run
  OOMs on this box — MB1 precedent): ≈7,300 tests across 633 suites.
  Failures are ONLY the adjudicated set below.
- **API tsc** (`tsconfig.build.json`): **0 errors**. (The full
  `tsconfig.json` shows one pre-existing type quirk in
  `social-sn2.spec.ts` on lines untouched by MB4's diff — a W-2 spec
  annotation bug found by this batch was fixed; the remaining quirk is in
  test-only typing, specs are excluded from the build config.)
- **Web vitest**: 139 files / **1,140 tests, all pass**; **web tsc: 0**
  (web changed only for the booking locale).
- **Fresh-PG**: not applicable — no migration in MB4.
- Spot re-runs after the final edits: messaging 525 (flake only),
  voice+order-notifications+webpush+finance+reports 141/141,
  courier 158/158, products 94/94, translations+i18n 42/42,
  connections+inbox 1,014/1,015 (cc26 only), orders 435/435.

### Adjudicated failures (not MB4 regressions)
- **MB1 pre-adjudicated set, identical**: ads-intelligence ×2,
  adx3-nav-counts ×1, social-sn9 ×2, cc26-payout-automation ×1
  (cc26 re-proven on pristine base `e81a0cbf` in this batch: expected
  `already_created_for_slot`, received `below_threshold`).
- **sa-b18 competitor ×2**: fail identically on pristine base —
  findings dated 2026-10-15 ageing out of a recency window.
- **mx11-intelligence**: pre-existing flake — the spec seeds deliveries
  exactly on the 24h frequency-cap boundary; proven non-deterministic
  in BOTH trees (different tests fail on different runs).
- **ca19-geo-holdout**: timing flake — "latest" is picked by
  `createdAt desc` and the spec fake timestamps at ms precision, so the
  ended+recreated rows tie; proven non-deterministic on the MB4 tree,
  logic and spec untouched by the batch (message conversions only).

### Real defects found by the gates and fixed in-batch
- W-1 guard/catch paths that swallowed suspension blocks; courier error
  mangling; coupon-drop `instanceof`; catalog param cross-contamination
  (7 fixes during W-1's run).
- `gb9-gc22` spec expected `OrderLimitBlockedError` to be an
  `ApiException`; by design the class keeps its concrete
  `ForbiddenException` type and carries a `catalogCode` pointer —
  spec corrected to assert the design (class + pointer + status).
- `social-sn2` spec annotation bug (tuple matrix typed as `Row[]`)
  made the suite fail to compile — fixed to `[Row, string][]`.
- `send-locale`'s `catalogText` resolved only its four W-3 namespaces;
  folded so the full `MESSAGE_CATALOG` is its base layer (no import
  cycle; W-3 namespaces keep precedence; zero key collisions).
- ec24 spec had a contradictory double assertion left by a mechanical
  class swap — rewritten to assert the real contract (ApiException,
  404, message equality).

## Before / after counts (inventory method)

| Category | Before (inventory) | After |
|---|---|---|
| (a) exception literals | 2,594 + 588 plain sites + 6 DTO | **0** literal Nest exceptions; DTO messages catalogued; plain `throw new Error("…")` sites remaining: 321, all internal / message-as-data / control-flow (see exceptions) |
| (a2) API-returned display content | ≈3,443 | Converted via `*En` data + catalog; remainders listed as exceptions below |
| (b) notification content | ≈550–700 | Rendered at send time from catalog (notifications 55 + messaging 377 + documents/finance keys shared) |
| (c) document literals | 188 + spread labels | 0 hardcoded in invoice/packing-slip/finance/report-export/print-center paths (documents catalog: 118 keys); GL export prose labels partial (below) |
| (d) internal/prompt/data | ≈980 | Untouched by design (verified: ai/ prompts, inbox/intent.ts, bd-address data, keyword lists) |

Raw Bengali-literal scan of `apps/api/src` (non-spec, non-catalog) after
the batch: 2,701 — composed of category (d) (≈980), the bn halves of
bilingual data (presets, blueprints, journey/festival packs, demo data),
detection/matching lists, and the listed (a2) exceptions below.

## Exceptions — remainders, each listed deliberately

1. **(d) by design**: AI prompts and intent/keyword matching
   (`ai/**`, `inbox/intent.ts`, comment classifier/humanizer,
   voice-conversation engine intent lists, compose-check spam-word
   detection lists, `bd-address` data). Never converted.
2. **(a2) data-shaped tails** (bn text with no per-call locale context
   in MB4's scope; candidates for `*En` companions in a later batch):
   organizations onboarding checklist step titles; CRM lead-score
   reason strings; inbox health-indicator labels; messaging
   on/off toggle labels; `labelBn` halves in messaging journey/variables
   structures (**`labelEn` companions were added** — the bn halves stay
   as the bn rendering).
3. **Plain `Error` remainders (321 throw sites)**: internal errors,
   error-as-data values (e.g. `lastError` strings), library-style
   control flow, and provider-error passthrough `HttpException`s that
   forward the provider's own message. None are rendered to users as
   product copy.
4. **Stored A/B decision detail**: the auto-winner `rule` text stored
   in `abWinnerDetail` is rendered in the org locale at decision time
   (a stored-data language judgement call, per D-MB4-2's org default).
5. **Carousel validation errors** render in the org locale where the
   caller threads it (inbox template submit does); the pure builder's
   default remains bn.

## NOT BUILT / partial (explicit)

- **BN PDF — PARTIAL (D-MB4-6)**: PDFs remain EN/ASCII because
  `courier/pdf.ts` is a WinAnsi-only writer that cannot embed Bengali
  glyphs. Bengali documents are fully available via print-HTML
  (invoice, packing slip, reports). A Bengali-capable PDF font/writer
  is future work, not a silent gap.
- **Platform blueprint ad text — PARTIAL**: blueprint seed
  `primaryText`/`headline` stay bn-only; the CA26 spec pins seed
  byte-identity, so `*En` companions for ad-level copy were reverted
  at assembly. Merchant-authored ad copy is unaffected (it renders as
  authored in both locales' chrome).
- **ou7 GL export prose labels — PARTIAL**: general-ledger export
  label/mapping-note prose in `finance/ou7-accounting.service.ts`
  remains bn-only data text (the export's structural labels are
  catalogued). No `*En` companions were added for this prose in MB4.
- **Merchant-authored templates — NOT BUILT (by decision D-MB4-5)**:
  no translation layer over merchant-written notification/document
  templates.
- **Live proof — NONE**: nothing in MB4 is verified against a running
  deployment; all evidence is unit/integration tests on fake
  persistence plus fresh-tree gates. M30-style live verification
  remains owner-gated, as with every prior batch.
