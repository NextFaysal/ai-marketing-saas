# Messaging Advanced MB6 (MX15 + MX16) — Batch Acceptance

Status: CODE-COMPLETE in worktree `~/workspace/ai-marketing-saas-mx`,
branch `messaging-advanced`, base `9e1958f7` (MB5 head). **Local
commits only — nothing has been pushed.** No live provider proof
anywhere in this batch (M30 still owed); the two MB6 migrations
have NOT been run on any real DB (fresh-Postgres proof only, in
the Gates section below).

Per-item detail: [messaging-mx15-acceptance.md](messaging-mx15-acceptance.md) ·
[messaging-mx16-acceptance.md](messaging-mx16-acceptance.md)
(Package close-out: [messaging-advanced-package-summary.md](messaging-advanced-package-summary.md).)

## Process note — how this batch doc came to exist

Both item workers (MX15, MX16) completed and committed their work
(9 commits, HEAD `b9c29ada`), but the batch coordinator died
before running the batch gates or writing this doc — its
completion handoff carried only a runtime note that a background
exec's result was never delivered. This doc, the full batch
gates, and the package close-out were therefore completed by a
separate **finisher run**, working from the committed tree and
the two per-item acceptance docs. One contamination incident had
to be cleaned up first: the dead coordinator's detached gate
script was still running when the finisher started its own jest
run, and the two runs interleaved writes into the same
`.gate-jest.log` / cache, corrupting both runs' evidence (the
coordinator's run recorded empty/OOM-killed summaries for the
four largest groups; the finisher's first log was likewise
untrustworthy). The finisher killed its own attempt, discarded
the contaminated log as evidence, and re-ran the full suite
clean with isolated scratch paths (cache, TMPDIR and per-group
raw outputs on the workspace disk, outside the worktree). The
gate numbers below are from that single clean run plus the one
solo rerun it required (admin — see Gates).

## Commits

| Item | Commits |
|---|---|
| MX15 | `8e0812e1` governance API + migration `20261019070000_mx15_governance` · `71661e8b` specs 22/22 · `5d98a80b` web · `6afed3af` acceptance (incl. the full MB6 Step-0 audit) |
| MX16 | `48efd275` API + migration `20261019070100_mx16_analytics_ai` · `b42eb09c` specs 23/23 · `78baf13b` web · `87cf5941` jest-cache cleanup · `b9c29ada` acceptance |
| MB6 | this doc + the package close-out (summary + live checklist), by the finisher run |

## Step 0 — audit findings (condensed; full text in the MX15 doc)

1. **Health data:** `MessageDelivery` carries the send outcome +
   a separate lifecycle (`deliveryStatus/deliveredAt/readAt/
   openedAt`), but NO bounce field, NO complaint field, and NO
   per-delivery sender field. Delivered/read are real only for
   WhatsApp (Meta webhooks) and on-site (MX14); email/SMTP has no
   delivered signal and SMS has no DLR — incapable stages read
   `null`. NO auto-suppression and no suppression thresholds
   existed before MX15; the only webhook path that can carry a
   hard failure is the WhatsApp status path. MS4's
   `getDomainHealth` (SPF/DKIM) is a domain view only.
2. **MS5 compose-check** validates spam words (EN+BN lists),
   shouting subjects, link stuffing, missing subject, SMS parts,
   body length — advisory only. It does NOT check URL validity,
   tracked-link membership, variable fill, or image sizes: those
   are the honest v2 additions.
3. **Roles/status/audit:** WRITE_ROLES = OWNER / ADMIN /
   MARKETING_MANAGER for campaign actions; OWNER/ADMIN own
   sender/settings writes. The Broadcast status machine is
   per-method enforced; MX15 adds one state (`pending_approval`).
   `AuditService` is the existing audit sink messaging already
   uses.
4. **Rates/balance:** the one estimator (`buildCostEstimate`)
   works only from org-entered rates; **no messaging balance or
   credit figure exists for an org** (the CC10 wallet is
   platform-payment money, unconnected to messaging) — budget
   governance is therefore spend-based, and "low-balance
   warning" was refused rather than invented.
5. **Analytics/attribution:** per-broadcast funnels + failure
   grouping + 7-day revenue ASSOCIATION exist; **there is no
   honest join between a messaging delivery and a
   Touchpoint/AttributionCredit** (no shared key) — presenting
   attribution numbers for messaging would be fabrication. A
   scheduled-report system DOES exist (GB8 `ScheduledReport`);
   messaging plugs into it as a new report type.
6. **A/B machinery:** two Broadcast rows, deterministic hash
   split at prepare, per-variant funnels + a suggestion that
   picks nothing. The honest auto-winner seam is the chunk
   boundary of the MX1 recipient-table path, where state is
   re-read between chunks.
7. **MS9 AI guard path** (kill-switch → 403, daily cap → 429,
   both before any provider call; usage recorded only after a
   usable response; returned-only outputs) is the mandatory path
   for every MX16 AI feature.

## MX15 — Deliverability, Reputation & Governance (shipped)

- **Health dashboard** (`GET …/messaging/health?days=`): real
  `MessageDelivery` aggregates per channel + totals; failure
  rate only where attempts exist; delivered/read rates only for
  whatsapp/onsite; **bounce/complaint rates are `null` on every
  channel with the reason stated**; per-sender is `null` with
  the reason (no sender identity is recorded); the MS4 SPF/DKIM
  domain view rides along. Unreadable data ⇒ `available:false`,
  never invented figures.
- **Auto-suppression gap closed on the one existing path:** a
  WhatsApp `failed` transition whose provider error matches the
  hard-recipient-failure patterns (Meta 131026/131030/131047/
  131051 + unambiguous titles) writes `opted_out` into the SAME
  MS2 preference store (source `auto_suppression`, consent event
  recorded). Template/quality/rate failures suppress nobody
  (spec-proven both ways). No email/SMS path exists to close.
- **Pre-send checklist v2** (`compose-check-v2.ts`) EXTENDS MS5
  (v1 warnings included verbatim): URL_FORMAT (format only —
  reachability never claimed), LINKS_TRACKED, VARIABLES_SAMPLE
  (renders a real resolved sample ≤5), IMAGE_SIZE (runs only
  where stored size metadata exists — none does today, so it
  honestly reports not_run; the metadata branch is spec-proven),
  SPAM_HEURISTIC (org-visible word lists, labelled heuristic in
  API + UI). Every check states what it actually verified.
- **Seed/test list** (`MessagingSeedRecipient`): org-maintained
  internal recipients; one-click test sends go through the
  EXISTING `testSendBroadcast` verbatim — no new send machinery.
  Push/onsite seeds honestly refused (no typed address).
- **Approval workflow (owner decision D2 — org setting, default
  OFF):** when ON, a non-approver's broadcast is born
  `pending_approval` and cannot be queued/scheduled/sent by ANY
  path (gate at `sendBroadcast`/`scheduleBroadcast`/
  `prepareBroadcast`); **four-eyes — the creator can never
  approve/reject their own**, even as an approver; approve
  restores `scheduled`/`draft`, reject keeps the gate closed
  until re-submit; every transition is audit-logged. When OFF,
  behaviour is byte-identical (spec-proven end-to-end OFF send).
- **Budget governance — spend caps only:** per-broadcast cap
  (broadcast field overriding the org default) + monthly cap,
  both computed from org rates × sends and enforced at the ONE
  send choke point (`processBroadcast`, fresh sends only;
  partially-sent broadcasts are never re-gated). **Cannot-
  estimate decision (recorded in the MX15 doc):** when no
  org-entered rate exists (always for push/telegram/onsite),
  the check **ALLOWS with a visible warning** naming the missing
  rate, instead of blocking channels the org was never asked to
  price.

## MX16 — Analytics & AI v2 (shipped)

- **Comparative analytics** (`GET …/messaging/analytics` + CSV
  export): cross-broadcast + per-channel funnels computed ONLY
  from real rows, reusing the existing `broadcastFunnel` /
  revenue code paths; incapable stages stay `null` in the API,
  "—" in the UI, EMPTY in the CSV — never 0 (fixture-proven,
  incl. CSV == screen aggregates). Export is audit-logged.
- **Attribution honesty:** every revenue figure is labelled
  **association** (payload label, CSV, scheduled report, UI);
  the payload carries `attribution: null` + the note that no
  honest Touchpoint join exists. Nothing presents association
  as attribution.
- **A/B auto-winner (owner decision D3 — default OFF):** named
  rule in code + UI — two-proportion z-test (pooled, two-sided),
  α = 0.05, |z| ≥ 1.96, **minimum 100 SENT per variant**; the
  metric is one the channel honestly reports (read for
  WhatsApp/on-site, clicks for email/SMS; push/telegram refuse
  with `metric_unavailable`). Opt-in resolution: explicit false
  on either variant disables the pair; else explicit true; else
  the org switch (default false). Evaluated at each chunk
  boundary of the recipient-table path; once decided, the
  loser's remaining `pending` recipients receive the WINNING
  variant's content; the decision (winner, metric, z, p, inputs,
  timestamp, rule text) is recorded on BOTH Broadcast rows +
  audit event. Guardrails spec-proven: never before min sample,
  never on tie/within-threshold, never twice, cascade pairs
  refused. Legacy snapshot broadcasts are NOT covered (stated
  in the report's scope note).
- **Scheduled messaging report:** `messaging_summary` plugged
  into the EXISTING GB8 ScheduledReport system (type + label +
  generator branch; no second scheduler, no finance→messaging
  service import); association-labelled, null stages blank.
- **AI v2 — all through the MS9 guard path verbatim,
  returned-only, zero writes (spec-proven):** (a) campaign
  planner → a full PROPOSAL (audience draft validated by the
  real validator and returned WITH its errors, never corrected
  or applied; content, channel, timing) that a human applies
  piece by piece — with no real LLM it returns an honest **502**
  rather than a templated fake plan; (b) per-recipient
  send-time suggestion — a DETERMINISTIC statistic (modal Dhaka
  hour over real click/open/read timestamps, minimum 5 events,
  otherwise `available:false` with the real count), labelled as
  a statistic, not AI; (c) Bangla↔English translation draft —
  returned only, inserted by an explicit click; no real LLM ⇒
  honest 502; (d) subject-line quality — a HEURISTIC score with
  its factors shown (length, personalization token, spam-list
  overlap, caps ratio, punctuation), labelled heuristic
  everywhere, never a measured prediction.

## Gates (finisher-run, serial — recorded as each finished)

- **API jest (full): 503 suites / 5,694 tests — 5,692 passed, 2
  failed.** Both failures are the known pre-existing,
  base-adjudicated ones; MB6 touches no connections or admin
  code:
  - `connections/cc26-payout-automation.spec.ts` (1 test) — the
    payout-sweep failure adjudicated on the untouched base
    during the GC-stack release and reproduced at every MX
    batch gate (MB1–MB5).
  - `admin/adx3-nav-counts.spec.ts` (1 test — "counts every
    field from real rows with the page definitions", expected 1
    / received 2) — PROVEN at MB5's gate to fail identically on
    the pristine MB4 base `2216c8fa` (time-sensitive nav
    counts); MB5 and MB6 touched no admin code.
  Run method, recorded honestly: grouped by spec-file directory
  (66 groups), serially (`--runInBand`), 4 GB heap, jest cache
  AND TMPDIR on the workspace disk in isolated scratch outside
  the worktree, per-group raw outputs retained. The grouped
  sums were 500 suite-executions / 5,610 tests / 5,609 passed —
  the `src/admin` group was OOM-killed mid-run under
  shared-machine load (5 suites PASS + `Killed` in its raw
  output), and nested directories (ads/meta, ai/llm,
  integrations/{commerce,shopify,woocommerce}) plus the
  social/social-proof prefix overlap execute 17 suites twice
  across groups. The admin group was therefore rerun alone:
  20 suites / 216 tests, 215 passed (sole failure adx3 above).
  Distinct totals: 500 − 17 (double-executions) + 20 (admin
  solo) = **503 suites** — exactly the spec files on disk;
  5,610 − 132 (double-executed tests) + 216 = **5,694 tests**;
  5,609 − 132 + 215 = **5,692 passed**. Delta vs MB5 (501 /
  5,649) is exactly +2 suites / +45 tests = MX15's 22 + MX16's
  23. The messaging group: 30 suites, all pass. The cx3-debounce
  flake did not appear in this run.
- **API tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Web vitest: 83 files / 706 tests, all pass** (same totals as
  MB5 — MB6 added no web vitest files).
- **Web tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Next build (apps/web): green** — `✓ Compiled successfully
  in 66s`, static pages 93/93, `/dashboard/messaging` at
  64.2 kB (MB5: 55.7 kB — the growth is the MX15 Governance and
  MX16 Analytics sections).
- **Prisma validate: valid.** Migration folders on this tree:
  **226** (211 base + 15 MX).
- **Fresh-Postgres migrate deploy: 226/226 migrations applied
  cleanly** (`All migrations have been successfully applied.`)
  on a brand-new empty cluster created for this gate (embedded
  PostgreSQL 18.4, as at MB5 — the sandbox has no system
  Postgres); 326 public tables afterwards (325 at MB5 +
  `MessagingSeedRecipient`); verified in the fresh DB: both MB6
  migrations recorded in `_prisma_migrations`,
  `MessagingSeedRecipient` present, `Broadcast.approvalStatus /
  budgetCapMinor / abAutoWinnerEnabled / abWinnerVariant /
  abWinnerAt` present, `MessagingSetting.approvalEnabled /
  broadcastCostCapMinor / monthlySpendCapMinor /
  abAutoWinnerEnabled` present.

**Batch gate verdict: GREEN** — the only failing tests in the
entire suite are the two pre-existing, base-adjudicated failures
(cc26, adx3-nav-counts), both disclosed above; no fix commits
were needed from the finisher (no MB6-caused failure appeared).

## NOT BUILT / honest limits (batch-wide; per-item evidence in the per-item docs)

MX15:
- **Low-balance warning / any balance-based governance** — no
  messaging balance or credit figure exists for an org (the
  CC10 wallet is platform-payment money, unconnected to
  messaging). Inventing one was refused; caps are spend-based
  and labelled so.
- **Email bounce/complaint auto-suppression** — no email
  bounce/complaint webhook exists anywhere in this system
  (send-only SMTP); the WhatsApp hard-failure path was the only
  one that existed, and it is the one closed. SMS has no DLR
  path (unchanged).
- **Bounce/complaint RATES on the health dashboard** — no record
  carries such a signal; the rates are `null` with the reason,
  in the API and the UI. (WhatsApp post-send failures ARE
  visible — as failure rate/reasons.)
- **Per-sender health rates** — delivery rows record no sender
  identity; the response carries `perSender: null` with the
  reason plus the SPF/DKIM domain view instead.
- **Image-size verification from real assets** — no asset store
  records image byte sizes, so the check reports not_run in
  production today rather than fetching images; the
  metadata-present branch is built and spec-proven.
- **URL reachability checking** — deliberately not run: format
  and tracked-set membership only, stated in the check itself.
- **Approval for workflow/journey sends** — approval is a
  BROADCAST governance feature; workflow send steps are a
  different, already-running automation surface.

MX16:
- **Auto-winner on the legacy snapshot send path** — the
  snapshot path has no per-chunk recipient table to redirect
  honestly; the boundary is stated in the report `scopeNote`
  and the UI.
- **True attribution (Touchpoint/AttributionCredit) for
  messaging** — no honest join exists (Step-0 point 5); all
  figures stay association-labelled.
- **Planner/translation with no real LLM** — honest 502 instead
  of a templated fake (the dev provider cannot plan or
  translate); with a real LLM configured, both work through the
  same guarded code path.
- **Auto-winner for cascade A/B pairs** — ref
...[truncated 1055 chars]