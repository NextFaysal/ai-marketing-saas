# OB5 Acceptance — One-Umbrella Batch 5 (OU7 Finance accounting-lite + OU8 Storefront freedom)

- **Program:** One-Umbrella (OU0–OU12, owner approved in full 2026-10-16). Plan: `One-Umbrella-Master-Plan-2026-10-16.md`.
- **Worktree / branch:** `~/workspace/ai-marketing-saas-ou`, branch `one-umbrella`. **Local commits only — NO GitHub push.**
- **Base:** `c3ad9d2e` (OB4 complete, tree clean at start) → **Final HEAD:** `c2a15f7b` + this doc commit.
- **Per-package docs:** [one-umbrella-ou7-acceptance.md](one-umbrella-ou7-acceptance.md) (OU7) · [one-umbrella-ou8-acceptance.md](one-umbrella-ou8-acceptance.md) (OU8) — full Step-0 findings, shipped audits, NOT BUILT lists and live checklists live there; this doc is the batch consolidation.
- **Migration claims:** `20261023000000_ou7_accounting_lite` (OU7) · `20261023100000_ou8_storefront_freedom` (OU8). Full migration union now **219**.
- **Coordinator verification:** final HEAD + clean tree re-checked directly; spot-check re-run of OU7 finance + OU8 spec suites on the final tree: **5 suites / 53 tests passed**.

## Commits (base → final)

| Commit | Item |
|---|---|
| `ebaec6d4` | OU7 schema + migration `20261023000000` (FinanceAccount, JournalEntry, JournalLine, BankStatementLine — new tables only) |
| `8a34e8bc` | OU7 accounting core + bank recon + controller + spec (15/15) |
| `6f4b91ce` | OU7 web: finance hub "📒 হিসাব (জার্নাল)" tab |
| `708d5ba8` | OU7 acceptance doc |
| `d2095b51` | OU8 schema + API: section fields + lead-popup mode + ticket token/public view (migration `20261023100000`) |
| `6933c893` | OU8 web: warm/ocean themes, section customizer, ShopPopup lead form, `/ticket/track/[token]` |
| `c2a15f7b` | OU8 acceptance doc |

## OU7 — shipped (detail: ou7 acceptance doc)

- **Step-0:** GC20 finance was expenses + ledger VIEWS + GL export — no persisted journal/CoA/bank-recon existed. OU7 reuses the GC20.5 GL-export account mapping **verbatim** (no second mapping). One documented deviation: the journal is two-step (sale → receivable, payment → settlement); the GL export file itself is unchanged.
- **Chart of Accounts:** per-org seeded default CoA, listable via API, posting-rule → account mapping visible in code.
- **Derived journal:** posting rules for sale, payment_gateway, payment_manual, courier_settlement, gateway_fee (only when `feeMinor` is recorded), refund, expense — every rule balanced, idempotency-keyed per source with a unique DB index as backstop (spec: 7 posted → re-run 0 new / 7 alreadyPosted). Posting-status view lists unposted sources with honest reasons (gateway_deposit advances are not double-posted; amount-less refunds and amount-mismatched settlement lines are unpostable, stated as such).
- **Manual entries:** OWNER/ADMIN only, audit-logged, marked `manual`, server-side balance enforced (unbalanced refused — spec-proven).
- **Reports from journal lines only:** trial balance + balance sheet (spec hand-checked fixture), periods honestly labelled open/reporting-only, link to the existing profit (P&L) report. No fake period locking.
- **Bank reconciliation:** CSV import (date/description/amount[,reference], signed taka), suggestion-only matching (exact amount + ±7 days), human confirm is the only way to match, unmatch reverts, all audited. Nothing auto-confirms — spec-proven.
- **Web:** "📒 হিসাব (জার্নাল)" tab on the existing finance hub — posting status + post run, journal view, manual entry form, TB/BS, CoA list, bank import + confirm/unmatch UI (Bengali labels).

## OU8 — shipped (detail: ou8 acceptance doc)

- **Step-0 corrections:** this tree has TWO popups, not one — StorePopup (GB1 promo, real impression/click counters) + SocialProof (AX17); OU8 extended StorePopup, social proof untouched. SupportTicket is the PLATFORM ticket system (tenant↔admin) with a real `isInternal` distinction; there is NO shop-customer ticket system and NO inbox→ticket conversion in this tree. **Bug found & fixed:** the settings DTO allowed only `classic|bold|minimal` theme ids — v2 could be previewed but never saved; DTO now accepts all 6.
- **Themes:** `warm` + `ocean` — both token-native full ShopTheme records (unique hero classes spec-asserted; the old 4 presets' byte-pins untouched). Gallery now has 6 honest presets.
- **Section customizer:** 5 toggles (`showHero/Brands/Bundles/FlashSale/RecentlyViewed`) + `sectionOrder` on StorefrontSetting; the shop home renders exactly `orderedVisibleSections(...)` from `lib/shop-sections.ts`; dashboard ↑/↓ editor. NO drag-drop builder. The product grid is deliberately not hideable — documented in the doc.
- **Marketing popup:** StorePopup `mode promo|lead` (promo path byte-identical); a captures-nothing lead config is refused at save; the shop form posts to `POST /public/shop/:slug/popup-lead` → real `Lead` (source `website`, stage `new`) + `created` LeadActivity through the existing lead machinery; `captures` counts only real Lead creations.
- **Ticket tracking:** signed-token pattern reused verbatim from MS2 `unsubscribe-token.ts` (HMAC-SHA256, purpose `ticket-track`, 90d). Public `@Public` GET/POST `/public/tickets/track/:token(/reply)`; internal notes are filtered at the query and the spec scans the full serialized payload for internal text + diagnostics; customer replies land as `authorKind:"customer"`, public, and reopen resolved tickets. Served population = tenant-created tickets; the link is issued on demand from the dashboard ticket view ("ট্র্যাকিং লিংক কপি") — ticket creation sends no notification today and none was invented.

## Gates (recorded per package; heavy gates serial)

| Gate | OU7 | OU8 |
|---|---|---|
| New specs | 15/15 | 14/14 |
| API touched regression | finance 39/39 (3 suites) | storefront+support 32 suites 421/421 |
| API tsc | clean | clean |
| Web vitest | finance-gb8 12/12 | FULL 111 files, 905/905 |
| Web tsc | clean | clean |
| Web build | passed | green (`/ticket/track/[token]` in output) |
| Fresh-Postgres full run | 218/218 | 219/219 applied, 0 unfinished, 12 OU8 columns verified |
| Coordinator spot-check (final tree) | colspan: OU7 finance + OU8 suites re-run together: 5 suites / 53 tests passed | |

Known base-proven pre-existing failures (cc26, adx3-nav-counts, gb9-public-docs) were not encountered in the touched areas of either package.

## NOT BUILT (consolidated; per-package lists are authoritative)

**OU7:** payroll-lite register (salaries already post via the expense rule to `Expense: salary`; a parallel register would break the one-source discipline — lowest-harm gap, recorded decision); PaymentRefund as a posting source and WalletTransaction posting (double-count risk against the returns/gateway rules); period close/locking (not faked); opening-balance/history import (a manual Dr Cash / Cr Owner Equity entry is the supported path); bank formats beyond the documented CSV; native Tally/QuickBooks files (never claimed); auto-post / auto-confirm scheduling.

**OU8:** drag-drop page builder; new section types; hiding/reordering the product grid or header/footer; per-page (non-home) section control; popup A/B testing, multi-popup, audience targeting; lead dedupe on popup submit; a shop-customer ticket system; ticket creation / attachments / CSAT via the public page; auto-emailing the tracking link; tracking-token revocation; screenshot/visual QA of the new themes.

## Live checklist (owner-gated, ALL UNCHECKED)

Per-package checklists (OU7: 7 items; OU8: deploy + real-shop theme/section/lead/ticket checks) are in the package acceptance docs. Nothing in OB5 is live-proven: deploy needs the later union release on the owner's push instruction + his Dokploy Redeploy, then a real org's finance posting run and a real shop's theme/popup/ticket walk must be observed before any live claim.
