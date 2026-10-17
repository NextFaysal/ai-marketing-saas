# OU3 — Daraz Channel: Verify-First Spike (Step-0)

Date: 2026-10-16 · Worktree: `ai-marketing-saas-ou`, branch `one-umbrella`
Rule applied: only OFFICIAL documentation counts as evidence. Blog
posts, third-party plugins, GitHub SDK mirrors and video tutorials
were used only as leads, never as evidence. Where the official
Daraz pages could not be rendered, that is recorded as
"not evidenced" — never filled in from memory.

## Sources actually fetched (official)

| # | Source | What it establishes |
|---|--------|---------------------|
| S1 | Daraz Open Platform home — https://open.daraz.com/ | Daraz runs its own Open Platform (separate portal from Lazada's), advertising seller authorization, API reference and developer documentation. Marketing copy only — no API contract content is rendered on the home page. |
| S2 | Lazada Open Platform — Signature algorithm doc — https://open.lazada.com/apps/doc/doc?nodeId=10450&docId=108068 | The shared Alibaba-stack signing contract (see §2). |
| S3 | Lazada Open Platform — Configure seller authorization — https://open.lazada.com/apps/doc/doc?nodeId=10777&docId=108260 | App-first flow, OAuth2 code-for-token seller authorization, partner types and authorization policies (see §1, §2). |
| S4 | Lazada Open Platform — API endpoint URLs — https://open.lazada.com/apps/doc/doc?nodeId=10443&docId=108065 | Production REST base URLs exist **only for the six Lazada ventures** (SG/TH/MY/VN/PH/ID). **No Daraz venture (BD/PK/LK/NP/MM) is listed.** |
| S5 | Lazada Open Platform — API Reference index — https://open.lazada.com/doc/api.htm | Exists, but renders as a JavaScript shell to a text fetch ("loading…"); the per-API reference pages could not be read this way. |

Attempted and failed (recorded, not retried/guessed):
- The Lazada doc node IDs under the Daraz host
  (`open.daraz.com/apps/doc/doc?nodeId=10443&docId=108065`) return
  HTTP 404 — Daraz's doc tree does not mirror Lazada's node IDs at
  those paths, so no Daraz-specific doc page could be fetched
  through them.

## 1. App registration — EVIDENCED (Lazada-shared stack)

From S3 (official):

- An application must be **created first** in the platform's App
  Console; seller authorization is impossible before that. The app
  receives an **App Key + App Secret**.
- Access to a seller's business data (products, orders) requires
  the **seller to authorize the app** via an OAuth2
  code-for-token flow: the seller logs in with their Seller Center
  account on the authorization page, approves, and the app
  exchanges the returned code for an access token
  (`/auth/token/create` on the auth host). Each access token is
  scoped to **one store**; refresh tokens extend it, and when the
  refresh token expires the seller must re-authorize.
- **Partner/app approval gates exist.** The developer account's
  partner type decides the authorization policy:
  - *Self-Developed* apps → "allow binding user to authorize":
    an **authorized-seller whitelist** (seller ID/short code +
    credentials) capped at a small number of designated stores.
  - *B2B partner* apps → "allow login user to authorize" while
    the app is in test status.
  - *Enterprise Commercial* apps, once released/online →
    "allow subscribers to authorize": local sellers must first
    **subscribe to the app in the Service Market**.
  So a public multi-merchant Daraz connection is NOT self-serve:
  it needs a registered developer account, an app, the right
  partner type, and either whitelist entry, a test-status app, or
  a released + subscribed app.

Daraz-specific (S1): Daraz operates the same model through its
own portal (open.daraz.com). The Daraz-side console URL, partner
categories and BD-specific approval steps could not be rendered
from official pages in this spike — marked **not evidenced** in
detail, evidenced in kind (the portal exists and advertises the
same authorization model).

API categories (Lazada-shared, S3 + S5 index): product APIs,
order APIs, feed/media and logistics families exist on the shared
stack. Daraz-specific category availability is **not evidenced**.

## 2. Sign / auth contract — EVIDENCED (Lazada-shared stack)

From S2 (official), paraphrased:

- Every request is signed. System + business parameters (except
  `sign` itself and byte-array params) are sorted by parameter
  name in ASCII order, concatenated as `name``value` pairs,
  prefixed with the API path, and digested with **HMAC-SHA256**
  keyed by the App Secret; the digest is uppercase hex.
  `sign_method` is sent as `sha256` (HMAC-SHA256 variant).
- Common parameters: `app_key`, `timestamp` (ms), `sign_method`,
  `sign`, and `access_token` for seller-data APIs.
- Requests go to `https://api.<venture>/rest/<api-path>` with
  JSON responses (S4 pattern).

This signing algorithm is implemented and unit-tested in
`apps/api/src/integrations/daraz/daraz.client.ts`
(`signDarazRequest`) — it is pure, evidenced, and makes no
network call by itself.

## 3. Product create/update + order get APIs — NOT EVIDENCED for Daraz

- The shared stack's API names for these operations are widely
  known (`/product/create`, `/product/update`,
  `/products/get`, `/orders/get`, `/order/items/get`), but in
  this spike they appear **only in third-party mirrors**, not on
  a fetched official page, and **no official page evidences them
  for Daraz ventures at all** (S4 lists no Daraz base URL).
- No Daraz (BD) production REST base URL is evidenced by an
  official document fetched here. (A host `api.daraz.com.bd`
  exists in public DNS data — that is not documentation and is
  not treated as a contract.)
- Verdict: product/order payload shapes, field names, status
  vocabularies and error codes for Daraz are **not evidenced**.
  Building live calls would mean fabricating an integration,
  which the product rules forbid.

## 4. Daraz Seller Center CSV contracts — NOT EVIDENCED

- **Order export CSV:** no official Daraz Seller Center document
  describing an order-export file's columns could be found or
  fetched. Search surfaced only unrelated products' export docs
  and video tutorials. → **Order CSV import is NOT BUILT**
  (columns are never guessed).
- **Product bulk-upload template:** Daraz Seller Center does
  offer bulk product upload (long-standing Seller Center
  behaviour), but no current official Daraz template with a
  column contract could be fetched. The only template-like
  document found is a ~2014 Zalora-partner Seller Center guide —
  a different marketplace's legacy material, not Daraz evidence.
  → The feed export below is therefore a **Daraz-labelled CSV
  built from the real catalog** whose columns carry the
  canonical commerce fields; conformance to Daraz's current
  Seller Center template is **explicitly not claimed**, and the
  UI says so in Bengali.

## 5. What a Bangladeshi Daraz seller would need (external gates)

1. A verified Daraz BD **Seller Center account** (shop approved
   by Daraz).
2. A **developer account + app** on open.daraz.com (App Key /
   App Secret), with the partner type / approval path of §1 —
   for a third-party SaaS this realistically means either the
   merchant's own self-developed app + whitelist, or Qosprey's
   commercial app released on the platform + the seller
   subscribing/authorizing it.
3. The seller completing the **OAuth authorization** for their
   store (one token per store), and re-authorizing when the
   refresh token expires.
4. Until 1–3 exist for a real merchant, **no live Daraz sync can
   be proven** — this is an M30-style owner/merchant gate, not a
   code gap.

## Build verdict (what this spike authorizes)

| Layer | Verdict |
|---|---|
| API adapter skeleton (EC1 CommerceAdapter pattern) + per-org sealed config + verify-before-save | **BUILD in the labelled refusing state** — sign function evidenced (§2); config storage mirrors CC3's honest "configured, not verified" pattern for platforms with no usable credential-check endpoint; verify + every sync operation refuse honestly (Paperfly OU6 precedent) until a merchant app is approved and the Daraz endpoint contract is evidenced. |
| Daraz product feed export (CSV from real catalog) | **BUILD** — follows the EC14 feed-generator pattern; honestly labelled as an unverified-template export (§4). |
| Daraz order CSV import | **NOT BUILT** — column contract not evidenced (§4). |

No migration: the Daraz connection reuses the existing
`Integration` (provider = `daraz`) + `IntegrationCredential`
sealed-blob models, and the feed reuses `ProductFeed`
(channel = `daraz`, a free String column). `Store.platform` has
no DARAZ enum value and none is added — a Daraz connection is an
integration record, not a Store row, until a live sync exists.
