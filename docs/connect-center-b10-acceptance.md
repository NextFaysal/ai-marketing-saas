# Connect Center Next — B10 Acceptance (CC21 + CC22 + CC23)

Branch `cc-next`, base integration-4 HEAD `3d4eb4b`. Local commits
only; nothing pushed. One new migration:
`20261013360000_cc21_cc23_b10` (Integration.autoHealEnabled,
PayoutRequest.approvedById, TenantPaymentTransaction.ipnEvents).

## CC21 — Auto-healing

**Built: commerce webhook re-registration only.**
`ConnectionHealingService.autoHealCommerceWebhooks` runs inside the
existing CC12 sweep (after the alert state machines, so a successful
heal surfaces as a "recovered" transition on the NEXT sweep rather
than silently swallowing the alert that reported the breakage).

- Trigger is a REAL detected breakage only: the store's stored EC2
  webhook record (`Integration.webhookStatus`) reports a topic
  failed / error / missing / not_registered (the same
  `webhookSummary` test the monitor uses). No record or a healthy
  record = no attempt, ever.
- Repair goes through the EXISTING path —
  `ProviderHealthService.repairWebhooks` → the EC2/CC16 registrars
  (ShopifyService.repairWebhooks / IntegrationsService
  .repairWooWebhooks). The outcome is judged by RE-READING the
  stored record afterwards, not by trusting the call's return.
- Caps: at most 1 attempt per target per sweep (each target is
  visited once) and at most **3 attempts per target per day**,
  counted from the real `connection.auto_heal.webhook_attempt`
  AuditLog rows of that day — the cap survives restarts and is
  itself auditable. Spec-pinned, including "yesterday's attempts
  don't count" and the cross-sweep accumulation.
- Recording: one `connection.auto_heal.webhook_attempt` audit row
  before the repair and one `connection.auto_heal.webhook_result`
  (outcome healed | still_bad | error, verbatim detail) after.
  Both carry entityType Integration / entityId = the integration,
  so they appear in the CC13 per-connection timeline with no new
  timeline code.
- Opt-out: `Integration.autoHealEnabled` (default true), toggled
  via `PATCH connections/:integrationId/auto-heal` (OWNER/ADMIN),
  surfaced in the overview account, on the account card (badge +
  toggle), and in the commerce diagnostics payload/panel.
  Detection and alerts are unaffected by the opt-out — only the
  repair attempt is skipped.
- A failed repair never throws into the sweep; the still-broken
  state keeps flowing through the normal CC12 alert machine.

**NOT attempted — Meta token refresh (CC21a), and why.**
The sub-item was stopped per its own stop-rule after a repo-wide
search: this tree contains **no** Meta long-lived-token exchange
(`fb_exchange_token`) seam anywhere — no token service, no
exchange call in api/web/admin/packages. Concretely:

- Meta credentials enter by token paste / connect flows and are
  only ever READ (`metaTokenForOrg` / `metaTokenForAccount` in
  common/meta-graph.ts decrypt and return the stored token).
- `SocialOAuthService.ensureAccessToken` — the one real refresh
  dispatcher — supports TikTok / YouTube / LinkedIn refresh
  tokens and explicitly throws "OAuth refresh is not supported"
  for Meta platforms; Meta social/messaging credentials carry no
  refresh token to exchange.
- The only Graph `oauth/access_token` call in the tree is the
  Admin probe's `client_credentials` APP-token mint
  (admin.service probeMetaApp) — an app token, not a user/page
  token exchange, and not usable to rotate a tenant credential.

Building a new Graph exchange client was explicitly out of bounds
("report the gap precisely instead of inventing a client"), so
expiring Meta tokens keep exactly the CC12 behaviour: 7/3/1-day
expiry alerts and Doctor detection. If a future package is
approved to ADD the exchange seam (new MetaTokenExchangeClient
against `GET /oauth/access_token?grant_type=fb_exchange_token`,
app credentials resolved platform-vs-own exactly like CC4's
TikTok refresh), CC21a can then be wired into the same sweep
hook with the same attempt/result recording.

**→ Closed by B10.5 (2026-10-15): the seam was approved and
built exactly as sketched above. See the B10.5 addendum at the
end of this document — CC21 is now complete, (a) + (b).**

**Also not attempted:** Meta app-level webhook subscriptions
(they belong to the operator's Meta app, not to a tenant
connection — there is no per-connection registrar), and any
"repair" that would be a guess (revoked apps, changed
passwords, lost scopes) — detection + alert only.

## CC22 — Health analytics

`GET organizations/:id/connections/health-analytics`
(OWNER/ADMIN), computed by `ConnectionAnalyticsService` from
REAL `ConnectionHealthCheck` rows only — no live provider
calls, no estimates.

- Per account (identity = the overview's source + id, the same
  identity the Doctor records): checks / passed / failed /
  degraded in the last 30 days, uptime %, last failure time +
  kind, and 14 daily buckets.
- **Definitions (spec-pinned):** a run's outcome is its stored
  `overall` — pass = ok, fail = failed, **partial = degraded.
  Degraded counts as NOT ok for uptime**: it sits in the
  denominator (`pass / (pass+fail+degraded)`) and never in the
  numerator, and is also reported as its own count. Last
  failure "kind" = the failed step keys of the newest failed
  run (fallback `doctor_fail` when a run stored no steps).
- Zero-check accounts return explicit nulls for uptime /
  last-failure / daily pass-rates — never 0% and never 100%.
- Org worst-5: lowest uptime among accounts with ≥ 5 checks in
  the window (a single bad run cannot brand an account), ties
  broken by more checks first.
- Web: a compact panel on the Connect Center page fed only by
  this endpoint (table + 14-day sparkline + worst strip); for
  non-OWNER/ADMIN roles the fetch fails and the panel renders
  nothing rather than inventing numbers.

## CC23 — Security step-up

**(a) Tenant TOTP step-up** — `StepUpService` reuses M35
verbatim: the acting user's User row (`totpEnabled` +
`totpSecretEncrypted`, written by the auth enrol/confirm flow)
and `common/totp`'s `verifyTotp` (the login-challenge
verifier). No TOTP reimplementation, no second secret store.

- Applied to: tenant gateway **delete**, tenant gateway
  **disable** (the sensitive direction — re-enabling needs no
  step-up), tenant **app-config delete**, and **payout-request
  create**.
- TOTP enabled → a valid code is REQUIRED; missing/invalid =
  Bengali 403 from a check that runs BEFORE any mutation
  (specs pin "nothing changed" for every surface).
- TOTP not enabled → the action proceeds and the response
  carries `stepUpUnavailable: true`; the web surfaces it as an
  enrolment nudge. It is never silently implied that a step-up
  happened. (One pre-existing spec — cc3's exact-shape delete
  assertion — was updated to the extended response contract.)
- Codes travel in the DTO body for PATCH/POST and as a query
  parameter for DELETEs (DELETE bodies are unreliable across
  clients); both are enforced in the service, not the
  controller.

**(b) Admin four-eyes payouts.**

- `walletConfig.payoutFourEyesThresholdMinor` (nullable,
  validated integer ≥ 0 in the admin config write; null/unset
  = feature OFF, mark-paid behaves exactly as CC10). Read via
  the platform-config snapshot (`effectivePayoutFourEyes
  ThresholdMinor()`), set from the Admin Settings wallet card.
- `PayoutRequest.approvedById` (new column) is persisted at
  approve time — `decidedById` is overwritten by later
  decisions, so four-eyes needed its own record.
- Semantics: at mark-paid, when the threshold is set AND the
  amount ≥ threshold AND a recorded approver exists AND the
  acting admin IS that approver → Bengali refusal naming the
  rule, the amount and the threshold; the request stays
  approved and untouched. A second admin can complete it.
  Below-threshold, feature-off, and pre-CC23 rows (no recorded
  approver — four-eyes cannot apply retroactively) are
  unchanged; regression-pinned by the untouched CC10 payout
  suite plus new specs.

**(c) IPN anomaly alerts.**

- Groundwork honesty: this tree's CC19 work stored only
  VERIFIED payloads (`ipnPayload`); a rejected IPN left **no
  trace at all** — there was no `ipnEvents` record to count.
  B10 therefore ADDS the recording it counts: the SSLCommerz
  IPN path appends `{ kind: "signature_invalid", at, detail }`
  when signature verification fails and
  `{ kind: "amount_mismatch", ... }` when the validation-API
  confirmed amount differs; the bKash callback appends
  `amount_mismatch` on its confirmed-amount mismatch. The list
  lives on `TenantPaymentTransaction.ipnEvents` (capped at the
  last 50, credential-free details only), changes no status /
  order / wallet, and its writer is failure-isolated so the
  gateway always gets its response.
- Counting: the sweep counts events of those two kinds with
  event timestamps inside the last 24h across the org's
  transactions. A verified IPN records NO event, so legitimate
  traffic can never count — spec-pinned.
- Alerting: at ≥ 3, ONE alert per org per day through the CC12
  `notify()` machinery (in-app ConnectionAlert + agent
  notifications + email counted by real message ids), deduped
  by a recorded `ConnectionAlertState` row
  (`payment_security:<orgId>`, state `ipn_anomaly:<date>`) —
  not a process flag. The alert respects the org's alert
  category preferences (category "payment"). One real bug was
  caught by the spec here: the dedupe row was first written
  WITHOUT `organizationId`, which would have made the dedupe
  silently never persist against a real database.

## Gates (run sequentially on the 2-core/8GB sandbox)

- **API jest, serial** (`--runInBand`, the package's own test
  mode): **329/329 suites, 3327/3327 tests — all pass.**
  (329 = integration-4's 326 + the 3 new B10 spec files;
  3327 = 3298 + 29 new B10 tests: CC21 ×7, CC22 ×6, CC23 ×16.)
- **API jest, parallel (first run):** 328/329 suites,
  3322/3327. The four failing suites were all resource/flake
  artefacts, each re-run solo and green: `cx3-debounce` (the
  known pre-existing flake — solo 18/18 twice),
  `campaigns.service.spec` (a 5s hook timeout under parallel
  load — solo 7/7), and two worker-process OOM deaths
  (`social-sp9` — solo 13/13; the inbox media suites — solo
  25/25 across media-intelligence / nextgen-media /
  in5a-transcode). Nothing in B10 touches those areas.
- **Web vitest:** 332/332. **tsc:** api 0, web 0, admin 0.
- **Prisma validate:** valid.
- **Fresh-Postgres migration sequence:** throwaway DB,
  `prisma migrate deploy` — **156/156 applied clean**
  (155 previous + `20261013360000_cc21_cc23_b10`), 204 public
  tables; the three new columns verified present
  (Integration.autoHealEnabled, PayoutRequest.approvedById,
  TenantPaymentTransaction.ipnEvents). Throwaway DB dropped.
- **Monorepo build** (`pnpm -r build`): green — packages
  (ui/contracts/db), worker, api, admin, web all Done.

## Honest limits

- No live proof of anything in B10 (M30 still owed): healing
  has never run against a real store, step-up against a real
  tenant's authenticator enrolment in production, four-eyes in
  the live admin, and the anomaly alert against real gateway
  traffic.
- The migration has run only against a fresh throwaway
  Postgres in the sandbox (full sequence), never on the real
  database.
- CC21a (Meta token auto-refresh) is NOT built — see the gap
  analysis above; it needs its own approved seam-building step.
  **(Superseded 2026-10-15: built in B10.5 — see the addendum
  below. No live Meta proof exists for it either; M30 owed.)**
- Healing covers commerce (Woo/Shopify) webhooks only; the
  daily cap counts attempts by server-local calendar day.

---

## B10.5 Addendum — CC21a built (2026-10-15)

Commit `88cb495` on `cc-next` (base B10 HEAD `94cc3af`). Local
only; nothing pushed. **No new migration** — the pass writes
only to existing columns (`Integration.tokenExpiresAt`,
`IntegrationCredential.encryptedData`) and audit rows.

### The seam

`MetaTokenExchangeClient`
(`connections/meta-token-exchange.client.ts`) — the tree's
standard injectable-fetch client shape (MetaAppClient /
MetaMessagingClient pattern). It calls Graph's
`GET /oauth/access_token` with `grant_type=fb_exchange_token`,
`client_id`, `client_secret`, `fb_exchange_token=<current
token>`, using the shared `graphVersion()` from
`common/meta-graph` (env/admin override — v21.0 default), not
a version invented for this client. A `!ok` response or a
Graph `error` body throws with Meta's message verbatim; a
success body without `access_token` is also a failure. The
return is `{ accessToken, expiresIn | null }` — `expires_in`
absent stays absent, never invented.

### App-credential resolution (no duplicated logic)

`ConnectionHealingService.resolveMetaAppCreds` routes through
the EXISTING appSource machinery, exactly like CC4's TikTok
refresh:
- target `appSource === "own"` → `resolveTenantAppConfig`
  (CC3's shared reader) for platform `"meta"`;
- otherwise → the platform-config snapshot's `metaApp`
  (M33 `metaAppConfig`: appId + decrypted appSecret) after
  `ensurePlatformConfig`.
Neither side yielding a complete pair = **no attempt**: the
target is recorded in the results as
`skipped_no_app_credentials` and counted in the sweep summary
(`metaTokenHealing.skippedNoAppCredentials`). An own-app
target NEVER falls back to the platform app it did not choose
(spec-pinned).

### Targets and the trigger window

A target is the token's owner-facing identity (so caps and
audit land where the CC13 timeline reads them):
- **Messaging integrations** — provider whatsapp / messenger /
  instagram, status CONNECTED; the token lives in the
  integration's own sealed credential. (Ads `"meta"` and
  social `"meta_social"` integrations are not targets in their
  own right; social tokens are reached via their account.)
- **SocialAccounts** — platform `meta_page` / `instagram`
  (the brief's "facebook_page" is this tree's `meta_page`),
  status `connected`, with a linked integration; the token
  lives in that integration's sealed credential.

The stored expiry is whatever the records actually carry —
the credential's `expiresAt` (epoch ms, the SocialOAuth
credential shape) first, else `Integration.tokenExpiresAt`.
A target is attempted only when that expiry's `dayBucket`
(the monitor's own bucketing) is ≤ 3 — the `expiring_3` /
`expiring_1` states — or already past (just expired; whether
a just-expired token can still be exchanged is decided by
the exchange call itself, per Meta's rules). **No stored
expiry = no attempt, ever**: there is no stored breakage
record to act on, and a probe-driven trigger would make the
sweep call Meta for every healthy account on every run.

Honest consequence, stated plainly: today's connect paths
record a Meta token's expiry only when the platform supplied
one (Meta paste-connect stores page tokens with no expiry —
such tokens carry no recorded expiry and are therefore never
attempted). In practice this pass *maintains* tokens whose
expiry is on record — which includes every token the pass
itself has exchanged, because each success writes the fresh
expiry back. It does not discover expiries it was never told.

### Write-back, failure, caps, opt-out

- **Success:** the new token is sealed into the SAME
  `IntegrationCredential` record with every other stored
  field preserved verbatim (`{ ...cred, accessToken }`), the
  credential's `expiresAt` becomes `now + expires_in` (the key
  is REMOVED when Meta returns no `expires_in` — "no expiry
  recorded", the Shopify exchange precedent), and
  `Integration.tokenExpiresAt` moves to the same instant.
  Spec-pinned through the sweep's own derivation chain
  (`deriveHealth` → `deriveFieldState`): a target that was
  `expiring_3` before the heal derives `ok` afterwards.
- **Failure:** nothing is written before the exchange
  returns, so the stored credential stays **byte-identical**
  (spec-pinned by direct string comparison) and the stored
  expiry is untouched; the attempt is recorded, Meta's
  verbatim message is kept in the result row, and the normal
  CC12 alert flow reports the still-expiring state. A sibling
  case is handled by re-reading the credential owner before
  each attempt: a Page and its Instagram account sharing ONE
  integration produce ONE exchange — the sibling is reported
  `skipped_no_longer_expiring`, not re-attempted.
- **Recording:** `connection.auto_heal.meta_token_attempt` /
  `connection.auto_heal.meta_token_result` audit rows with
  entityType/entityId of the TARGET (Integration or
  SocialAccount) — they surface in the CC13 timeline with no
  new timeline code.
- **Cap:** at most **1 attempt per target per day**, counted
  from the recorded attempt rows (server-local calendar day,
  same as CC21b); yesterday's attempts never count.
- **Opt-out — the documented decision:** `SocialAccount` has
  no `autoHealEnabled` column (CC21b put the switch on
  Integration, and the Connect Center exposes the toggle only
  on integration cards), and org alert preferences govern
  notifications, not repair. The token a social account uses
  lives on its linked Integration, so THAT row's
  `autoHealEnabled === false` opts out **both** identities —
  no new column, no new UI, and the switch a tenant can see
  and reach is the one that governs. Messaging integrations
  are governed by their own row, exactly like webhook
  healing. Detection and alerts are unaffected.
- **Sweep wiring:** the monitor's `ConnectionHealingSeam`
  gains an OPTIONAL `autoHealMetaTokens` (older stubs stay
  valid); the pass runs after the alert state machines,
  beside the webhook pass, and the sweep summary gains
  `metaTokenHealing: { attempted, healed,
  skippedNoAppCredentials }`.
- **UI correction:** the Connect Center auto-heal toggle's
  tooltip previously described only webhook re-registration;
  it now also names the Meta token refresh (WhatsApp /
  Messenger / Instagram / Page). No surface claimed Meta
  healing did not exist; the healing service's own header
  comment was updated to match.

### Specs (15 new cases, `cc21a-meta-token-healing.spec.ts`)

Client request shape + verbatim error + token-less body
refusal; window helpers (credential expiry wins, column
fallback, no-expiry null; window = ≤3d incl. just-expired,
5d out); platform-app rotation in place with verbatim field
preservation + expiry move + attempt/result rows + the
derivation-chain pin; own-app exchange under the TENANT's
credentials (platform creds present but unused); own-config
deleted → counted honest skip with zero attempts and no
platform fallback; platform unconfigured → counted skip;
social Page heal through the linked integration (OAuth-shape
expiry rotation, audit on the SocialAccount); failure →
byte-identical credential + verbatim recorded detail;
just-expired attempted; 1/day cap from recorded rows;
opt-out for both identity kinds; never-attempted set
(TikTok in-window, healthy-window WhatsApp, no-stored-expiry
Messenger, DISCONNECTED in-window); Page+IG sibling dedup.

### Gates (sequential, 2-core/8GB sandbox)

- **API jest, serial** (`--runInBand`): **329/330 suites,
  3341/3342 tests.** (330 = B10's 329 + the new CC21a spec
  file; 3342 = 3327 + 15 new tests.) The ONE failure is the
  known pre-existing `cx3-debounce` flake (the "draft mode
  defers too" timing assertion in the inbox debounce spec —
  an area B10.5 does not touch). Proof, per the standing
  protocol: solo re-runs on this HEAD went 17/18 ×3 then
  18/18 ×2, and solo re-runs on the PRISTINE base `94cc3af`
  went 18/18 ×2 then 17/18 — the identical failure occurs on
  the untouched base, intermittently, in both directions.
  Recorded as consistent with the documented flake (root
  cause still open, owner-side), not as a B10.5 regression.
  (An earlier draft of this addendum reported 330/330 from a
  truncated poll read of the background run; the run's full
  output showed the single flake failure, and this section
  was corrected — the numbers above are the run's real
  tail.)
- **Web vitest:** 332/332. **tsc:** api 0, web 0, admin 0
  (tsbuildinfo files restored afterwards).
- **Prisma validate:** valid.
- **Fresh-Postgres migration sequence:** throwaway DB,
  `prisma migrate deploy` — **156/156 applied clean** (B10.5
  adds no migration), 204 public tables; DB dropped.
- **Monorepo build** (`pnpm -r build`): green.

### Honest limits (B10.5)

- No live Meta proof: the exchange has never run against a
  real Meta app/token — specs stub the Graph boundary. A real
  exchange + a real expiring tenant token remain M30 items,
  like everything else in B10.
- The trigger depends on a RECORDED expiry (see above):
  Meta tokens connected by paste, whose records carry no
  expiry, are outside this pass's reach until some flow
  records one. Nothing in B10.5 probes Meta to discover
  expiries — that was a deliberate design choice, recorded
  here, not an oversight.
