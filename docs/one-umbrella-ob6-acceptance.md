# OB6 Acceptance — OU12 + OU9 + OU11 (One-Umbrella FINAL batch)

**Worktree:** `~/workspace/ai-marketing-saas-ou` · **Branch:** `one-umbrella`
**Base:** `f46b5e7e` (OB5 close, verified clean) · **Final HEAD:** see git log (docs commit on top of `a841ad0e`)
**Local commits only — NO GitHub push.** 18 code commits + section docs in this batch.
**Migration claims:** `20261024000000` (OU12 consent), `20261024010000` (OU12 backup verification), `20261024030000` (OU11 legal gate). OU9 claimed none.
**Section docs:** `one-umbrella-ou12-section.md` · `one-umbrella-ou9-section.md` · `one-umbrella-ou11-section.md`
**Coordinator spot-check (serial, final tree):** OU11 legal-gate + OU11 affiliate + OU9 GBP suites re-run by the coordinator — **3 suites / 51 tests PASS** (12+8+31, matching worker records). Migration directory count 222 = OU11 fresh-PG record 222/222.

---

## OU12 — Subscription auto-charge + backup restore

### Step-0 headline evidence
- `CustomerSubscription`: staff-created only, no consent/token field, no storefront self-serve flow; sweep creates COD `pending` orders; failureCount≥5 auto-pauses. A customer never had any surface on which to consent to future charges.
- bKash tokenized: an integrated tokenized **charge** path exists ONLY for platform billing — `PaymentsService.chargeAutoRenew` (agreement create/execute/cancel, mode `0001`, activates only on `Completed`, wired to the `auto_renew` job; payer = tenant org, merchant = platform, platform config/seal, org-level `AutoRenewAgreement`). The shop side has NO agreement/charge method (`TenantGatewayClient` = initiation mode `0011`, execute, query, refund, search), no per-customer agreement storage, no shop callback — and even the platform path is sandbox-unverified by its own code comments. Wiring a shop charge would have meant building a new unverified payment integration and calling it existing. **Not done.**
- Backups: there is no `OrgBackup` model; a backup is a `DataExport(kind=backup)` whose READY file is a `{manifest, data}` JSON safe-subset (credentials never exported, media metadata only, members depend on global Users, payments are billing record-of-truth, all ids are source-org ids, truncation possible). No bundle import machinery exists. The bundle does not round-trip by design.

### Shipped
- **Consent capture** (migration `20261024000000`): at creation or via `POST …/subscriptions/:id/auto-charge-consent` — staff-attested consent with server timestamp + method (required) + note; contradictory input refuses; withdraw clears. Serialized view carries literal `chargingActive: false` + label **"auto-charge ready — চার্জিং এখনো চালু নয়"**; web form warns plainly that charging is NOT active and renewals stay COD. Specs prove: no consent → manual flow untouched; sweep attempts zero charges and marks nothing paid even with consent recorded.
- **Backup verification, explicitly NOT a restore** (migration `20261024010000`): OWNER-only `POST …/data-exports/:id/verify-backup` with exact org-slug confirmation checked before the file is read; read-only integrity check (status/expiry, bytes present + valid JSON, manifest-vs-data counts, truncated tables, non-restorable sections with reasons); result recorded on the row + audit; every outcome reports `restoreSupported: false`. Settings card action with the plain note "যাচাই মানে restore নয়". No pre-restore safety export was built because nothing is ever overwritten — rationale recorded in the section doc.

### NOT BUILT (with unblock conditions, in the section doc)
1. Real shop auto-charge — needs a tenant-side bKash agreement lifecycle + per-customer sealed token storage + sandbox verification.
2. Backup restore — needs an id-remapping import engine; the approved Organization-Next program's ORG16 (bundle import/restore) is its natural home; deliberately not duplicated here.
3. Customer self-serve consent; any live proof.

### Gates (worker, serial)
Subscriptions 16/16 · data-tools 28/28 · automation 83/83 · API tsc clean · web vitest 905/905 + tsc + build green · **fresh-PG 221/221**.

---

## OU9 — Google Business Profile (GBP only; X/Pinterest stay OUT per plan §6)

### Step-0 headline evidence
- GBP already existed as a Connect Center integration (CC20, provider `google_business`) — a different row family; OU9 added the SocialAccount family (`google_business_profile`) the publisher dispatches on, following the YouTube/Threads OAuth skeleton and `effectiveGoogleAppConfig`.
- Official Google docs (fetched, cited in section doc): Business Profile API access is per-project application + approval (quota 0 QPM = unapproved, 300 = approved); LocalPost create = `POST mybusiness.googleapis.com/v4/accounts/*/locations/*/localPosts` (STANDARD body, LEARN_MORE CTA, one PHOTO by sourceUrl); v1 location listing composes into the v4 parent.

### Shipped (7 commits, no migration)
- Approval gate `gbpApiAccessApproved` on the operator Google config (stored literal true only, env fallback, default false) carried through admin API + Admin Console checkbox.
- Connect flow: `business.manage` OAuth (offline + consent, refresh token required); 1 location → instant connect; many → sealed `location_pick` picker; zero → honest error; Google's location-list refusal surfaces verbatim. Own-app path uses GBP's own derived redirect URI, never YouTube's.
- Publishing: gate checked FIRST — refusal is a permanent publish error with the plain-words gate message, spec-proven to make zero token/Google calls; approved path does one documented v4 localPosts create, storing Google's resource name + searchUrl. Pre-flight: caption required, no video, max 1 image.
- Web: gate banner in plain words (EN headline + Bengali explanation), location picker, per-account honest note.

### NOT BUILT (flags literal-false in `GBP_CAPABILITIES`)
Reviews / review replies, inbox/comments/insights/health probe, EVENT/OFFER/ALERT posts, video/multi-media posts, post edit/delete, location editing, and ALL live proof (Google's approval is an owner/operator application — checklist in section doc, fully unchecked).

### Gates (worker, serial)
OU9 spec 31/31 · social module 37 suites 697/697 · admin+common 387/388 (sole failure `adx3-nav-counts`, base-proven at `b7ea0f89`) · API tsc clean · web 111 files 905/905 + tsc + build green · admin tsc + build green.

---

## OU11 — Payout automation, LEGAL GATE ENCODED

### Step-0 headline evidence
- `adminMarkPaid` is the single ledger-debit point for wallet payouts; four-eyes is enforced there (approver blocked at/above threshold, second admin completes). Affiliate payouts are FIFO bookkeeping via EC32 `recordPayout`.
- bKash disbursement is NOT evidenced anywhere (in-repo clients are checkout-only: grant/create/execute/query/refund/search) → the bank-instruction rail is the honest v1, per brief.

### Shipped (migration `20261024030000`)
- **Legal gate (service layer, fail-closed):** `PayoutLegalGate` singleton — a SUPER records the legal-review confirmation (confirmedBy/confirmedAt/reference REQUIRED, audited); a separate automation switch (default OFF) that refuses to enable without a confirmation; revoke clears both. State is read from the DB on every call, so closing it mid-flight stops the next attempt (spec-proven). Enforcement covers EVERY execution entry point (wallet + affiliate, issue/confirm/fail) with distinct refusals for (a) no confirmation recorded vs (b) switch off. **Manual mark-paid is explicitly NOT gated** (code comments + UI text + spec proof + this doc).
- **Bank-instruction rail:** instruction issues ONLY from an APPROVED payout (one row per request; duplicate issue returns the same instruction); instruction CSV export for the operator; confirmation completes ONLY through the existing `adminMarkPaid` (bank reference = payoutRef; four-eyes preserved) — duplicate confirm converges with exactly one debit; failure records the reason, the request stays approved, no ledger row is written, and the payout is retryable.
- **Affiliate payouts on the same rail + gate:** only APPROVED outstanding amounts are executable (pending never counts); open instructions reserve amounts (no joint overdraw); confirm creates exactly one `AffiliatePayout` through the shared extracted `applyFifoFlip` (same bookkeeping as `recordPayout`, which itself is unchanged and NOT gated); outstanding re-validated at confirm.
- Admin web: LegalGateCard (state badge, recorded confirmation detail, SUPER confirm form, ON/OFF switch, revoke; text states the record does not replace the review) + per-row execution actions on the Wallet Payouts page.

### NOT BUILT
Any provider disbursement client (unevidenced — building one would be fabrication), auto-issue/auto-confirm scheduling, tenant-web affiliate execution UI (API complete), any change to manual processes, any live proof. **The legal review itself is an owner action — the code gate records it, it does not replace it** (owner checklist in the section doc).

### Gates (worker, serial)
OU11 specs 12/12 + affiliate 8/8 · connections 389/390 · affiliates 35/35 · admin 244/245 · API tsc clean · admin tsc + next build green · **fresh-PG 222/222**, both new tables verified. The 2 failures are pre-existing and base-proven: `cc26` sweep spec (fails identically with base wallet.service restored; date-dependent fake pinned to 2026-10-15) and `adx3-nav-counts`.

---

## Live checklist (ALL UNCHECKED — owner actions)
- [ ] OU12: tenant bKash agreement lifecycle + sandbox verification before any real auto-charge work is re-scoped
- [ ] OU12: backup restore only via a future id-remapping import engine (ORG16 home)
- [ ] OU9: apply to Google for Business Profile API access for the platform project; tick `gbpApiAccessApproved` only after Google actually approves; register the GBP redirect URI; one real location post end-to-end
- [ ] OU11: complete the wallet legal review with a real reviewer; record it in the LegalGateCard (SUPER) with the memo reference; only then enable the automation switch; first bank-instruction payout executed at the bank and confirmed with the bank reference
- [ ] Whole OU line: union release + Dokploy Redeploy + M30/EC12/TD12 live sessions (see program summary)
