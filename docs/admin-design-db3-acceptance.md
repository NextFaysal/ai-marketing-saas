# Admin Design DB3 Acceptance — ADX8 + ADX9 + ADX10 + ADX11

> Package: Admin Dashboard UX Redesign (ADX1–ADX14), Batch DB3.
> Worktree: `~/workspace/ai-marketing-saas-adx`, branch `admin-ux`,
> base DB2 HEAD `1605d3c`. Local commits only — **not pushed**
> (push stays owner-gated, as always). Date: 2026-10-15.
> Plan: `Admin-Dashboard-UX-Redesign-Master-Plan-2026-10-15.md`
> §২ (principles), §৫ Batch DB3, §৮ (gates); structure and honesty
> rules per `docs/admin-ux-architecture.md`. All redesign work uses
> the DB2 Design System v3 (`components/ui.tsx` + globals v3
> classes); no parallel patterns were invented, and **no API code
> was changed in this batch** (no new endpoint was needed — see the
> audit verdict for the one declared client-side addition).

## Commits

| Item | Commit | Summary |
|---|---|---|
| ADX8 | `36fbf9a` | Health traffic-light strip; System → Tabs; Alerts severity groups |
| ADX9 | `1a04736` | Settings Config Hub — sub-nav + hash deep-links, 11 config cards grouped |
| ADX10 | `05c6a41` | Tickets inbox; Audit FilterBar + actor filter + drawer; Security Tabs; Admins v3 states |
| ADX11 | `673d4d0` | Analytics month-window; Usage sortable ranking; Growth Tabs; Social-Ops sections |
| (this doc) | — | acceptance commit |

**Method note.** Every page was restructured by surgical edits or
marker-based block reassembly that moves existing JSX verbatim —
handlers, prompts, messages and payload shapes were never retyped.
Zero-loss is proven mechanically per page (apiFetch target
set-diff + heading/input-id/call-target diffs), not by eyeballing.

---

## ADX8 — Health, System, Alerts

### /health — traffic-light strip
A summary strip ("এক নজরে") at the top, one light per area, each
derived **only from data the page already loads**, each linking to
its card (cards gained anchor ids):

| Light | Derivation (existing payload fields only) |
|---|---|
| Integrations | `ints.broken.length > 0` → 🔴 "Nটি ভাঙা"; loaded & 0 → 🟢 |
| Sync / Automation | `failedSyncJobs.length + errorRuns24h.length > 0` → 🔴; 0 → 🟢 |
| Scheduled Jobs | any enabled job with `lastStatus === "error"` → 🔴; else 🟢 |
| Connections | board summary: broken > 0 → 🔴; atRisk > 0 → 🟡; ok > 0 → 🟢; only noData → ⚪ "শুধু তথ্য নেই" (the board's own honest state, not a guess) |

An area whose data has not loaded / failed renders **no light**.
The detail cards below are byte-identical (Integrations, failed
Sync Jobs + Retry, Connection Health Board + Nudge, Scheduled
Jobs + run-now). apiFetch set-diff: **identical**.

### /system — Tabs (393-line stacked page)
The 10 stacked cards regrouped into ADX4 `Tabs` behind a sticky
tab bar; every card's JSX moved verbatim:

| Tab | Cards (all pre-existing) |
|---|---|
| 🚀 Deploy Readiness | Deploy প্রস্তুতি (env-check details), Version ও Deploy |
| 📬 Queues | Queue Monitor (incl. BullMQ table + AN12 pause/resume/retry-failed actions), Inbox Health, Dead-Letter Queue |
| 🔥 Errors | Error Summary (badge = real `totalErrors`) |
| 💾 Backup | Backup Status, Database Growth |
| 🪝 Webhooks | Webhook Events (+ detail panel) |
| 📜 Activity Log | Activity Log (Audit Trail) |

- **Declared addition — a sixth tab.** The plan named five tabs;
  the page carries a sixth logical card (Activity Log) that fits
  none of the five honestly, so it got its own tab rather than
  being buried inside Errors. All plan-named tabs exist as named.
- **Banner semantics preserved and strengthened:** the AA1
  deploy-readiness banner (identical text/logic) moved out of the
  env card to page level, above the tab bar — it was already the
  first thing on the page; now no tab switch can hide it. The
  in-card duplicate was removed so it renders exactly once.
- Queues tab badge = real `dlq.pending` when > 0 (Tabs renders a
  badge only for a positive number).
- apiFetch set-diff: **identical** (incl. the DLQ replay and queue
  action template calls).

### /alerts — severity groups
**Severity verdict:** the payload (`GET /admin/alerts`) carries a
real `severity` field per alert; the page's existing derivation —
`severity === "high"` → HIGH, everything else → MEDIUM — is kept
unchanged and now drives two headed groups (HIGH first, count per
group). The card JSX inside each group is the original (Org link,
both Nudge buttons untouched).
**Acknowledge verdict:** alerts are *computed, not stored*
(`alertsBoard()` builds them live from integrations/sync/
subscriptions), so **no acknowledge state exists in the data** —
none was shown or invented. Grouping is the whole change.
apiFetch set-diff: **identical**.

---

## ADX9 — Settings Config Hub (the biggest win)

`/settings` (567 lines, 17 stacked cards) is now a Config Hub:
**one page** (settled §৭ decision — no new routes), a sticky left
sub-nav, and content sections. All sections stay **mounted** and
toggle via `hidden`, so unsaved input in a config form survives a
section switch exactly as it survived scrolling before. Every
section's Save/Test feedback goes to the same page-level message
bar as today (all components already shared `setMsg`).

**Hash deep-links:** `#payment-bkash` style hashes resolve on load
and on `hashchange` — aliases (`payment-*`, `apps-*`, …) and direct
block ids (`#config-bkash`) both work; the target section opens,
the block scrolls into view and is ring-highlighted (clears after
4s or on section change). Section nav clicks write `#<section>` to
the URL via `history.replaceState`, so a section link is copyable
without a route change.

### Block → section mapping (complete — nothing unmapped)

| # | Existing block (today's heading) | Section |
|---|---|---|
| 1 | প্ল্যাটফর্ম অবস্থা (Maintenance Mode, Signup, Support যোগাযোগ) | 🧭 সাধারণ |
| 2 | Plan এর দাম (মাসিক) + Plan এর দাম (বার্ষিক) + Plan Limits — all inside block 1's card | 🧭 সাধারণ |
| 3 | 🚨 Kill Switch (Incident Mode) | 🧭 সাধারণ |
| 4 | 🛠 নির্ধারিত Maintenance Window + 🗄 Audit Log Retention (`MaintenanceAndSafety`) | 🧭 সাধারণ |
| 5 | 🌐 Admin IP Allowlist (`MaintenanceAndSafety`) | 🧭 সাধারণ |
| 6 | 🤖 AI / LLM | 🤖 AI ও মিডিয়া |
| 7 | 🖼️ AI Image Generation | 🤖 AI ও মিডিয়া |
| 8 | 📘 Platform Meta App | 🔌 অ্যাপ সংযোগ |
| 9 | 🎵 TikTok App | 🔌 অ্যাপ সংযোগ |
| 10 | ▶️ Google App | 🔌 অ্যাপ সংযোগ |
| 11 | 💼 LinkedIn App | 🔌 অ্যাপ সংযোগ |
| 12 | ✉️ Email (SMTP) | ✉️ বার্তা |
| 13 | 📱 SMS (SSL Wireless) | ✉️ বার্তা |
| 14 | 💳 SSLCommerz | 💳 পেমেন্ট |
| 15 | 📱 bKash | 💳 পেমেন্ট |
| 16 | 🏦 Wallet + four-eyes সীমা | 💳 পেমেন্ট |
| 17 | 🚩 Plan Feature Defaults (AA7) | 🚩 Flags ও Plan Defaults |
| 18 | 📣 Announcement (Targeted — M41) | 📣 ঘোষণা |

One declared structural note: the plan named six sections; the
page also carries platform-state / pricing / kill-switch /
maintenance / allowlist blocks that belong to none of the six, so
a seventh section **সাধারণ** holds them — declared here, nothing
was forced into a wrong section. The config cards were physically
reordered (TikTok/Google/LinkedIn moved beside Meta) by
marker-based block extraction; each card's JSX is verbatim.

**Uniform block pattern verdict:** every config card already
carried the pattern's honest core — the `source` badge
(Admin Console থেকে সেট / Server Env থেকে আসছে / সেট করা নেই),
which is derived from the payload's real `source` +
`secretConfigured` fields. `PlatformConfigView` carries **no
verified-state field** for any block, so per the brief only
configured / not-configured is shown — no "যাচাই হয়েছে" badge was
fabricated; the existing Test/যাচাই buttons remain the way an
operator actually verifies, unchanged.

**Zero-loss evidence (mechanical):** apiFetch target set-diff —
**identical**; every `id="pc-*"` input id preserved (checked one
by one); every `patch("<area>")` target set identical; every
`test(...)` / `testConfig(...)` call set identical. **No config
key, endpoint, payload shape, or save/test behaviour changed** —
this item is arrangement only.

---

## ADX10 — Support & Trust

### /tickets — inbox layout
Master-detail on the existing endpoints: list column
(`minmax(300px,400px)`) + conversation pane. **Ordering verdict:**
the list payload carries `priority` and `lastMessageAt`; rows are
ordered client-side — high priority first, then newest
`lastMessageAt` — and the UI copy says the ordering is applied
on this page over the loaded list (the server status filter is
unchanged). On narrow screens the list hides once a ticket is
selected and a "← তালিকায় ফিরুন" button returns to it; no action
(reply, status, assignee, priority) changed. apiFetch set-diff:
**identical**.

### /audit — FilterBar + drawer
The existing filter row is wrapped in the v3 `FilterBar`
(unchanged controls: action prefix, org id, entity type, date
from/to, take, CSV export). **Filter-route verdict:** the AA6
filters already exist server-side — `GET /admin/audit` accepts
`action, userId, organizationId, entityType, dateFrom, dateTo,
take` (controller verified) — so nothing was duplicated; the one
gap was the **actor** filter, which the page never sent although
the API supports `userId`. **Declared addition:** an "Actor
(User ID)" input now sends the existing `userId` param (the CSV
export shares `buildQuery`, so it applies there too — same
existing export endpoint, no API change). Row detail opens in
the ADX4 `DetailDrawer` showing only fields the row already
carries (entity, actor, org, IP, pretty-printed metadata).
apiFetch target set-diff: **identical** (the addition is a query
param on the same endpoint, not a new target).

### /security — Tabs
Existing cards regrouped (sticky tab bar):

| Tab | Cards |
|---|---|
| 🔐 Allowlist ও TOTP | My TOTP card, Platform Admin বৃন্দ (carries the IP-allowlist status line) |
| 👁️ Sessions | View-As সেশন, Revoke-my-sessions card (badge = active view-as count) |
| 🔑 Admin Access | Admin API Keys, লগইন Anomaly (`ApiKeysAndAnomalies`, untouched) |

The revoke-my-sessions block moved out of the TOTP card into the
Sessions tab as its own card — same handler, same reasonPrompt
contract, same endpoint. apiFetch set-diff: **identical**.

### /admins — verdict: already satisfied, states adopted
The roster payload (`GET /admin/security/admins`) **already
carries** `tier` and `lastLoginAt`, and the page already renders
tier badges (SUPER red / other amber) and a সর্বশেষ Login column —
so no data work was needed or invented. This item only adopts
the v3 `ErrorState` / `EmptyState` for the page's error and empty
states. apiFetch set-diff: **identical**.

---

## ADX11 — Analytics, Usage, Growth, Social-Ops

### /analytics — period selector verdict
**Verdict: month-window, honestly labelled — no day selector.**
`GET /admin/analytics/series` accepts a `months` parameter and
returns **monthly buckets only**; there is no ৭/৩০/৯০-দিন data in
it. Per the brief's fallback, the selector (শেষ ৩ / ৬ / ১২ মাস) is
a client-side window over the already-loaded 12-month series,
applied to both the bar chart and the table (bar scale recomputed
over the window), and the card copy states plainly that the
endpoint has no day-level accounting and none was fabricated.
All other cards (snapshot KPIs, Top Tenants, Health Scores, AI
Cost + rates, Onboarding Board) are untouched. apiFetch set-diff:
**identical**.

### /usage — ranking table, money verdict
Both tables (per-org usage, AI-by-feature) gained v3
`SortableTh` headers on every numeric column — sorting is
client-side over the loaded rows (default = server order, stated
in the page copy), so the tables work as per-org ranking tables.
**Money verdict:** neither `/admin/usage` nor
`/admin/usage/ai-detail` carries any cost field, so this page
ranks **usage, not cost** — no money column was added and no cost
math was invented; the page's existing note (money lives on the
Analytics AI-cost board, from operator-set rates) is unchanged.
apiFetch set-diff: **identical**.

### /growth — Tabs
Existing sections regrouped behind a sticky tab bar:

| Tab | Sections |
|---|---|
| ✉️ Campaigns | Tenant Email Campaign, 🏷️ Referral Campaigns |
| 🎁 Referrals | Referral Program — Advanced (totals, config form, top referrers, abuse watch, recent) |
| 📰 Changelog | Changelog Manager |
| 💬 Feedback / NPS | Feedback / NPS (badge = real feedback count) |

**Announcements-tab deviation, documented:** the plan's tab list
named an "Announcements" tab, but this page has **no
announcements section** — announcements live in Settings (now
the ADX9 📣 section). Inventing one here would duplicate
Settings, so Referrals and Feedback hold their own tabs instead;
every existing section is present exactly once (heading-level
diff: none lost). **AN14b limit respected:** the email-campaign
card's own honest note (sent campaigns are history — no drafts,
no edit/delete) is preserved verbatim inside the Campaigns tab;
no campaign edit/delete was invented. apiFetch set-diff:
**identical**.

### /social-ops — two sections, failed first
The page's blocks already ran social-then-ads; ADX11 makes the
separation explicit with section header bands — **👥 Social
Accounts** (summary, error accounts, failed / stale / stuck post
cards) and **📢 Ad Accounts** (summary, attention-needed table) —
each band stating that failed items come first and that retry
lives on the row (AN13 actions, unchanged, reason-prompt and
all). No card moved or changed. apiFetch set-diff: **identical**.

---

## Gates — real output

| Gate | Result |
|---|---|
| Admin API Jest specs (`npx jest src/admin --runInBand`) | **19 suites, 212 tests — all pass** (unchanged from DB2; DB3 changed no API code) |
| Admin `tsc --noEmit` | **0 errors** (run after every item) |
| Admin `next build` | **Green — all 22 routes** (20 static + `/orgs/[id]`, `/users/[id]` dynamic; identical route set to DB2) |
| Zero-loss apiFetch set-diffs | **Identical on all 11 touched pages** (health, system, alerts, settings, tickets, audit, security, admins, analytics, usage, growth, social-ops — 12 files incl. settings counted once); declared additions: audit `userId` query param on the existing endpoint (ADX10), system Activity-Log tab + page-level banner move (ADX8), growth tab composition (ADX11) — all documented above |
| Content preservation spot-gates | `font-semibold` heading diff (system/health/settings/security/tickets): **none lost**; settings `pc-*` input ids, `patch()` areas, `test()` calls: **identical sets** |
| globals v2/v3 backward compatibility | `globals.css` **untouched in DB3**; class-selector comm diff vs pre-DB1 (`9322ddb`): **zero removed** |
| API changes in DB3 | **None** — no controller/service file touched; no endpoint added |

## Honest limits

- **No browser screenshot QA** — none performed for DB3.
  Screenshot / usability QA is ADX13 and remains deploy-gated.
  Everything here is proven by typecheck, production build, unit
  specs and mechanical set-diffs, not by looking at the pages in
  a browser. Tab panels and hidden-section toggles in particular
  have only build-level proof.
- **No live-API proof** — no page was run against the production
  API or database in this batch.
- **Hidden-mounted forms (ADX9)** keep unsaved input across
  section switches by design (all sections stay mounted), at the
  cost of the full settings DOM being present at once — the same
  DOM the page already rendered before, so no new weight class.
- Push and deploy remain owner-gated; DB3 is local commits only.
  Next in the package: DB4 (ADX12 states/responsive completion,
  ADX13 screenshot-QA checklist — execution deploy-gated,
  ADX14 personalization).
