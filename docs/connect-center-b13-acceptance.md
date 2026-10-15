# Connect Center Next — B13 Acceptance (CC30, the closing item)

Branch `cc-next` (base: integration-4 `3d4eb4b` via B10–B12).
Local commits only — nothing pushed.

Commits:
- `457e5dd` CC30a API: cadence gate + migration + PATCH endpoint
- `ca14b6c` CC30a web: store-card cadence control
- `3bcb98a` CC30b+c API: usage + deliverability + Meta business fetch
- `73b899a` CC30b+c web: usage + deliverability panels
- docs commit (this file + `connect-center-next-summary.md`)

Migration numbering note: this tree already contained the SU
migrations `20261013400000`–`20261013440000` (via integration-4),
so CC30's migration starts above them:
`20261013450000_cc30_sync_cadence`. It is the ONLY migration in
this batch (usage + deliverability are read models over existing
rows; the business verification rides the existing
`providerHealth` JSON snapshot).

---

## CC30(a) — Per-connection sync cadence (the CC18 leftover)

`Integration.syncIntervalMinutes` (nullable; null = today's
behaviour). Enforced in ONE shared gate,
`apps/api/src/integrations/sync-cadence.ts`, called by the Woo
(`IntegrationsService`) and Shopify (`ShopifyService`)
syncProducts / syncOrders / syncCustomers / syncReviews entry
points — but ONLY when the caller passes `{ scheduled: true }`.
The automation dispatch (`AutomationService.executeJob`, the 7
store-sync job types) is the only caller that passes it.

Design decisions (pinned by spec):
- **Scheduled only.** Manual HTTP triggers and the admin retry
  path pass nothing and are never cadence-gated — a human asking
  now means now. CC18's `syncPaused` is checked BEFORE the
  cadence in every entry point, so pause always wins (a
  paused + cadenced scheduled sync returns CC18's recorded
  `sync_paused` skip, not the cadence marker).
- **Window per (integration, kind)** — each sync stream of a
  store is throttled against its OWN last run. Comparing across
  kinds would let a products sync starve the same store's orders
  sync; the cadence is a per-connection minimum interval per
  stream, documented here and in the card UI copy.
- **"Last sync" = the latest REAL SyncJob row** for the
  (integration, kind), by `startedAt`. CC18's `sync_paused`
  marker rows are refusals, not syncs, and are excluded — a
  paused period must not extend the window after unpausing.
- **A skipped cycle creates NO SyncJob row** (deliberately the
  opposite of CC18's recorded pause skip: pause is a
  tenant-visible state, cadence is a throttle). The skip marker
  `{ skipped: true, reason: "sync_interval", lastSyncAt,
  nextEligibleAt, … }` becomes the automation job's run result,
  which is where it is recorded. Writing no row also means a
  cadence skip can never extend its own window.
- API: `PATCH organizations/:id/connections/:integrationId/sync-interval`
  beside `sync-paused` (OWNER/ADMIN; integer 5–10080, null
  clears; validated in DTO AND service; audit-logged
  `integration.sync_interval_set` / `_cleared`). The overview and
  the sync-history response surface the value.
- Web: the store card's Sync-control block gains the interval
  choice — presets 15m / 30m / 1h / 6h / 24h + custom (5–10080)
  + ডিফল্ট (off) — showing the last-sync time (`lastSyncAt` from
  the overview) the derivation starts from, with copy stating
  the per-kind derivation, that manual syncs are unaffected,
  and that pause beats cadence. The stale CC18-era copy claiming
  cadence does not exist was replaced. (Email `email_sync` is an
  org-level job over mailboxes, not a per-integration store
  sync; the cadence is defined for store syncs, as tasked.)

Spec: `apps/api/src/connections/cc30-cadence.spec.ts` — **12/12**:
gate unit rules (no cadence ⇒ never skips; `sync_paused`
markers are not the last sync; per-kind window), Woo scheduled
skip with NO new SyncJob row, scheduled-after-window proceeds,
manual-inside-window proceeds, pause-wins-over-cadence, Shopify
scheduled skip, and setSyncInterval set/clear/range/404.

## CC30(b) — Per-account usage insights

`GET organizations/:id/connections/usage?days=7|30|90`
(OWNER/ADMIN; invalid days fall back to 30), computed ONLY from
real rows, grouped per account with the overview's own target
identity (`ConnectionUsageService`):

- **Messaging integrations:** ChannelMessage rows on
  ChannelConversations BOUND to the integration
  (`conversation.integrationId`), split by direction, in window.
  Conversations with `integrationId` NULL on the same channel
  (legacy rows) cannot be attributed to any one account: their
  messages are reported ONCE in the org-level `unattributed`
  list. An integration with NO bound conversations while
  unbound ones exist on its channel reports `null` counts with
  `attribution: "unavailable"` — its share of the pool is
  unknowable and is never guessed. Practice conversations
  (synthetic) are excluded everywhere.
- **Social accounts:** SocialPost rows with status `published`
  and `publishedAt` in window.
- **Store integrations:** Order rows whose `storeId` is the
  integration's store AND whose `source` matches the provider —
  the schema's actual order linkage (Order carries no
  integrationId), so attribution is labelled `"store"`. An
  integration with no store ⇒ null + `"unavailable"`.
- **Courier integrations:** CourierShipment rows carrying the
  CC29 `integrationId`; legacy NULL rows are the per-provider
  unattributed bucket — never silently assigned.
- **Payment gateways:** TenantPaymentTransaction rows with
  status `verified_paid` AND environment `live` only (CC19
  sandbox test rows never count as volume). Own gateways group
  by `gatewayId`; platform enablements by (source `platform`,
  provider). Volume is summed as BigInt and returned as a
  string; currency is reported only when uniform across rows.
- **Cost:** ONLY from the org's own entered rates on
  MessagingSenderConfig (`whatsappCostPerMessageMinor`,
  `emailCostPerMessageMinor`) × the attributed SENT count,
  returned with the rate and labelled an estimate from the
  org's rate in the UI. Rate absent ⇒ cost null. (SMS has a
  per-PART rate and no per-integration SMS stream exists in the
  inbox schema — no SMS cost is ever estimated here.)

Web: `UsageInsightsPanel` on the connections page (window
switch 7/30/90, per-account table, verified volume via
`formatTakaMinor`, cost labelled as the org-rate estimate,
unattributed section with explicit no-guess copy). OWNER/ADMIN
only — other roles see nothing rather than invented numbers.

## CC30(c) — Deliverability surface

`GET organizations/:id/connections/deliverability`
(OWNER/ADMIN), STORED state only — this read path runs no DNS
lookup and no provider call.

- **Email SPF/DKIM — scoped down, plainly:** MS4's domain
  health (`MessagingService.getDomainHealth`) computes SPF/DKIM
  LIVE from DNS TXT records at read time and persists NOTHING —
  there is no stored status and no last-check timestamp anywhere
  in the tree. The surface therefore reports what IS stored —
  the tenant sender config's From domain and whether a DKIM
  selector is set — with `spf.status = "not_recorded"` and
  `dkim.status = "not_recorded"` (selector set) or
  `"not_checked"` (no selector — MS4's own word for that case),
  plus a note pointing at the live Messaging → Domain health
  view.
- **SPF/DKIM is NOT added to the CC12 monitoring state
  machine** — the fallback the task allowed, chosen
  deliberately: that machine derives per-target states from
  STORED account fields (with a recorded alert-state row per
  target). A DNS-derived state has no stored check record
  behind it; transient DNS failures read as "unknown" in MS4's
  own semantics and would flap the state hash and alert on
  noise. The clean path is a persisted domain-health check (a
  Doctor-kind record the sweep can diff) — a follow-up, not a
  clean fit inside CC30. CC30 surfaces without alerting.
- **Meta business verification:** the tree stores NO business
  id on SocialAccount / AdAccount / Integration records (the
  only stored `businessId` is `CatalogRecord`'s, which belongs
  to a catalog, not to an account). So the CC15 refresh
  (`ProviderHealthService`) now reads the business from the
  account's OWN Graph node — `?fields=business{id,verification_status}`
  for a meta_page SocialAccount (and its messaging-integration
  twin) and for a Meta AdAccount — in a separate,
  failure-isolated call on the same token. What Graph returns
  is stored VERBATIM as `snapshot.business = { id,
  verificationStatus? }` (absent field ⇒ absent key — unknown
  stays unknown; no business id is ever taken from another
  record or guessed, and no `/{businessId}` call is made). A
  FAILED business call stores nothing about the business — the
  error rides the refresh RESULT as `businessError`, because
  the snapshot's own fetch succeeded and marking it failed
  would falsely stale good data. This preserves CC14's pinned
  ad-account snapshot contract (`cc14-provider-health.spec.ts`
  unmodified, green). The deliverability read lists every
  meta_page / ad-account row that HAS a snapshot, with
  `verificationStatus: null` when the snapshot carries no
  business. The account card's completeness list also gains a
  "Business verification (Meta)" item from the same snapshot.

Spec: `apps/api/src/connections/cc30-usage-deliverability.spec.ts`
— **14/14** (plus cc14's 12 re-run green): attributed messaging
counts + rate cost, rate-absent cost-null, days fallback/narrowing,
unavailable + bucket + practice exclusion, courier legacy bucket,
published-posts window, store linkage + store-less unavailable,
verified-only/live-only gateway volume + platform grouping,
deliverability stored-state cases, snapshot business read, and
the three ProviderHealthService business-fetch cases (verbatim
store, failure isolation, absent ⇒ absent).

---

## Gates (sequential, final code state)

Two gate-driven fixes landed after the feature commits and are
committed with these docs: the `GET usage` controller handler
was renamed (`usage` clashed with the injected service property
under tsc — jest's per-file compile did not catch it; the route
is unchanged), and one CC14-era web test's pinned
`completenessItems` expectation gained the CC30
business-verification item (state `unknown` — the test's
"never yes/no without an answer" contract is intact).

| Gate | Result |
|---|---|
| API jest (full, `--runInBand`, `NODE_OPTIONS=--max-old-space-size=4096`) | **339/339 suites, 3464/3464 tests — all pass**, run TWICE on the final code state (the known cx3-debounce flake did not appear in either run; no worker-OOM) |
| Web vitest | **332/332** (41 files) |
| tsc | api **0** / web **0** / admin **0** errors |
| prisma validate | valid |
| Fresh-Postgres full sequence | **160/160 migrations applied** (159 prior + `20261013450000_cc30_sync_cadence`), 210 public tables; `Integration.syncIntervalMinutes` verified present; throwaway DB dropped after |
| Monorepo build (`pnpm@9.15.0 -r build`) | green (exit 0) |

Baseline movement vs B12: API +2 spec files (cc30-cadence 12,
cc30-usage-deliverability 14) → 337 → 339 suites, 3438 → 3464
tests; migrations 159 → 160.

## Honest limits

- **No live provider proof for anything in this batch** — no
  real Meta Graph business answer, no real store sync cadence
  cycle, no real DNS/domain state was exercised. Everything is
  spec/fixture-proven. M30 live verification remains entirely
  owner-owed (see `connect-center-next-summary.md`).
- The new migration has **not run on any real database**
  (fresh-Postgres sequence only, as always).
- Whether Graph actually returns `business` for a given Page /
  ad-account node depends on the app's permissions and the
  account's Business Manager linkage — when it does not, the
  failure-isolation keeps the status honestly unknown instead
  of erroring the whole health refresh.
- The usage read scans at most 50,000 message rows per
  account/channel bucket per request (a stated cap in the
  service); beyond that the count is a floor, not an exact
  figure — acceptable for a 90-day insights panel, recorded
  here rather than hidden.
- Nothing in this batch is pushed or deployed; the push gate
  remains the owner's explicit instruction, as always.
