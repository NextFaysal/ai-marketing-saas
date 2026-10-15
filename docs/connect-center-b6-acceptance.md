# Connect Center Advanced B6 (CC11+CC12+CC13) — Acceptance (2026-10-14)

Branch `cc-advanced`, worktree `~/workspace/ai-marketing-saas-adv`, base
integration-2 `21dec09`. Local commits only — NO push.

## Commits
- `cda1366` schema: ConnectionHealthCheck + ConnectionAlertState /
  ConnectionAlert / ConnectionAlertPreference; migration `20261013310000`
- `3449ffc` api: Connection Doctor (live diagnostics over existing clients,
  `not_checkable` honesty), monitoring sweep (`connection_health_sweep` job;
  state-change alerts — in-app + EmailProvider message-id-counted email;
  preferences/snooze), per-target timeline; overview gains `lastCheck` +
  `unreadAlerts`
- `efde374` specs: doctor step honesty (provider fail verbatim,
  not_checkable never passes, diagnose-all cap), sweep state machine
  (7/3/1-day thresholds, snooze freeze, category prefs, email counting),
  timeline aggregation/filter/cursor; overall = fail if any real step fails
- `255a62b` web: per-card Doctor (step pills + history), timeline with
  "শুধু সমস্যা" filter and real retry actions only (re-diagnose, store
  re-sync; webhook status shown from the stored record — no fake
  re-register button, that is CC16), snooze, header AlertsPanel with
  unread badge, diagnose-all, run-sweep, preferences

## Gates (implementation commits landed 2026-10-13; the builder was lost to
a transport failure before gates — gates run and verified directly
2026-10-14)
- API jest FULL #1: 310 suites / 3031 tests — **1 failed, 3030 passed**
  (failing test not identified in that run's tail output).
- API jest FULL #2 (identical tree): **310/310 suites, 3031/3031 PASS.**
- cx3-debounce solo ×3 on the same tree: 18/18, 18/18, **17/18** — the
  known CX-era flake is demonstrably intermittent on this exact code and
  B6 touches no inbox/debounce path. The run-#1 failure was never named,
  so it is recorded as *consistent with* the cx3 flake, not proven to be it.
- Web vitest FULL: **243/243 PASS**. tsc api + web: **0 errors**.
- Prisma validate: **valid**. Fresh Postgres 16 migrate deploy:
  **146/146 clean** (194 tables; CC11 migration last).
- next build: **green**, `/dashboard/connections` route present.

## Honest limits
- No live provider proof: every Doctor check is spec-proven at the
  stubbed-client boundary; real Meta/courier/gateway accounts are M30.
- Kinds without a real check report `not_checkable` (e.g. SMS senders,
  SSLCommerz/Nagad config-level) — never a fabricated pass.
- The sweep is a per-org job (`connection_health_sweep`) — it must be
  enabled per org at deploy, like the other sweeps; it does not run by
  default.
- Migration `20261013310000` has not run on any real DB.
- Webhook re-register/repair is CC16 (B7) — B6 shows stored status only.
