# Multi-Language MB2 — Acceptance (Merchant Dashboard conversion)

- **Program:** Multi-Language (i18n), master plan `Multi-Language-Master-Plan-2026-10-19.md` §২ (governing laws), §৬ MB2, §৮ D7
- **Batch:** MB2 = STEP-0 + ML4 + ML5 + ML6 — every merchant-dashboard surface converted to the bn/en dictionary; every screen renders 100% in the selected locale (ML-L2), formats follow the language (ML-L3)
- **Worktree / branch:** `~/workspace/ai-marketing-saas-i18n` · `multi-language`
- **Base:** `529380bf` (MB1 complete) → **Final HEAD: `cf1334ad`** (acceptance written at `a566a9d4`; superseded by the reconciliation commit — see Addendum) (tree clean)
- **Migration:** NONE (as planned). No API changes in this batch.
- **Push:** none — local commits only (owner-only push rule).
- **Batch record:** `hidden_files/multi-language-mb2-record.md` (goal workspace); worker reports `hidden_files/mb2-worker-{a,b,c,d}-report.md`, `mb2-finisher-{1,2}-report.md`, `mb2-f3-{alpha,beta,gamma}-report.md`.

## Item-by-item audit

| Item | Status | Evidence |
|---|---|---|
| STEP-0 — `tr()` interpolation helper + Bengali count-classifier pattern + parity-test extension | ✅ COMPLETE | Commit `2d479f95`. `tr(source, locale, path, params)` resolves via lookup (whole-string bn fallback + missing-key log) then interpolates `{name}`; unsupplied params stay visible. `placeholdersOf` parity test pins bn/en placeholder-set equality for EVERY dictionary key. `countWithClassifier(locale, n, {bnSuffix, enOne, enOther, formattedCount})` owns the `${n}টি/জন` divergence (~764 suffix sites). Provider exposes bound `t()` + `count()`. |
| ML4 — dashboard shell, common components, Settings, connections, team, agency (W-A) | ✅ COMPLETE | Commit `0db2a9d5`. Namespaces common 106 / shell 336 / settings 762 / connections 974 / team 293 / agency 73 = 2,544 keys. Nav items carry `labelKey`. `lib/connections.ts` gained locale params; its `formatTakaMinor` kept byte-identical (test-pinned legacy — exception E7). |
| ML5 — Orders, Products/Inventory, Inbox, CRM/Customers (W-B + W-C + F1) | ✅ COMPLETE | Commits `570b1de7`, `f1ae149e`. W-B: commerce 2,868 / orders 1,775 / products 448 / pos 187 / inventory 89 / delivery 40 = 5,407 keys. W-C+F1: inbox 1,059 / messaging 1,179 / crm 645 keys (final counts after F1 deep-panel completion). F1 also fixed real bugs from W-C's regex pass (29 dropped `</button>` tags, a `money(minor, locale)` arg-order bug). |
| ML6 — Ads/Campaigns, Messaging, Automations, Analytics, Courier/Delivery, Billing, Agency + all remaining pages (W-C + W-D + F2 + F3) | ✅ COMPLETE | Commits `f1ae149e`, `a4fea8b5`, `066ef795`, `a566a9d4`. W-D: ads 721 / campaignBuilder 893 / social 1,377 / ai 518 / misc 522 / analytics 232 / billing 155 = 4,418 keys. F2: NEW `shared` namespace (155 keys) + 11 shared libs converted with bn-default locale accessors. F3 (α/β/γ + coordinator): automations/media-library/funnels leftovers, 13 small components, booking/gb6/dropship/accounting/campaign-status/live-selling libs. |
| D7 — blueprint preset data takes `*En` DATA fields, not the dictionary | ✅ COMPLETE | workflow-blueprints: 106 entries × 5 En fields + `badgeEn` ×20; automation-blueprints: 29 × 5 + `badgeEn` ×12; `bpText(item, field, locale)` pickers; pages render by locale. Data catalogues also completed: festival-playbook (161 En insertions), festival-broadcast (47), funnel-builder (85 En companions + pickers), banner-presets (nameEn/labelEn, pre-existing pattern kept), step-fields DYNAMIC_VARIABLES (labelEn + picker). |
| Dictionary assembly (coordinator) | ✅ COMPLETE | Commit `18f5bc0a`. 24 namespace files assembled into `dict.ts`; **15,428 bn keys** total across namespace files (incl. MB1 shop), en mirrors typed `typeof bn`. One pinned design exception: 5 Bengali count-classifier suffix keys are legitimately EMPTY in en (`commerce.text1ou8`, `automations.countSuffixTi`, `crm.audMembersCountSuffix`, `messaging.pushSubscriberSuffix`, `messaging.pushDeviceSuffix`) — allowlisted in `i18n.test.ts` with bn-non-empty/en-empty pinned so the exception cannot silently grow. |

## Commits (9, all local)

| Commit | Content |
|---|---|
| `2d479f95` | STEP-0 — `tr()` + count-classifier + parity extension |
| `18f5bc0a` | Assembly — 24 namespace files into `dict.ts` (+ coordinator dedupe/parse fixes) |
| `0db2a9d5` | W-A / ML4 — shell, settings, connections, team, agency |
| `570b1de7` | W-B — commerce, orders, POS, products, inventory, delivery |
| `f1ae149e` | W-C + F1 — inbox, messaging, CRM, automations, workflows + D7 blueprints |
| `a4fea8b5` | W-D — ads, campaign-builder, AI/social, analytics, billing, misc |
| `066ef795` | F2 — shared-lib mop-up (`shared` namespace) |
| `6ff23e65` | Test fixes — LocaleProvider wraps + bn-digit expectations per BN format spec |
| `a566a9d4` | F3 mop-up — leftover pages/components/libs (α/β/γ + coordinator completions) |

## Gates (all serial, coordinator-run, recorded in the batch record as they finished)

| Gate | Result |
|---|---|
| Targeted i18n vitest (STEP-0 + assembled dictionary parity) | ✅ 15/15 |
| Web tsc after assembly + coordinator fix loop (242 → 0 errors over 5 runs) | ✅ PASS, zero errors |
| Full web vitest (first run) | 24 fails in 4 test files — ALL test-side, adjudicated: converted components now call `useLocale()` so their tests were wrapped in `<LocaleProvider>`; 4 expectations pinned to pre-i18n Latin-digit output updated to the BN format spec (whatsapp-catalog-bot ৳১,২০০/৳২,১০০, connections "২/২ কানেক্টেড", ai-learning ৮৮% / ৭ বার). NO production-behaviour failure found. |
| Full web vitest (after fix commit `6ff23e65`) | ✅ **139 files / 1,140 tests ALL PASS** (MB1 baseline 1,135; +5 STEP-0/parity) |
| Next build (web), pre-F3 tree | ✅ PASS |
| F3 targeted battery (parity, live-selling, booking, dropship, accounting, gb6, campaign-status, banner-presets, social-analytics, theme, shop-social-proof) | ✅ 11 files / 101 tests PASS |
| Web tsc, final tree | ✅ PASS, zero errors |
| Full web vitest, final tree | ✅ **139 files / 1,140 tests ALL PASS** |
| Next build (web), final tree | ✅ PASS |
| API jest / fresh-PG | Not applicable — MB2 contains no API or migration changes (verified: diff is entirely under `apps/web/src`). |

## Scanner before / after (`scripts/i18n-scan.mjs`, MB2 scope = dashboard + components + lib excl. dictionary home)

| Area | Before (529380bf) | After (a566a9d4) |
|---|---:|---:|
| Dashboard files w/ findings | 147 | 57 |
| Dashboard literals (BN+EN) | 7,017 (BN 6,776) | 457 (BN 180) |
| Components literals | 810 (BN 786) | 54 (BN 32 — all in step-fields D7 data) |
| Lib literals | 2,620 (BN 2,586) | 2,124 (BN 1,505 — ~1,190 BN are D7 data sources, below) |
| **MB2 scope total literals** | **10,447 (BN 10,148)** | **2,635 (BN 1,717)** |
| Files w/ findings | 282 | 119 |
| Direct `toLocaleString` calls | 511 | 20 |

Of the remaining 2,635 literals, ~1,773 are D7 DATA catalogues (bn source fields WITH En companions + locale pickers — the scanner counts both halves): workflow-blueprints 722 BN/288 EN, festival-playbook 175/127, automation-blueprints 151/81, funnel-builder 85/52, festival-broadcast 57/30, banner-presets 17/5. The EN-literal column is a heuristic upper bound (it also counts English source data, brand names and code strings in converted files); the BN column is the meaningful axis.

## Remaining exceptions (explicit — everything the scanner still flags in MB2 scope, classified)

- **E1 · D7 data catalogues** (above): bn source fields with En companions, rendered via locale pickers. By design (plan §৮ D7).
- **E2 · workflows/page.tsx (89 BN, 2 toLocaleString):** trigger/quick-create/condition catalogues keyed BY their bn labels (bn string → dictionary-key maps); every rendered label resolves through the dictionary. The 2 `toLocaleString` calls sit in the same catalogue code. Restructuring the keying is a behaviour-risk refactor deliberately not taken in this batch.
- **E3 · messaging/page.tsx (41 BN):** 6 module-level bn consts that are the bn SOURCES of `…For(locale)` accessors, wired at render (F1-verified). Never rendered raw in en mode.
- **E4 · components/step-fields.tsx (32 BN):** DYNAMIC_VARIABLES bn source data with `labelEn` companions + locale picker (D7 pattern).
- **E5 · Customer-content templates (merchant→customer messages, MB4/MB5 scope per ML-L5):** abandoned-tier-chase / abandoned-chase chase-message defaults, gamified-promotions shopper game labels, live-selling seed product names + comment-parser keyword regexes + Bengali-digit map (input parsing data), whatsapp-bot Bengali keyword matchers (customer-input matching), campaigns-page preset campaign templates (name/description content a merchant picks — no En companions yet; see NOT BUILT).
- **E6 · social-post-insights.ts (43 BN, 1 toLocaleString):** metric definitions carry bn labels WITH En companions (`chipLabelEn`/`totalLabelEn`) + picker; remainder is bn doc comments.
- **E7 · Legacy bn format helpers + test-pinned formats (20 toLocaleString total incl. E2/E6):** `lib/money-bn.ts`, `lib/rel-time-bn.ts`, `lib/inbox-format.ts`, `lib/storefront-money.ts`, `lib/pos-closing.ts`, `lib/shop-social-proof.ts`, `lib/loyalty.ts formatPaisaNumber`, `lib/ab8.ts`, `lib/connections.ts formatTakaMinor`, `lib/campaign-step-shell.ts`, `lib/app-offers-nf14.ts`, `lib/influencer-campaign.ts`, `lib/rider-gps.ts` (bn relative-time for tracking surfaces), plus 1 call each in hr/comments pages. These ARE formatters (their job is bn output) or are pinned byte-identical by tests; new code uses `@repo/contracts` fmt*. Consolidation is MB6-gate work.
- **E8 · API-pinned legal constants:** `DROPSHIP_PAYOUT_NOTE` (dropship-nf12) and `ACCOUNTING_DISCLAIMER` (accounting-nf10) stay as single-home constants in their libs, byte-identical to the API's strings (vitest-pinned both sides); deliberately NOT duplicated into the dictionary.
- **E9 · Sample/simulator data:** social-selling live-simulator sample comment/author/store defaults; competitors-page sample input defaults ("দারাজ বাংলাদেশ" etc.); creative-studio tone options (label/labelEn pairs, E1 pattern); banner-studio headline presets + editable copy defaults (merchant content).
- **E10 · Small lib remainders (~50 BN):** `gb6-team.ts` labelBn/label pairs (E1 pattern), `warehouse-ab3.ts`, `live-commerce.ts`, `social-posts-su5.ts`, `ai-prompts.ts` (AI prompt text = content), `influencer-campaign.ts` — label pairs, template/prompt content, or niche helpers whose consumers render through already-converted pages; none are dashboard chrome strings.
- **E11 · Dashboard `loading.tsx` files (5):** server components render via `getDict("bn")` (no LocaleProvider exists in the loading boundary) — bn-only by construction; revisit if the loading boundary gains locale resolution.
- **E12 · access-catalog `noteBn`:** the connections access-catalog API payload carries a bn-only note field with no EN counterpart — API/data-side, MB4 scope.

## NOT BUILT / partial (no silent gaps)

1. **Screenshot / visual QA: NOT DONE — not possible in this environment.** No screen is claimed visually verified in either locale. Conversion is proven by the dictionary/parity tests, the full suite, tsc, the production build, and the scanner — not by looking at rendered screens. A logged-in visual pass over the dashboard in both locales remains owed (post-deploy or local run).
2. **Campaign preset templates (campaigns page) have no En companions** — in en mode those preset names/descriptions (merchant-picked content) still show bn. Classified as D7-class data (E5); adding `*En` fields is a small follow-up if the owner wants presets bilingual.
3. **Blueprint search matches bn fields only** (W-C leftover): searching blueprints by English text does not match `problemEn` etc. yet.
4. **Blueprint `steps[]` template content** is bn source data (message/step templates a merchant adopts) — content, not UI (ML-L5); not translated.
5. **API-returned strings** (server error/notice text surfaced verbatim) are MB4 scope, untouched here.
6. **Org-switch locale re-resolution** inherits MB1's known limit (staff preference → org default → bn resolution timing on switch).
7. **Amount formatting inside gb6 segment summaries** uses the pre-existing `minorToTaka` (Latin digits) inside summary sentences in both locales — bn output byte-identical to before MB2; routing it through `fmtMoney` is a behaviour-change decision left for a later batch.
8. **Admin app, storefront/public surfaces, API/notifications/documents, AI unification** are MB3–MB6 scope and untouched by this batch (scanner "other-web" area unchanged at 1,145 literals, as expected).

## Addendum — post-acceptance reconciliation (commit `cf1334ad`)

The F3 finisher round ran overlapping duplicate agents in the same worktree (their full handoffs arrived after the acceptance was written). The losing agent had appended **259 bn/en key pairs** (shell `tt*/pw*/f3Ga*`, ads `cs*/funPrev*`, misc `bk*/ds*/acc*/sp*/lr*/ri*/pr*`, crm `gb6*`, social `mlSurf*/ls*/sa*`, ai `air*/mp*/pp*`, analytics `rg*/as*`) that no component or lib ever referenced — every consumer uses the winning twin sets (`shared zz*`, crm `zzBook*/zzGb6*`, billing `zzDrop*/zzAcct*`, analytics `zzCamp*`, misc `f3Ml*/zzFunnel*`). A coordinator audit (literal + word-boundary reference checks across `apps/web/src`) verified each set as dead, and they were removed, restoring ML-L1's one-string-one-home for those strings. Dictionary now holds **14,451 bn keys** by the audit count. The same commit wires `locale` into the customers page's `segmentCriteriaSummary(s.criteria, locale)` call (F3b follow-up; bn output was unaffected). Gates re-run on the reconciled tree: targeted parity/gb6 ✅ 29/29 · web tsc ✅ zero errors · full web vitest ✅ 139 files / 1,140 tests · next build ✅ PASS. **Final HEAD is now `cf1334ad`.** Known remainder: ~140 further unreferenced keys from the main worker rounds (single-home dead entries, e.g. parts of inbox/messaging/common) were deliberately left — they are not duplicates, have no runtime effect, and bulk removal risks dynamic key construction; they are a safe future cleanup.

## Process notes (for the record)

- Workers ran in parallel with disjoint file ownership and did not commit; the coordinator reviewed diffs, assembled `dict.ts`, ran all heavy gates serially, and made the per-item commits. Two finisher rounds (F1/F2) closed documented leftovers; the F3 round required repeated re-dispatch (early worker terminations with delayed edit flushes) and substantial coordinator completion/repair — all detailed in the batch record. Every gate number above was reproduced by the coordinator on the final tree.
