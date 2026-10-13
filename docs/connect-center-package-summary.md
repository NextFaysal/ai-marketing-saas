# Connect Center Package Summary — CC1–CC10 (2026-10-13)

**THE CONNECT CENTER PACKAGE IS CODE-COMPLETE.**

Owner request 2026-10-13 14:04 +06, approved in full 14:07 +06
("পুরো Connect Center (CC1–CC10) অনুমোদন — Platform Payment +
Wallet-সহ, B1 থেকে শুরু করো"). Plan:
`~/workspace/goals/ai-marketing-saas-platform-build/files/Connect-Center-Plan-2026-10-13.md`.
Built in worktree `~/workspace/ai-marketing-saas-cc`, branch
`cc-package`, base ec-phase2 `d2e66fc`. **Local commits only —
NOTHING pushed** (owner's push rule: every push triggers a
Dokploy rebuild; the push waits for his explicit instruction).

One location — `/dashboard/connections` — where every tenant
connects ALL accounts and sees real status: multiple accounts
per provider, two app paths (tenant's own app OR the platform's
app), WooCommerce / Shopify / couriers / messaging channels /
senders / AI keys on the same page, and payment in two paths
(tenant's own gateway, CC9; platform gateway + Wallet, CC10).

## Status table

| Item | Scope | Status | Acceptance |
|---|---|---|---|
| CC1 | Connect Center shell: overview aggregation API (real rows only, credential rows never queried) + `/dashboard/connections` Bengali page + category cards with status/lastSync/lastError/health | ✅ code-complete | b1 |
| CC2 | Multi-account hardening: messaging connects keyed by (org, provider, externalAccountId) with in-place credential refresh, Integration.isDefault, per-account set-default + disconnect (siblings untouched) | ✅ code-complete | b1 |
| CC3 | Tenant's OWN app configs (TenantAppConfig, sealed secret): Meta verify-before-save via real Graph app lookup (failure saves nothing); TikTok saved honestly as "configured" (no pre-OAuth credential check exists); `appSource (platform|own)` on Integration + SocialAccount | ✅ code-complete | b2 |
| CC4 | Own-vs-platform app paths in connect flows: Meta own-app connect + webhook verification with the tenant secret unchanged; TikTok OAuth own-path uses the tenant client key; YouTube/Google platform-only (stated) | ✅ code-complete | b2 |
| CC5 | Commerce connect forms inside the Center: CommerceConnectPanel extracted verbatim and shared with the integrations page (old page a thin wrapper, nothing removed); Woo/Shopify multi-store as before | ✅ code-complete | b3 |
| CC6 | Courier forms inside the Center (Steadfast/Pathao/RedX coexist, default via set-default, live test only where a real read endpoint exists — Pathao stores / RedX areas; none invented for Steadfast) | ✅ code-complete | b3 |
| CC7 | Messaging channel forms inside the Center (exact inbox shapes incl. appSource; Telegram keyed by verified bot id from getMe; Email keyed by IMAP/SMTP-proven mailbox; reconnect refreshes in place, second bot/mailbox coexists) | ✅ code-complete | b3 |
| CC8 | Senders + AI in the Center: sender forms via the EXISTING MS4 endpoints (no duplication); per-org LLM key (OrgLlmConfig, verify-before-save via a real minimal completion; LlmFactory.forOrg — tenant key wins) wired into chat, 8 inbox-AI sites, ai-instructions, MS9, vision, reports, creative studio, proposals, social AI (NOT wired, listed honestly: campaigns ×2, competitors ×3 + review-miner + video-deconstructor, workflows ×1 — still platform LLM) | ✅ code-complete | b4 |
| CC9 | Tenant's OWN payment gateways: bKash REAL grant-token verify (failure saves nothing); SSLCommerz/Nagad honestly "configured" (no pre-transaction check exists); Rocket refused to the manual BusinessProfile path; Nagad checkout initiation refuses honestly (no API checkout wired). Initiation records "initiated" + real redirect; the order is marked paid ONLY by a server-side verified IPN (SSLCommerz signature + validation API tran/amount/currency/store match; bKash execute/query Completed + exact amount), exactly once, idempotent | ✅ code-complete | b4 |
| CC10 | Platform Payment + Wallet: PlatformPaymentEnablement (no tenant secret), platform checkout via the PLATFORM's SSLCommerz/bKash only (Nagad/Rocket honestly never offered), verified-only wallet credit in ONE transaction (payment_credit gross + fee_debit at the CURRENT admin walletConfig feeBps, default 0), append-only ledger, payout holds (available = balance − Σ pending/approved), admin approve/reject/mark-paid (payout_debit exactly once, overdraw-proof), admin adjustment (note + actor mandatory), tenant + admin web surfaces | ✅ code-complete | b5 |

Per-batch final gates at completion: B1 API 2704/2704, web
213/213 · B2 API 2721/2722 (the one failure is the known
cx3-debounce flake, passed solo on identical code), web 215/215 ·
B3 API 2727/2727, web 224/224 · B4 API 2749/2749, web 230/230,
migration sequence 134/134 · B5 API 2762/2762, web 234/234,
admin build green, migration sequence 135/135, tsc 0 everywhere,
prisma valid, next build green. Full detail in
`docs/connect-center-b{1..5}-acceptance.md`.

## Deploy checklist (ALL still open — nothing below has happened)

1. **Owner's explicit push instruction first** — then, per the
   standing lesson, `ls-remote` + fetch GitHub main BEFORE any
   sync (the owner also pushes directly; his commits are merged,
   never overwritten, never force-pushed), integrate cc-package
   with the then-current main, and re-run the full gate +
   fresh-DB migration sequence on the integrated tree.
2. **Run ALL FOUR CC migrations on the real production DB** —
   none has ever run on any real DB:
   - `20261013210000_cc2_multi_account`
   - `20261013220000_cc3_tenant_app_config`
   - `20261013230000_cc9_tenant_payment`
   - `20261013240000_cc10_platform_wallet`
   (The CC migration range is 20261013210000–20261013240000;
   B3/CC5–CC7 and CC8's endpoints beyond the CC9 migration needed
   no further schema.) They are fresh-Postgres sequence-verified
   (135/135 on the cc tree), never applied to production data.
3. **Admin must configure, in the Admin Console:**
   - Platform gateways for CC10 (Settings & Config →
     SSLCommerz / bKash platform credentials) — until then the
     tenant UI honestly shows those providers as unavailable.
   - `walletConfig` feeBps (Settings → Wallet fee card) — until
     set, the fee is 0.
   - Gateway-side URLs on the PLATFORM merchant panels:
     SSLCommerz IPN URL `…/public/tenant-payments/sslcommerz/ipn`
     and the bKash callback as coded (`…/public/tenant-payments/bkash/callback`)
     — tenant-payment routes, distinct from the SaaS-billing
     `/public/payments/…` routes.
4. **Manual Dokploy Redeploy** after the push (deploy still needs
   it; push-to-deploy must not be assumed working), then the
   standard post-deploy health checks (api /health, app, admin).
5. **M30 live verification — still owed for EVERY provider.**
   Nothing in this package is live-proven: no real Meta/TikTok
   app or account, no real Woo/Shopify store, courier account,
   SMTP/SMS sender, LLM key, tenant gateway (SSLCommerz/bKash),
   or platform gateway was exercised from the build sandbox —
   all boundaries are spec-proven at the injectable seams. The
   CC10 money path additionally needs, before real funds flow:
   a real platform-gateway payment credited to a wallet, a real
   payout request → approval → mark-paid against an actual
   bKash/bank payout, and the operator's own legal/licensing
   review for holding tenant funds (the code enforces accounting
   discipline, not regulatory compliance).

## Standing honest limits (whole package)
- Health in the overview is derived from stored fields, not live
  pings (except where a batch added a real test: courier read
  endpoints, sender test email, LLM verify completion).
- Nagad: config storage only (CC9) and never a platform gateway
  (CC10) — no Nagad API checkout is wired in this codebase; the
  UI and API say so instead of implying one. Rocket is
  manual-number only, by design and by fact.
- The buyer-facing shop "Pay online" button (CC9 own-gateway and
  CC10 platform) is NOT built — both initiation APIs (dashboard +
  public storefront) are complete and spec-proven; the shop
  success-page button and a staff "collect payment" button remain
  UI follow-ups.
- LLM org-wiring (CC8) is partial by design and listed in full in
  the B4 acceptance (campaigns/competitors/workflows still use
  the platform LLM).
- TikTok own-app (CC3) cannot be credential-verified before
  OAuth — no such endpoint exists; it verifies at first connect.
  YouTube/Google has no own-app path (platform app only).
