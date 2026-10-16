# AB8 (AX21–AX27) — Platform & Developer: Acceptance

**Batch AB8 is the FINAL batch of the E-Commerce Advanced Program.**
Worktree `~/workspace/ai-marketing-saas-gc`, branch `completion`.
Base `6278acf` (AB7) → final HEAD is the docs commit on top of the
8 AB8 commits below. **Local commits only — NO push** (owner's
standing rule). Migration `20261017080000_ab8_platform_developer`
(additive only) has **NOT run on any real DB**.

## Commits (9 incl. foundation + docs)

| Commit | Content |
|---|---|
| `d4fccf6` | Foundation: schema + migration (coordinator) |
| `e002c0e` | AX21 merchant developer API + `ApiUsageDaily` counter + OpenAPI section + app.module wiring (MerchantApi + DataTools) |
| `cd214eb` | AX25 merchant data tools (shared export builder, DataExport pipeline, jobs, audit viewer) |
| `b3efd03` | AX26 Google SSO API + admin-side pieces (platform config, LimitsDto.whiteLabel, export delegation) |
| `442b06b` | AX23 custom CSS/JS API + AX24 white-label email |
| `cd0f1cb` | AX27 device-fingerprint fraud signal (API) |
| `de8b926` | Shop web: AX22 PWA + AX23 rendering + AX27 client hash |
| `fa8962b` | Dashboard web: AX21 keys UI + AX25 data-tools UI + AX23 settings + AX27 fraud UI |
| `f7e0c57` | AX26 web + admin (Google config section, white-label toggle) |

Process note (honesty): the original eight builders were killed
by a sandbox daemon restart mid-batch. Their partial work was
fully preserved in the working tree; seven finisher agents then
audited that work line-by-line against the briefs (fixing what
was wrong — see "Defects caught" below) and the coordinator ran
the full gate personally. B1 (AX21) survived the restart and
completed normally.

## AX21 — Merchant developer API ✅

- `MerchantApiKey` (schema/migration): org-scoped, `keyHash` =
  SHA-256 of the full token, token = `qk_live_` + 43-char random
  segment, shown **exactly once** at creation; `scopes` validated
  subset of `products:read | products:write | orders:read |
  customers:read`; `status` active|revoked; `lastUsedAt` stamped
  throttled (≤ 1/min/key). Create + revoke audited via
  AuditService with `{name, scopes}` metadata only — never the
  token or hash. One documented compromise: `keyPrefix` stores
  the first 8 chars of the **random segment** (the brief's
  literal "first 8 of the token" is `qk_live_` for every key);
  the UI displays `qk_live_<keyPrefix>…`.
- `MerchantApiKeyGuard`: `Authorization: Bearer` or
  `x-merchant-api-key`; resolves the key → `req.merchantApi =
  { orgId, keyId, scopes, createdById }`. **Org scoping comes
  from the credential, never from a client-supplied org id.**
  Revoked/unknown → 401; missing scope → 403 naming the scope;
  plan `apiDailyLimit` breach → 429 **before** the handler.
- Routes `/v1/merchant/`: GET products (paginated), GET
  products/:id, POST products, PATCH products/:id, GET orders
  (status/from/to filters), GET orders/:id, GET customers,
  GET customers/:id — every handler **delegates** to
  ProductsService / OrdersService / CustomersService (writes act
  as the key's creator). A foreign product id is resolved inside
  the KEY's org → 404 (spec-asserted on delegation args).
- Usage: new shared helper `apps/api/src/common/api-usage.ts` —
  verified first that **nothing in-tree incremented
  `ApiUsageDaily`** (GC22 built the table + billing read only);
  the guard now increments it failure-isolated per authenticated
  call and enforces the GC22 limit with the same semantics.
- Key management UI: dashboard Settings → "ডেভেলপার API" card
  (create with scope checkboxes → plaintext once in a copyable
  box with the never-again warning; list with prefix/scopes/last
  used; revoke with confirm). One contract deviation, tolerated
  by a web normalizer: `listKeys` returns a bare array (the UI
  accepts both array and `{items}`).
- OpenAPI: the GC23 document gains an `x-merchant-api` section
  (all 8 routes, bearer scheme, per-route scopes, 401/403/429).
  The GC23 frozen inventory is **public-routes-only by its own
  construction** (introspection of the four public controllers),
  so these authenticated routes are described but intentionally
  NOT inventoried — `gb9-public-docs.spec.ts` passes unmodified
  (7/7).

## AX22 — Per-shop PWA ✅

- `GET /shop/[orgSlug]/manifest.webmanifest` (route handler):
  name = `brandName ?? org name ?? shopName`, short_name ≤ 12
  chars, `start_url`/`scope` = `/shop/<slug>`, theme from
  `primaryColor`, icons = org logo when set, else the white-label
  neutral icon (below), else the platform icon set. Pure builder
  `buildShopManifest` in `lib/shop-pwa.ts` (9 tests).
- The shop layout's `generateMetadata` links THIS manifest for
  shop pages only — verified: dashboard pages never pass through
  the shop layout, and the global manifest/root layout/pwa.tsx
  carry **zero diff**.
- Install bar (`ShopInstallBar.tsx`): Chromium
  `beforeinstallprompt` via the existing pwa.tsx stash, iOS
  Share → "হোম স্ক্রিনে যোগ করুন" fallback copy, dismissal
  remembered per shop in localStorage, renders nothing when
  standalone/dismissed.
- **No service-worker changes**: AB7's shop-push worker stands;
  shop caching is explicitly NOT added.

## AX23 — Custom CSS/JS ✅ (security audit first)

**Cookie audit finding (the audit the brief demanded, done
before building):** the platform has **no auth cookies at all**.
Staff auth is a JWT kept in `localStorage` on the web APP origin
and sent as an `Authorization: Bearer` header
(`apps/web/src/lib/api.ts`); the API sets no cookies (grep of
`res.cookie`/`Set-Cookie` across `apps/api/src` = no auth use).
The only cookies in the system are host-only, non-auth shop
cookies (e.g. the GC1 popup dismissal, `SameSite=Lax`, no
`Domain` attribute). **Consequence:** no credential material is
ever scoped to tenant shop hosts, and shop hosts are separate
origins that cannot read the app origin's localStorage. The one
dangerous case is a shop rendered **on the app host itself**
(same origin as the dashboard) — so the implemented rule is:

> Custom JS renders only when `customJsEnabled` is on AND the
> request host is NOT a primary app host (`app.qosprey.com`,
> `admin.qosprey.com`, plus `NEXT_PUBLIC_APP_HOST` /
> `NEXT_PUBLIC_WEB_URL` host when configured). Tenant
> subdomains and verified custom domains pass; subdomains OF a
> primary host are also refused (conservative extra). The check
> runs server-side in the shop layout (`headers()` host) via
> `customJsAllowedOnHost` in `lib/shop-custom-code.ts` — it is a
> render-time host check, not a UI promise.

- Storage + validation: `StorefrontSetting.customCss/customJs`
  (≤ 50,000 chars), `customJsEnabled` default FALSE. Save
  rejects (Bengali 400) CSS containing `</style` or `<!--`, JS
  containing `</script` (case-insensitive). Settings UI
  (storefront settings, existing staff guard) carries the risk
  warning + the host-rule statement.
- Rendering (shop layout only): CSS in `<style data-custom>`
  after theme inputs; JS as `<script data-custom-js>` at body
  end when enabled + host rule passes. Changes audited on the
  existing `storefront.settings_updated` audit with
  **lengths only** — spec asserts the code strings never appear
  in audit metadata.

## AX24 — White-label completion ✅

`Organization.whiteLabel` (default FALSE). **Admin-set only**:
plan tiers carry numeric limits only (PLAN_LIMIT_FIELDS), so
there is no plan boolean to gate self-serve on — documented,
not invented. The write rides the EXISTING admin org limits
path (`PATCH /admin/orgs/:id/limits`, `LimitsDto.whiteLabel`,
persisted + audited by `updateOrgLimits`); the admin org page
toggle calls exactly that (a finisher caught the partial work
calling a non-existent route and fixed it).

Platform-mark audit (grep evidence; F5's table):

| Surface | Mark? | White-label effect |
|---|---|---|
| Shop footer / "Powered by" | **None exists** in shop code | Nothing to toggle — stated honestly |
| Shop `<title>` suffix | **None** (no title template; pages use shopName) | Nothing to toggle |
| Shop favicon fallback | Platform PNGs when merchant sets no icon | Neutral generated initial icon (`/shop/<slug>/icon.svg`) |
| Shop PWA manifest icons | Platform `/icons/icon-192/512.png` fallback | Same neutral SVG icon; merchant logo always wins |
| Order-notification emails | No body mark; sent from the platform SMTP From (bare address) | `EmailProvider.send` gains optional `fromName`; white-label orgs send as `brandName ?? shopName ?? org name` (address unchanged — no sending domain is invented). Non-WL sends byte-identical |
| Tenant-SMTP emails | Already merchant-configured (`MessagingSenderConfig.fromName`, MS4) | No change needed |
| Courier labels / packing slips / invoices | Already org-branded (M59) | Nothing to toggle |
| SaaS invoices | Platform is the SELLER — its name is correct there | Deliberately NOT toggled |
| Report shares | Already org-first branding | Nothing to toggle |

The neutral icon route (`/shop/[orgSlug]/icon.svg`) renders a
512×512 SVG: primary-color rounded rect + the shop name's first
letter, XML-escaped, strict hex validation.

## AX25 — Merchant data tools ✅

**(a) Audit viewer.** Verified from schema + write sites:
`AuditLog.organizationId` exists but is populated by only a
subset of writers (~219 of 393 `audit.log({…})` call sites pass
an org id; direct `auditLog.create` sites vary). The viewer is
therefore built **over the org-stamped subset only** and says
so: `GET organizations/:orgId/audit-logs` (OWNER/ADMIN;
entity/actorId/from/to filters; pagination ≤ 100; actors
resolved in one query) returns `scopeNote: "org_stamped_only"`,
and the dashboard page (সেটিংস → কার্যকলাপ লগ) renders the
Bengali scope note. Metadata renders as React text only — no
HTML injection path. Rows without org context (platform auth
events etc.) are never shown and never re-scoped by inference.

**(b) Self-serve export.** The admin `exportOrgData` builder was
generalized into `buildOrgDataBundle`
(`apps/api/src/organizations/org-data-export.ts`): the admin
path returns its **historical shape byte-identically** (existing
admin spec m40 passes unmodified) and now delegates to the
shared builder. The file pipeline covers the admin set **plus**
order items **plus** media-asset metadata (never bytes), with
per-table cursor pagination (1,000-row chunks, 200,000-row
ceiling, per-table `{ rows, truncated }` manifest).
`DataExport` lifecycle: POST creates a row → inline generation
when the row estimate ≤ 25,000, else the per-org job
`data_export_generate` drains pendings; the JSON bundle +
manifest is stored via MediaStore at
`data-exports/{orgId}/{exportId}.json`; downloads are
staff-authorized, own-org only (foreign id 404), expired → 410;
`expiresAt` = ready + 7 days. Download of a still-pending/failed
row returns 409 (a premature click must not destroy a queued
export — flagged deviation from a literal reading of the brief).

**(c) Scheduled backup.** `OrgBackupPreference` (default OFF) +
per-org job `org_backup_sweep`: when enabled and the last
backup is ≥ 7 days old (or absent), the same export runs as
`kind=backup`; retention keeps the newest 4 ready backups
(older files deleted, rows expired). Settings UI ("ডেটা ও
ব্যাকআপ" card) lists manual + backup exports with downloads
and the preference toggle. Deviation tolerated by a web
normalizer: `listExports` returns `{ exports,
backupPreference }` (not `{ items, … }`).

## AX26 — Google SSO ✅

- Config: SystemSetting `googleOAuthConfig` via the platform
  config machinery (`googleOAuth` snapshot slot; secret sealed;
  safe view `{ clientId, secretConfigured, enabled }`). **No env
  fallback** — staff SSO is an explicit operator act (the
  YouTube `googleApp` config is separate and untouched). Admin
  settings gains a "Google SSO (স্টাফ লগইন)" section showing
  the callback URL to register:
  `<API_PUBLIC_URL>/auth/google/callback`.
- Flow: `GET /auth/google/config` (public `{ enabled }` — the
  login button renders ONLY when enabled) → `GET
  /auth/google/start` (state token: SHA-256 at rest in
  `SsoLoginState`, 10 min, single-use) → Google authorize →
  `GET /auth/google/callback` validates state (consumed before
  exchange), exchanges the code server-side at
  `oauth2.googleapis.com/token` (substitutable fetch seam),
  requires `email_verified === true` from userinfo → a User
  with that email exists → one-time **handoff** token (5 min,
  hashed, user-bound) delivered in the redirect **fragment**
  (`/login/google#handoff=…`) → the web page POSTs
  `/auth/google/exchange` → `AuthService.completeGoogleLogin`:
  TOTP users enter the EXISTING TOTP challenge (challenge
  carries `via: "google"`; SSO never bypasses TOTP), others get
  a normal `issueToken` session. `LoginEvent.method` records
  `"google"` (password-origin completions unchanged).
- **No auto-provisioning:** unknown email → redirect
  `?googleError=account_not_found` + a FAILED LoginEvent
  (method google); the spec asserts `user.create` is never
  called. Inactive accounts likewise refused. Error codes:
  not_configured | state_invalid | exchange_failed |
  email_unverified | account_not_found | account_inactive —
  the login page maps them to Bengali messages and clears the
  param.

## AX27 — Device-fingerprint fraud signal ✅

- Client (`lib/device-hash.ts`): SHA-256 hex of
  `[userAgent, screen w×h, timezone, language,
  hardwareConcurrency bucket]` joined — **no canvas, no
  WebGL** (stated in code comments + settings copy). Sent
  optionally as `deviceHash` on the shop, express, landing and
  single-product checkout DTOs; invalid/absent values are
  dropped server-side (normalized to nothing), never a checkout
  failure. Valid hashes stamp `Order.deviceHash` at placement
  through the same create-data spread as AX19 attribution (+
  the integrations upsert passthrough, create-branch only).
- BlockedIdentifier gains kind **`device`** (normalization =
  lowercase 64-hex; staff add-form + validation + labels
  updated). `CheckoutGuardService` evaluates a presented hash
  in the step-2 blocked family: same generic Bengali refusal,
  and the FraudAttemptLog summary carries **only the first 12
  chars** (spec asserts the full hash appears nowhere in the
  log row).
- ON4 scoring: `deviceVelocity` = distinct customer phones on
  the same deviceHash (org-scoped, last 24h, own phone
  excluded), computed inside FraudShieldService's existing
  bounded load. ≥ 3 distinct phones → **+15** with the
  explainable label "একই ডিভাইস থেকে অনেক নম্বর" (label text:
  `একই ডিভাইস থেকে গত ২৪ ঘণ্টায় Nটি আলাদা নম্বরে অর্ডার
  এসেছে`). The weight is capped at 15 while the high band
  starts at 70 — **the signal alone can never reach the high
  band or hold an order by itself** (spec-asserted). Staff
  surfaces show the hash **prefix only** (order detail gains
  `deviceHashPrefix`; the full hash is deleted from the payload).
  Fraud settings carry the mandated copy: "ডিভাইস সংকেত দুর্বল
  — পরিবারের সবাই একই ফোন ব্যবহার করতে পারেন; এটি একা কোনো
  অর্ডার আটকাবে না".

## Defects caught during the batch (disclosed)

1. The killed B7 web work targeted contract shapes the API
   builders didn't deliver (keys list bare array vs `{items}`;
   exports `{exports}` vs `{items}`) — the web now normalizes
   both shapes; nothing is blocked either way.
2. The killed B8 work wired the admin white-label toggle to a
   non-existent route (`PATCH /admin/orgs/:id`); the real path
   is the org limits endpoint — fixed + verified.
3. The killed B2 work left two silent caps (`take: 20` /
   `take: 100`) contradicting the brief's "all pending" /
   retention semantics — removed.
4. One spec fixture in the AX27 suite seeded a same-phone row
   with a different customer name, legitimately firing the
   pre-existing ON4 name-mismatch signal; the seed was corrected
   (no assertion weakened — the exact-reasons equality still
   pins own-phone exclusion).

## Final gate (run by the coordinator personally, exit-code checked)

| Gate | Result |
|---|---|
| API jest (5 chunks, `--runInBand`, workspace-disk cache) | **401 suites / 4,523 tests — ALL PASS** (baseline 396/4,441 → +5 suites / +82 tests = the five new AB8 suites: merchant-api 21, google-sso 17, data-tools, device-signal, custom-code-whitelabel 19, + neighbours) |
| API tsc `--noEmit` | exit 0 |
| Web vitest | **69 files / 570 tests — ALL PASS** (baseline 524 → +46) |
| Web tsc · Admin tsc | exit 0 · exit 0 |
| Full build (`pnpm -r build`, pnpm 9.15.0 via npx — the sandbox lost its pnpm shim in the restart) | **exit 0 (7/7 projects incl. both Next builds)** |
| prisma validate | exit 0 |
| Fresh-DB (throwaway PG16) | **181/181 migrations applied clean; 282 public tables**; `MerchantApiKey`/`DataExport`/`OrgBackupPreference`/`SsoLoginState` + `Organization.whiteLabel`, `Order.deviceHash`, `LoginEvent.method`, `StorefrontSetting.customCss/customJs/customJsEnabled` verified via information_schema; cluster dropped |

No flakes encountered in the final gate.

## Deploy notes

- Run migration `20261017080000_ab8_platform_developer` at deploy.
- Per-org job enablement owed for orgs that will use them:
  `data_export_generate`, `org_backup_sweep`.
- AX26 live setup (owner): create the Google OAuth app, register
  `<API_PUBLIC_URL>/auth/google/callback`, set client id/secret +
  enable in Admin → Settings → Google SSO. Until then the login
  button simply never renders.
- AX21 note: the merchant API counts into the same
  `ApiUsageDaily` + `apiDailyLimit` as the public surface.

## HONEST LIMITS

- **Nothing in AB8 is live-proven** (standing M30 debt): no real
  Google OAuth round-trip (specs mock Google via the fetch seam),
  no live merchant-key HTTP call against a running server, no
  real MediaStore/S3 export file, no real browser install prompt
  or custom-domain host-rule observation. All proof is
  spec/fixture/fresh-DB level, as labelled.
- AX25a coverage is the org-stamped subset of audit writes by
  construction (see above) — the viewer labels it; it does not
  claim org-completeness.
- AX21 customers list inherits `CustomersService.list`'s window
  (≤ 100 rows per call) — paging beyond that window is not
  possible through the sanctioned delegation.
- AX23's host rule trusts the request `Host` header as delivered
  by the deployment's proxy chain (the same trust the custom-
  domain routing already relies on); a merchant's custom JS
  remains fully privileged **on their own shop origin** by
  design — the settings copy says so.
- AX27 device hashes are stable only per browser profile +
  signals; the signal is weak by design and weighted so.
