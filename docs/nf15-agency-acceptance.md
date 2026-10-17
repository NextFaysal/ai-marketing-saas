# NF15 Acceptance — Agency / Reseller Console (membership-only multi-org view + records-only commissions)

**Item:** New Features Frontier FB5 · NF15
**Worktree/branch:** `~/workspace/ai-marketing-saas-nf`, `new-frontier` · **Base:** `753526af` (NF14 complete, tree clean, verified before building)
**Local commits only — nothing pushed.** Migration claim used: `20261042000000_nf15_agency_console` (the only NF15 claim).

## Design — the dependency rule, honoured exactly

**ORG14 (cross-org team view) was NEVER built — owner decision D2 in the ORG package is still open and remains the owner's.** NF15 is built ONLY on what exists:

- There is **no "agency" entity** — no model, no role, no setting. An "agency" in v1 is simply a user with memberships in multiple orgs, one of which is their own agency org.
- The console basis is the signed-in user's own ACTIVE memberships, exactly as `OrganizationsService.listMine(userId)` returns them. There is **no cross-org admin/team view, no way to name another org or another user, and no query that bypasses per-org membership**. A non-member org never appears — spec 1 proves its id, name, slug and numbers are nowhere in the payload (string inspection) and that Analytics is never even queried for it.
- Every per-org number is computed **through that org's normal tenant-scoped paths, as that member** (see reuse evidence below).

## Per-org path reuse evidence

| Number | Path reused | Evidence |
|---|---|---|
| Orders + revenue, today & month-to-date | `AnalyticsService.overview(organizationId, from, to)` — the SERVICE behind `GET /organizations/:id/analytics/overview`, which the dashboard home calls | `AgencyConsoleService.orgSummary` calls `overview` twice per org; revenue = `totals.revenueMinor`, orders = `totals.orders`. Ranges use the dashboard home's own semantics (`toISOString().slice(0,10)`): today = `from == to == today`; month = `from = <YYYY-MM-01>`, `to = today` (overview extends `to` by one day). Pinned by spec 2's call assertions + the `agencyDateRanges` unit test. |
| Pending orders | Tenant-scoped count `order.count({ where: { organizationId, status: "pending" } })` | Status vocabulary verified in code before building: `"pending"` is a key of `ORDER_TRANSITIONS` in `orders.service.ts` and a documented raw order status — it is the real initial/pending status name, so it is used as-is (no substitute needed). The count is org-filtered; no cross-org read exists. |
| Unread inbox | Σ `ChannelConversation.unreadCount` over `channelConversation.findMany({ where: { organizationId } })` | `unreadCount` field verified on the model (schema line: `unreadCount Int @default(0)`). Summed per org, never across orgs except in the labelled totals of the caller's own listed cards. |
| Client-org creation | `OrganizationsService.create(userId, dto, ip)` — delegated EXACTLY | TD1 slug governance and the ORG12 per-user owned-org cap inside `create()` apply unchanged; the caller lands OWNER (existing rule). Spec 3a proves delegation + unchanged refusal propagation with a stub; spec 3b exercises the REAL `create()` cap path through the agency door with the fake prisma (the org-ob4 approach) and proves OWNER landing under the cap. |
| Invite link for a new client org's team | Existing `POST /organizations/:id/invite-links` (ORG9) | Called unchanged from the web page after creation; the raw link is shown once (existing ORG9 behaviour — the server stores only its hash). A link files a join REQUEST (ORG10); it never creates a membership by itself. |
| Membership basis | `OrganizationsService.listMine` | `OrganizationsModule` now exports `OrganizationsService` (one-line module change) so `AgencyModule` injects the real service; `AnalyticsModule` already exported `AnalyticsService`. No service was forked or reimplemented. |

## What NF15 built

| # | Commit | Contents |
|---|---|---|
| 1 | `9001b94d` | Schema + migration: `AgencyCommissionEntry` (agency/client org ids, `periodLabel`, `amountMinor BigInt`, nullable `note`, `recordedById`, timestamps; named relations `AgencyCommissionAgency` / `AgencyCommissionClient` added on both sides incl. the two `Organization` back-relations; `@@index([agencyOrganizationId, createdAt])`, `@@index([clientOrganizationId])`) + hand-written `20261042000000_nf15_agency_console/migration.sql` matching the schema exactly. `prisma validate` PASS (local 5.22 CLI, dummy `DATABASE_URL`). |
| 2 | `e719427a` | API: new `AgencyModule` (`apps/api/src/agency/`) — `AgencyConsoleService`, user-level `AgencyController` (`GET /agency/console`, `POST /agency/client-orgs`; authenticated only, NO org param), org-scoped `AgencyCommissionsController` (`GET/POST /organizations/:organizationId/agency-commissions`, TenantGuard + RolesGuard, `@Roles("OWNER","ADMIN")`); registered in `app.module.ts`; `OrganizationsModule` exports `OrganizationsService`. |
| 3 | `af86f633` | Specs: `apps/api/src/agency/nf15-agency.spec.ts` (10 tests, fake-prisma, REAL `OrganizationsService`). |
| 4 | `280d610f` | Web: `/dashboard/agency` page + nav entry (`NAV_ITEMS` + the layout's core group), `lib/agency-nf15.ts` pure helpers + vitest (7 tests incl. the nav pin). |

### Console contract

`GET /agency/console` returns `{ orgs: [{ organization (the listMine view, tags stripped by listMine itself), myRole, summary|null, error|null }], totals: { orgCount, ordersToday, revenueTodayMinor (string), ordersMonth, revenueMonthMinor (string), pendingOrders, unreadInbox, summariesFailed } }`.

- **Per-org failure isolation:** if one org's summary throws, that card returns `summary: null` + the honest label `"তথ্য লোড হয়নি"`; the rest still return. Totals sum ONLY the intact listed cards; failed cards contribute 0 and are counted in `summariesFailed` (spec 6).
- **Totals are labelled sums, not consolidated analytics** — the web banner reads verbatim: "শুধু তালিকাভুক্ত প্রতিষ্ঠানগুলোর মোট (Xটি)".

### Commissions — records only

- `POST /organizations/:organizationId/agency-commissions` validations (all spec-proven): amount parses to BigInt and must be > 0; `clientOrganizationId != organizationId`; the caller must be an ACTIVE member of the client org (proven through the caller's own `listMine` — never by trusting the id); `periodLabel` non-empty after trim, ≤ 40 chars.
- `GET` lists entries for the agency org in the path ONLY, newest first. The client org's name is resolved ONLY from orgs the caller is a member of — an entry whose client org the caller no longer belongs to shows the id with `clientOrganizationName: null` (spec 4b); nothing beyond what the entry itself holds is exposed.
- Every entry payload carries the literal `recordsOnly: true`. Recording an entry **moves no money**: spec 5 instruments the fake prisma's `walletAccount` / `walletTransaction` delegates and asserts ZERO calls across the console + commission flows. The web section sits under the verbatim banner: "কমিশন এখানে শুধু রেকর্ড হিসেবে রাখা হয় — কোনো টাকা স্বয়ংক্রিয়ভাবে কাটা বা পাঠানো হয় না। পেআউট OU11 আইনি গেটের অধীনে বন্ধ আছে।" (byte-identical in `agency.service.ts` and `lib/agency-nf15.ts`, pinned by the web vitest).

### Web page

`/dashboard/agency` (nav: "এজেন্সি কনসোল", core group beside the existing portfolio page): totals banner (labelled, with a failed-cards note when `summariesFailed > 0`); per-org cards (name, slug, নিজের ভূমিকা, আজকের অর্ডার + আয়, এই মাসের অর্ডার + আয়, পেন্ডিং অর্ডার, অপঠিত মেসেজ; `summary: null` → "তথ্য লোড হয়নি" honest state); create-client-org form (নাম + স্লাগ) → on success the created org plus the "ক্লায়েন্টের টিমের জন্য আমন্ত্রণ লিংক তৈরি করুন" button (role select; raw link shown once); commission section (agency-org select = caller's OWNER/ADMIN orgs, client-org select = caller's other membership orgs, period, amount in ৳ converted to minor units client-side and re-validated server-side, note) with the entry list for the selected agency org.

## Spec / gate results (worker-run)

| Gate | Result |
|---|---|
| API spec `nf15-agency.spec.ts` | **10/10 PASS** — (1) non-member org never appears (id/name/slug/numbers absent from the payload string; analytics never queried for it); (2) per-org numbers equal the stubbed direct-path values exactly, role = caller's role per org, overview called with dashboard from/to semantics; (3a) creation delegation — same userId+dto+ip, refusal propagated unchanged (identical exception instance); (3b) REAL `create()` ORG12 cap refuses through the agency door (`সর্বোচ্চ 1টি…`), and under a raised cap creation succeeds landing the caller OWNER/ACTIVE; (4) commission create+list happy path (BigInt stored, string serialised, newest first, `recordsOnly: true`, client name resolved); (4b) name → null after leaving the client org; (4c) all validation refusals (non-member client, agency == client, amount 0 / negative / unparsable, empty / 41-char period) with zero rows written; (5) wallet delegates — ZERO calls across console + commission flows; (6) totals = listed cards only, one failing org → null card + `summariesFailed: 1`, others intact; plus the `agencyDateRanges` unit test. |
| API regression (touched areas) | `src/organizations` + `src/analytics` — **18 suites / 180 tests PASS** (incl. org-ob1–ob4, td1 slug, cohorts, metrics). |
| API tsc `--noEmit` | **PASS** (exit 0) |
| Web tsc `--noEmit` | **PASS** (exit 0) |
| Web vitest (targeted) | **2 files / 13 tests PASS**: `agency-nf15.test.ts` **7** (records-only banner verbatim + OU11 named; totals label with count; `sumSummaries` null-card semantics; role labels; `bdtToMinor`; commission choice filters; nav pin — `/dashboard/agency` exists exactly once, ready, no duplicate hrefs) + `nav-commerce.test.ts` **6** (unchanged pins still green). |
| Full web vitest / web build / fresh-PG / boot-smoke | **Not run by this worker** — the coordinator's serial gates, per the brief. |

## NOT BUILT

- **No cross-org team/admin view (ORG14)** — owner decision D2 is still open; nothing here lets a user see an org they are not a member of, a cross-org member list, or another user's console.
- **No agency entity, agency roles, or agency settings** — "agency" is only a user's set of memberships; there is nothing to configure.
- **No automatic commission calculation from revenue** — amounts are typed in by the agency (৳) and recorded; nothing derives a percentage or amount from a client org's sales.
- **No consolidated analytics beyond the labelled sums** — totals are plain sums of the listed cards' own per-org numbers, labelled as such; no cross-org reports, charts, exports, or digests.
- **No billing, payout, or wallet movement** — no wallet table is read or written anywhere in NF15 (spec-proven); payouts remain behind the OU11 legal gate.
- **No client-org management** — creation delegates to the existing org creation; membership/invite administration stays in the existing Team surface (the page only mints an ORG9 invite link for a freshly created org).
- **No per-org drill-through changes** — cards do not link into or alter any org's own pages; switching orgs stays with the existing OrgSwitcher.

## Live proof owed

Nothing in NF15 is live-proven: the migration `20261042000000_nf15_agency_console` has not run on a real database, no real agency user with real client orgs has opened the console, no real commission has been recorded, and no real client org has been created + invited end-to-end. Push (on the owner's explicit instruction only, union release with ls-remote/fetch first) + manual Dokploy Redeploy + M30-style verification on real accounts are all still owed.
