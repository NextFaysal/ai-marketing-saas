# OU3 — Daraz Channel: Acceptance (OB4)

Date: 2026-10-16 · Branch `one-umbrella` · Base: ca868858
Spike: `docs/one-umbrella-ou3-daraz-spike.md` (committed first)
Migration claim: **NONE** — no schema change. The Daraz
connection reuses `Integration` (provider = `daraz`) +
`IntegrationCredential`; the feed reuses `ProductFeed`
(channel = `daraz`, a free String). The 20261022000000 range
stays unclaimed by OU3.

## Shipped audit (item by item)

| Item | Verdict | Evidence |
|---|---|---|
| Spike doc (Step-0) | **BUILT** | docs/one-umbrella-ou3-daraz-spike.md — official sources S1–S5 fetched; Daraz-specific endpoint/product/order contracts and both CSV contracts recorded NOT evidenced, with reasons. |
| 1. API adapter skeleton | **BUILT (labelled refusing state)** | `apps/api/src/integrations/daraz/daraz.client.ts`: `signDarazRequest` implements the officially-evidenced shared-stack HMAC-SHA256 signing and is vector-tested; `DarazDevAdapterClient` (developmentAdapter=true, live=false) refuses verify/getProducts/createProduct/updateProduct/getOrders and never calls fetch (spec-proven). `DarazAdapter` registered in the EC1 `CommerceAdapterRegistry` with **every capability false**; execute() refuses all operations with the Bengali not-live message. |
| 1b. Per-org sealed config + verify-before-save | **BUILT** | `daraz.service.ts` + controller/module (routes under `organizations/:organizationId/commerce/daraz`): credentials sealed via AES-256-GCM `encryptJson` into `IntegrationCredential`; verify runs before every save and honestly fails (adapter refusal), so saves land as `configured_not_verified` (CC3 pattern), the Integration status is forced **DISCONNECTED** on every save, secrets/tokens are never returned, and `verify()` can never return verified:true. Specs prove sealing, DISCONNECTED status, no-secret-in-response, removal. |
| 2a. Daraz product feed export | **BUILT** | `serializeDarazCsv` in `feeds/feed-generator.ts` over the canonical EC14 `buildFeedItems` model (real catalog only; EC14 exclusion discipline kept — no slug/image/description ⇒ skipped with reason). `FeedItem` gains `stockQuantity`; quantity is **blank when unknown, never invented**. FeedsService accepts channel `daraz` (CSV-only — XML refused with a Bengali error), serves it by token, and the preview carries `DARAZ_FEED_TEMPLATE_WARNING`. Web feeds page adds the Daraz channel with honest Bengali labels ("API ইন্টিগ্রেশন নয়, টেমপ্লেট যাচাইকৃত নয়") and an updated honesty banner. |
| 2b. Daraz order CSV import | **NOT BUILT** | No official Daraz Seller Center order-export column contract could be evidenced (spike §4). Columns were not guessed. |

## Explicit NOT BUILT list

- Any live Daraz API call (product push/pull, order pull,
  status push, webhooks) — no evidenced Daraz endpoint contract
  and no approved merchant app.
- Daraz order CSV import — column contract not evidenced.
- A `Store` row / `StorePlatform.DARAZ` enum value — deferred
  until a live sync exists (would need a migration).
- Daraz OAuth authorization flow UI (seller authorize + token
  exchange) — pointless and misleading before an app exists;
  access/refresh tokens can be stored sealed in the config for
  the day the flow is built, but nothing consumes them today
  and the UI copy must not imply otherwise.
- Verification that the export CSV matches Daraz's current
  Seller Center bulk-upload template — impossible without the
  official template (see live checklist).

## Gates (serial, exactly as run)

- API jest `src/integrations/daraz/ou3-daraz.spec.ts`: **11/11 pass**
- API jest `src/feeds/feeds.spec.ts`: **18/18 pass** (13 pre-existing + 5 OU3)
- API jest adjacent registry suites (`ec-di`, `sync-outbox.service`, `woo-catalog`): **22/22 pass**
- API tsc `tsc --noEmit -p tsconfig.json`: **exit 0** (first two attempts OOM-killed by parallel workers' jest sweeps on the 7 GB VM; passed solo with `--max-old-space-size=3072`)
- Web vitest: **110 files / 901 tests pass**
- Web tsc `--noEmit`: **exit 0**
- Web `next build`: **exit 0** (first attempt aborted under memory pressure; solo rerun passed)
- Fresh-PG migration run: **not applicable** — no migration added.
- Known pre-existing failures (cc26, adx3-nav-counts, gb9-public-docs) not chased, per dispatch.

## Live checklist (M30-style — ALL UNCHECKED, owner/merchant-gated)

- [ ] Developer account + app created on open.daraz.com; partner type / approval path confirmed for BD
- [ ] A real Daraz BD seller authorizes the app (OAuth) and an access token is issued
- [ ] Daraz (BD) production REST base URL + product create/update contract evidenced from official docs
- [ ] Daraz order get contract evidenced from official docs; first real order pull reconciled against Seller Center
- [ ] Export CSV uploaded to a real Seller Center bulk-upload and the column match verified (or the serializer corrected to the real template)
- [ ] Daraz Seller Center order-export sample obtained from a real seller account; CSV import column contract evidenced, then import built
- [ ] Token refresh behaviour proven against the real auth host before any sync is enabled per-org

## Commits (local only — NO push)

- `be701d99` — OU3 spike doc
- `a23f13cf` — OU3 item1: development adapter + sealed config + registry gating
- `c63d896b` — OU3 item2a: Daraz feed export (API + web)
- (this acceptance doc)
