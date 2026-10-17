# OB2 Acceptance — One-Umbrella OU2 (Cloudflare for SaaS) + OU6 (Courier completion)

Date: 2026-10-16 · Branch: `one-umbrella` · Worktree: `~/workspace/ai-marketing-saas-ou`
Base HEAD: `b8b9d28c` (OU1 code-complete) · Final HEAD: recorded in the closing commit line of the OB2 report (this doc is committed on top of OU6's `dc8d8621`).
Plan: `One-Umbrella-Master-Plan-2026-10-16.md` §OU2/§OU6 · Audit evidence: `one-umbrella-audit-A.md` (domain), `one-umbrella-audit-C.md` (G3, C11, C12).
Local commits only — NO GitHub push (owner-only trigger).

Process note (resilience record): the OB2 coordinator attempt before this one died in a daemon restart with ZERO commits (verified: HEAD was still `b8b9d28c`). During THIS run, two OU2 workers also died in daemon restarts — but per-item commits meant nothing committed was ever lost: worker 1's adapter commit survived, worker 2 (finisher) completed ALL remaining OU2 commits before its report was lost. The coordinator reconstructed OU2's gate record by re-running the unrecorded gates serially itself (see §3) rather than trusting the lost reports. OU6's worker completed normally with a full report; its per-item detail lives in `docs/one-umbrella-ou6-acceptance.md`.

---

## 1. OU2 — Step-0 findings

- **Domain machinery (pre-existing, TD line):** TXT verification lives in `apps/api/src/storefront/storefront.service.ts`; `StorefrontSetting` carries `domainVerifyToken/domainVerifiedAt`; custom-domain routing in `apps/web/src/lib/custom-domain.ts`; audit item G3 confirmed NO CfS/custom-hostname API integration and NO cert-issuance code anywhere (2-angle grep).
- **Platform-config pattern reused (no parallel system):** the existing `PlatformConfig` snapshot + `apps/api/src/common/platform-config.ts` + admin SUPER routes — sibling secrets are sealed at rest and masked on read; OU2 extended this exact surface (§2.1).
- **CfS API contract — what is evidenced vs assumed:** repo evidence is `docs/td-tb4-ssl-spike.md` §3 (sourced there to Cloudflare's own docs): per-domain custom hostname in our zone; hostname `status` = ownership validation; `ssl.status` = separate DCV state; BOTH must be active; validation method chosen at create (`ssl.method`, we use `http`). NOT evidenced in-repo: exact API v4 URL shapes, Bearer auth header, `{success, errors, result}` envelope, full `ssl.status` vocabulary, exact token permission names. Therefore ALL CfS HTTP lives behind ONE isolated adapter (`apps/api/src/common/cloudflare-for-saas.client.ts`) with defensive parsing — an unknown response shape yields failed/unknown, NEVER a fabricated "active" — and **live API proof is owed** (checklist S10).

## 2. OU2 — shipped audit (item by item)

### 2.1 Platform/operator config — `6ce0c18c`
- `PATCH admin/platform-config/cloudflare` (`@AdminTier("SUPER")`) saves CfS config into the existing platform-config snapshot: enabled flag, zone id, fallback origin, and the API token **sealed** like sibling secrets, masked on every read (spec-proven in `ou2-cloudflare-config.spec.ts`).
- **Verify-before-save:** `POST admin/platform-config/test-cloudflare` (SUPER) exercises the adapter against the entered credentials and reports success/failure honestly before the config is relied on.

### 2.2 Isolated adapter — `57820a75`
- `cloudflare-for-saas.client.ts` (+130-line spec): create/get custom hostname; status mapping that reports **active ONLY when Cloudflare's response shows BOTH hostname status and ssl status active**; everything else → pending/failed with the provider's own words in the detail.

### 2.3 Verification hook + refresh endpoint + migration — `76f9328a`
- Migration **`20261020000000_ou2_domain_https`** (claim recorded: OU2 range starts at 20261020000000+): `StorefrontSetting` gains `customHostnameId`, `httpsStatus`, `httpsStatusDetail`, `httpsUpdatedAt`. No backfill — existing rows honestly read "never attempted" (NULL) until re-verify/refresh.
- At the TXT-verification success point (and via manual refresh): if CfS is **not configured**, verification still succeeds and the row is stamped `httpsStatus: "not_configured"` with an explanatory detail — never a fake active. If configured, the adapter creates the hostname (or re-reads the existing `customHostnameId`) and persists the mapped status; **adapter failure stamps `failed` + detail and does NOT roll back the domain verification** (spec-proven in `ou2-domain-https.spec.ts`, 211 lines).
- Org-scoped refresh endpoint on the storefront controller follows the neighbouring settings endpoints' guard/role pattern — manual refresh only; no webhook/polling machinery was invented.

### 2.4 Web surface — `e7a81295`
- Domain settings page (`dashboard/commerce/storefront/page.tsx`) surfaces the HTTPS certificate status (not_configured / pending / active / failed + detail) with a Refresh button wired to the refresh endpoint, in the page's existing style/language.

### 2.5 Domain-change hygiene — `fa436c2b`
- Changing the custom domain via the branding path also resets all CfS state (hostname id + status fields null), so a stale "active" can never ride onto a new domain. (The verify/start paths already reset — see service lines stamping the same reset in the token-issuance paths.)

## 3. OU2 — gates (all recorded by the coordinator, run serially, one at a time)

| Gate | Result |
|---|---|
| API jest — OU2 specs (config + adapter + domain-https) | **3 suites / 27 tests PASS** |
| API jest — `src/storefront` (full folder) | **28 suites / 389 tests PASS** |
| API jest — `src/admin` (full folder) | 22 suites / 237 tests — **236 PASS, 1 failure: `adx3-nav-counts.spec.ts` "counts every field from real rows with the page definitions" — PRE-EXISTING, proven: the same spec run solo on base `b8b9d28c` fails identically (1 failed / 6 passed)** |
| API jest — `src/organizations` + `src/common` | **26 suites / 245 tests PASS** |
| API tsc (`tsc --noEmit`, exit code captured) | **0 errors (exit 0)** |
| Fresh-Postgres `prisma migrate deploy` (virgin scratch cluster, full union) | **217 migrations found / 217 applied, exit 0** — incl. `20261020000000_ou2_domain_https` |
| Web vitest + tsc + build | Covered by OU6's recorded full web run at final HEAD `dc8d8621` (OU2's web commit `e7a81295` is an ancestor): **110 files / 900 tests PASS, tsc 0, build green** |

Gate-method note: several foreground gate attempts were killed mid-run by the sandbox/daemon while the machine was under heavy parallel load from other coordinators; per standing discipline none of those were counted either way — every number above comes from a completed, recorded run (detached runs with captured logs/exit codes).

## 4. OU6 — shipped summary (full record: `docs/one-umbrella-ou6-acceptance.md`)

Commits: `44633566` (framework capabilities + Paperfly dev adapter) · `9e6d2394` (Paperfly config surface) · `fd4f0c05` (balance visibility) · `dc8d8621` (OU6 acceptance doc). NO migration.

- **Step-0 verdicts:** GB5/GC13 had ALREADY built a provider-neutral courier framework (`courier-client.ts`: `COURIER_PROVIDERS` registry, `createCourierClient()`, `CourierClient {book(), statusOf()}`) — OU6 extended it instead of building a second one. **Paperfly API contract: NO evidence in-repo** (only the GB5 research NO-BUILD verdict: partner-gated "Paperfly Go" API, staging 401/Cloudflare, no published auth/endpoints/payloads) → real client would be fabrication → labelled development adapter is the only honest build. Balance evidence: Steadfast YES (`GET /get_balance`); Pathao/RedX/eCourier NO balance call in their client surfaces; Paperfly NO (no contract).
- **Framework:** `COURIER_CAPABILITIES` descriptor (book/label/track/cancel/balance/codReconcile/quote/live) with every value set from in-repo code evidence (cancel = false for ALL couriers — no client has a cancel call). Optional `CourierClient.balance?()` implemented ONLY by the Steadfast adapter (non-numeric response → error, never a fabricated 0). Existing couriers' `book()/statusOf()` bodies untouched — NOT MIGRATED: none (all four were already on the GB5 framework); provider extras (Pathao pickers/price plan, RedX areas/calculator, eCourier lists, verify-before-save) intentionally stay on the concrete classes per GB5 design.
- **Paperfly:** `PaperflyDevAdapterClient` — labelled in name/comments/markers, makes ZERO network calls (spec-proven: fetch invoked 0 times), refuses every operation with a not-live reason; booking attempts fail at the API with an honest dev message and **create no shipment** (service-level spec-proven). Web Connect Center card "Paperfly (Development — লাইভ নয়)" with amber warning; its connect form **refuses and saves nothing**.
- **Balance visibility:** `GET courier/balance` + `GET courier/balances` with honest states — `ok` (real Steadfast read: balanceMinor + BDT + fetchedAt) / `not_supported` (Pathao/RedX/eCourier/Paperfly — `balanceMinor` always **null**) / `not_configured` / `error` (provider's own message). Courier settings web cards show the balance line per provider; Steadfast card's stale "no balance endpoint" copy corrected.
- **OU6 gates (worker-recorded):** API jest full `src/courier` **15 suites / 158 tests PASS**; orders `cx1-courier-record` 6/6; OU6 specs 20/20; API tsc 0; web vitest 110 files / 900 PASS; web tsc 0; web build green. Only pre-existing spec modified = gb5 registry block (the intentional OU6 registry change, same commit). Baseline honesty note: the pre-change full-courier baseline run aborted under machine load and is NOT counted; attribution was not needed because every pre-existing courier suite passes against the new code.

## 5. NOT BUILT (explicit)

**OU2:**
- **Live CfS enablement on the owner's Cloudflare account — NOT DONE, owner-gated** (CfS plan activation + entering the real API token via the new admin surface): TD decision D3.
- **Live CfS API proof — NOT BUILT/owed:** the adapter's URL/auth/envelope mapping has never run against the real Cloudflare API; the spare-domain end-to-end test (pending → active → browser HTTPS) is checklist S10 in `docs/td-live-verification-checklist.md`. If the real contract differs, the fix is isolated to the one adapter file by design.
- CfS status **webhooks / automatic polling** — NOT BUILT (manual refresh only, as specced).
- Admin **app** UI section for CfS — NOT BUILT as a separate surface: config lives on the existing API platform-config surface with SUPER routes (same as sibling platform configs); no admin-app page was added.

**OU6:**
- **Paperfly live client — NOT BUILT** (no evidenced API contract; partner access + official docs are an owner-side acquisition — checklist S10 long-term line). Everything Paperfly (save/connect/book/quote/reconcile) refuses honestly by design.
- **Provider-side cancel for ANY courier — NOT BUILT** (no cancel call exists in any in-repo client).
- **Pathao/RedX/eCourier balance — NOT BUILT** (no evidenced balance API; surfaces say `not_supported`, never an estimate).
- Courier account opening / KYC — inherently outside (guided copy only); courier balance top-up / COD withdrawal — stays in the courier's own cycle (audit C12 unchanged).

**Package-level:** NOTHING in OB2 is live-proven. No push, no deploy; OU0's release + the owner's Dokploy Redeploy + S10 live sessions remain the path to live truth.

## 6. Checklist updates made

`docs/td-live-verification-checklist.md`: new **S10** section (OU2 CfS live proof: operator config + masked token, verify-before-save, unconfigured honesty, spare-domain registration → pending → active → failed honesty, domain-change reset; OU6: Steadfast balance vs portal, other couriers' honest note, Paperfly refusal proofs, long-term Paperfly live-proof line) and the closing line updated S1–S9 → S1–S10. All boxes UNCHECKED.
