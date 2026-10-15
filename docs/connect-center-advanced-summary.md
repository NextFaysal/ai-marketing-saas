# Connect Center Advanced — Package Summary (CC11–CC20)

Branch `cc-advanced`, worktree `~/workspace/ai-marketing-saas-adv`, base = integration-2
HEAD `21dec09` (the CC1–CC10 line, later released in GitHub main `7443135` — this
Advanced package is **not** in that release). **Local commits only — never pushed.**
Per-batch acceptance docs: `connect-center-b6-acceptance.md` (B6),
`connect-center-b7-acceptance.md` (B7), `connect-center-b8-acceptance.md` (B8),
`connect-center-b9-acceptance.md` (B9). The base package summary is
`connect-center-package-summary.md` (CC1–CC10).

## Status — CC11–CC20, ALL CODE-COMPLETE

| Item | Batch | Status | One-line truth |
|---|---|---|---|
| CC11 Connection Doctor | B6 | ✅ code-complete | Live diagnostics over existing provider clients; kinds with no real check report `not_checkable` — no fabricated pass |
| CC12 Monitoring sweep + alerts | B6 | ✅ code-complete | Per-org `connection_health_sweep` job; state-change-only alerts (7/3/1-day thresholds), in-app + email, preferences/snooze |
| CC13 Unified activity/error timeline | B6 | ✅ code-complete | Per-target timeline from real records only |
| CC14 WhatsApp deep health | B7 | ✅ code-complete | Verbatim Graph snapshots (quality_rating / messaging_limit / WABA review); absent stays absent |
| CC15 Meta asset completeness | B7 | ✅ code-complete | IG-linked / Pixel / Catalog checks with unknowns staying unknown; ad payment-on-file as BOOLEAN only |
| CC16 Commerce diagnostics + repair | B7 | ✅ code-complete | Stored webhook record per topic + REAL re-register via EC2 registrars (partial stays partial); Shopify scope diff lists only genuinely missing scopes |
| CC17 Labels / groups / member access | B8 | ✅ code-complete | Free-text label/groupName (no Group entity); `Membership.deniedConnections` enforced server-side on human inbox sends + social create/schedule/publishNow; OWNER never denied |
| CC18 Sync pause / schedule / history | B8 | ✅ code-complete | `Integration.syncPaused` enforced at the Woo/Shopify sync entry; NO per-connection schedule UI — the job system supports per-org enablement only, and the UI says why |
| CC19 Payment depth | B8 | ✅ code-complete | Gateway environments live/sandbox (production resolution live-only; sandbox IPN can never pay an order or credit a wallet); txn history + IPN viewer; wallet statement CSV/PDF; buyer Pay-online + staff Collect buttons |
| CC20 Smart assistant + Google pack + LinkedIn + marketplace verdicts | B9 | ✅ code-complete | Assistant findings from real rows only (8 rules + 1 deliberately omitted for having no real linkage field); GA4/Merchant/Business OAuth with SP9 pick flows, platform-app only; LinkedIn Page connect + UGC text/link publishing; TikTok Shop + Daraz closed as evidence-based NO-BUILD notes |

## Final gate evidence (B9 tree, HEAD after B9 commits)
- API jest FULL: 313/314 suites, 3101/3102 tests (sole failure = the known
  cx3-debounce intermittent flake; solo 18/18 ×2 on the identical tree).
- Web vitest FULL: 259/259. Admin: tsc 0 + build green. tsc 0 in api/web/admin.
- Fresh-Postgres migration sequence: **150/150 clean** (195 tables).
- Web next build: green. Prisma schema: valid.

## DEPLOY CHECKLIST — the whole Advanced package (NONE of this is done yet)

1. **Owner-gated release steps first**: integrate `cc-advanced` into the release
   line (union fresh-PG sequence re-verified at integration), push ONLY on the
   owner's explicit instruction, then the owner's manual Dokploy Redeploy.
2. **Migrations — none run on any real DB.** Advanced adds 5 migrations on top of
   the released 145-folder union:
   `20261013310000` (B6 health checks/alerts) · `20261013320000_cc14_provider_health`
   (B7) · `20261013330000_cc17_labels_groups_access` (B8) · `20261013340000_cc19_payment_depth`
   (B8) · `20261013350000_cc20_assistant` (B9). Run the full pending sequence on
   the real DB at deploy (fresh-DB proven 150/150; the real, data-bearing DB has
   never run them).
3. **Per-org job enablement**: enable `connection_health_sweep` per org (CC12
   monitoring/alerts + Doctor-in-sweep stay inert until enabled; alert
   preferences/snooze live in the Connect Center's alerts panel).
4. **Admin setup — LinkedIn**: Platform Config → LinkedIn App: Client ID/Secret
   (+ optional Redirect URI); register
   `https://api.qosprey.com/social/oauth/linkedin/callback` in the LinkedIn app;
   use 🧪 যাচাই করুন (client-auth probe only). **Separately apply for LinkedIn's
   Community Management API approval** — without it, LinkedIn Page posting will be
   refused by LinkedIn (verbatim error shown to tenants); connecting works.
5. **Admin setup — Google pack**: on the EXISTING Google App, register the three
   additional redirect URIs (`…/social/oauth/google-ga4/callback`,
   `…/google-merchant/callback`, `…/google-business/callback`) and enable the
   Analytics Admin API, Merchant API and Business Profile APIs in Google Cloud.
6. **M30 live proof is owed for EVERY Advanced surface** — none has touched a
   real account: a Doctor run against real connections, a real monitoring alert
   cycle, real WhatsApp/Meta health snapshots, a real store webhook re-register,
   real sandbox + live gateway payments (own + platform), a wallet statement
   against a real ledger, the assistant firing on a real tenant's gaps, real
   GA4/Merchant/Business connects, and a real LinkedIn connect + (post-approval)
   publish. Until then every Advanced surface is fixture-proven only.
7. **Standing CC10 note (not engineering)**: the operator's legal/policy review
   for holding tenant funds in the Wallet remains the operator's responsibility.

## Honest limits carried by the package
- No Advanced migration has run on a real DB; no Advanced surface is deployed
  or live-proven; TikTok Shop and Daraz remain NO-BUILD by evidence (verdicts
  and revisit triggers are shown in the Connect Center itself); LinkedIn
  publishing is additionally gated on LinkedIn's own app review; the wallet
  statement PDF is ASCII-only by declaration (CSV is lossless).
