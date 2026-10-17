# OU1 Acceptance — Multi-org Switcher UI + Portfolio Surfacing (One-Umbrella OB1)

- **Package:** OU1 from `One-Umbrella-Master-Plan-2026-10-16.md` §5 (OB1 batch, with OU0 — release/live proof — running separately and NOT duplicated here).
- **Worktree:** `~/workspace/ai-marketing-saas-ou`, branch `one-umbrella`
- **Base:** `b5d9dfe3` (int8 HEAD: settings-knowledge merge on top of the interim union)
- **Final HEAD:** (see the docs commit itself — `git log -1` on branch `one-umbrella`)
- **Commits:** de940dc2 (union repair, cherry-picked), 29220f0d (API portfolio fixes), 2a7e5887 (item 2), 94e4e2f7 (item 1), fc125223 (item 3 web), bff0f60f (union repair), + this docs commit.
- **Push:** NONE — local commits only (owner-only push trigger).
- **Migrations:** NONE added.

## Step-0 findings (code-verified before building)

### Org context in the web app
- The org id lives in `localStorage["organizationId"]`, read via `apps/web/src/lib/org.ts` `getOrganizationId()`. Every dashboard page/component reads it at mount.
- `apps/web/src/app/dashboard/layout.tsx`: no token → `/login`; no stored org id → `GET /organizations`, stores `orgs[0].id` (**first-membership-wins**; listMine orders by membership `createdAt` asc), none → `/onboarding`. A stored id is trusted as-is.
- **Consequence for switching:** there is no live org context to patch; the honest switch is store-new-id + **full page reload**. OU1 implements exactly that (no fake partial switching).

### Memberships / org list endpoint
- `GET /organizations` → `OrganizationsService.listMine(userId)`: `membership.findMany({ where: { userId, status: "ACTIVE" }, include: { organization: true }, orderBy: { createdAt: "asc" } })`, mapped to `{ ...organization, creditMinor: string, myRole }`. ACTIVE only — suspended/invited memberships never appear. The Organization row includes `name`, `slug`, `currency` (default `"BDT"`).

### Create contract
- `POST /organizations` with `CreateOrganizationDto`: **required** `name` (string, 2–120) and `slug` (regex `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–60); **optional** `country` (2 chars, default BD), `timezone` (default Asia/Dhaka), `currency` (3 chars, default BDT).
- Service: slug governance first (taken → 409 Conflict `"This slug is already taken"`; reserved/invalid/cooldown → 400 with Bengali message). Transaction creates the Organization, an **OWNER + ACTIVE** membership, a BusinessProfile, and a FREE/TRIALING subscription.
- Live slug verdict: `GET /organizations/slug-available?slug=` (declared before `:organizationId`). The web onboarding flow (TD2) already uses it with `slugifyShopName` / `localSlugProblem` from `lib/shop-slug.ts` + `createOrganizationSchema` from `@repo/contracts` — OU1's form follows the same discipline.

### Invitations (context only — not in OU1 scope)
- `POST :organizationId/members/invite` (invitee must already have an account) and `POST :organizationId/members/email-invite` (pending MemberInvitation, SHA-256 token hash, 7-day expiry, accept page `/accept-invite`). Nothing in OU1 touches them.

### Portfolio — the three recorded suspicions, ALL VERIFIED TRUE at base
1. **Currencies mixed:** `PortfolioService.portfolioForUser` summed `totalSpend`/`totalRevenue` as BigInt across ALL orgs with no currency anywhere; org rows returned no `currency`; the web page called `formatMinor(x)` (defaults to `"BDT"`). Violates the product's own rule (`ads/spend-watch.ts`: "currencies are never mixed — there is no FX conversion anywhere in the product").
2. **Suspended memberships counted:** portfolio used `membership.findMany({ where: { userId } })` — no status filter, unlike listMine's `status: "ACTIVE"`. SUSPENDED and INVITED memberships leaked their orgs into the rollup.
3. **platformConversions hidden:** the API returned `platformConversions` per org AND in totals; `apps/web/src/app/dashboard/portfolio/page.tsx` rendered neither (cards: spend/revenue/orders/ROAS; table had no conversions column).

## Shipped — item-by-item audit vs scope

### Item 1 — Organization switcher in the dashboard shell ✅ SHIPPED
- `apps/web/src/app/dashboard/OrgSwitcher.tsx`, mounted in the dashboard topbar (`layout.tsx`), styled to the shell's existing language (white rounded-xl button, indigo/violet gradient avatar, Bengali labels).
- Lists ACTIVE memberships from `GET /organizations` with org name + the user's role (Bengali role labels via `lib/org-switcher.ts` `roleLabel`; unknown roles pass through verbatim). Current org is highlighted with a check; menu scrolls for long lists.
- Switching: `isSwitchNeeded` no-ops on re-selecting the current org; otherwise stores `organizationId` and **full-reloads** (architecture note in the file header + plan: every page reads the stored id at mount).
- The resolved-current rule mirrors the layout: stored id wins if still an ACTIVE membership, else first membership — a stale stored id (e.g. after suspension) can never be reselected, because suspended orgs are absent from listMine.
- Single-org users: button shows their one org + role; menu shows a short note ("আপনি এখন একটি Organization-এর সদস্য…") instead of fake multi-org chrome. Zero memberships → renders nothing (layout already routes to onboarding); still-loading → renders nothing rather than a wrong name.
- Pure rules in `apps/web/src/lib/org-switcher.ts` (`resolveCurrentOrgId`, `isSwitchNeeded`, `roleLabel`, `switcherMode`) with 6 vitest cases in `lib/org-switcher.test.ts`.

### Item 2 — "নতুন Organization তৈরি" inside the switcher ✅ SHIPPED
- `apps/web/src/app/dashboard/OrgCreateForm.tsx` (its own commit, imported by the switcher).
- Fields: exactly what the DTO requires — ব্যবসার নাম + দোকানের ঠিকানা (slug). Country/timezone/currency are NOT sent (server defaults apply). Validation via `@repo/contracts` `createOrganizationSchema`; slug auto-derives from the name until hand-edited (`slugifyShopName`).
- Slug feedback: local format/reserved instantly (`localSlugProblem`), then the authoritative `slug-available` API (taken/reserved/cooldown messages shown verbatim); an unreachable check degrades to "unknown" and does NOT block — the server re-verifies on POST.
- Submit: POST success → creator is OWNER via the existing service path → the switcher switches straight into the new org (same store + full reload). Failures show the real API message (e.g. the 409 slug-taken text) in an inline error box; the form stays open.

### Item 3 — Portfolio surfacing + honesty fixes ✅ SHIPPED
- **Switcher entry:** "সব Organization-এর সারসংক্ষেপ" in the switcher menu → existing `/dashboard/portfolio` page (no engine rebuild).
- **API (`portfolio.service.ts`):** memberships filtered to `status: "ACTIVE"` (consistent with listMine); each org row now carries `currency` (`org.currency ?? "BDT"`); money totals are grouped into **`totalsByCurrency`** — `[{ currency, monthSpendMinor, monthRevenueMinor, roas }]` sorted by spend desc — mirroring the CN8 campaign-portfolio convention. The old mixed `totals.monthSpendMinor/monthRevenueMinor/roas` are REMOVED (only consumers were this service's digest + the web page; both updated). Currency-neutral counts remain in `totals: { monthOrders, platformConversions }`. The weekly digest now states totals per currency and includes each org's conversions.
- **Web (`dashboard/portfolio/page.tsx`):** totals cards render per currency group with `formatMinor(x, currency)`; the counts cards (orders, platform conversions) stay currency-neutral; per-org amounts format in the org's own currency; a **কনভার্সন column** surfaces `platformConversions` per org; header copy states the per-currency + ACTIVE-only rules honestly.
- **Specs:** existing phase-l portfolio test updated to the grouped shape (statuses + expectations); NEW test proves SUSPENDED and INVITED memberships are excluded and USD/BDT totals are never summed together.

## Base repairs (NOT OU1 scope — recorded, proven pre-existing)
The assigned base `b5d9dfe3` itself does not type-check: the int8 union merges lost three code pieces. Each was proven pre-existing in the committed base (`git show b5d9dfe3:<file>`) and repaired with the faithful source version:
1. `apps/api/src/common/platform-config.ts` — `effectiveGoogleOAuthConfig()` tail (`}` + `return null;`) lost in the SN merge stitch. The int8 coordinator had already fixed this as the direct child commit `12d7c553` on `integration-8`; **cherry-picked verbatim** (de940dc2), not re-invented.
2. `apps/web/.../commerce/storefront/page.tsx` — `domainNotice` declaration lost (setters/render survived; declaration exists in the TD line). Restored next to `domainError` (bff0f60f).
3. `apps/web/.../customers/page.tsx` — orphan `{notice}` render survived a design-line merge that had removed the notice mechanism for toasts (no `setNotice` call exists in the merged file). Orphan render removed, matching the design line's final state (bff0f60f).
These repairs are also needed by the interim release on int8 (which already has #1; #2/#3 were still open at b5d9dfe3).

## Gates (run one at a time; counts as they completed)
- **API jest, touching suite only** (`src/campaigns/phase-l.spec.ts`, contains the PortfolioService specs): **1 suite passed, 7 tests passed.** (First run failed to compile on the pre-existing platform-config break — see repair #1; after the cherry-pick it passes.)
- **API tsc** `--noEmit -p tsconfig.json`: **exit 0, 0 errors** (foreground rerun).
- **Web vitest (full):** **110 test files passed, 899 tests passed** — including the 6 new `org-switcher.test.ts` cases.
- **Web tsc** `--noEmit`: **passed, 0 errors** (first run surfaced only the two pre-existing base defects in files OU1 does not touch — repairs #2/#3; rerun clean; also independently passed inside the Next build's type-check step).
- **Web next build:** **passed** — "✓ Compiled successfully in 82s", type validity checked, full route table emitted including `○ /dashboard/portfolio 4.29 kB`.
- Sandbox note: fresh-worktree setup required `pnpm install`, `prisma generate`, and building `@repo/contracts` + `@repo/db` dists before any gate could run; the machine was under heavy parallel load from other coordinators throughout (several tool calls aborted and were retried; no gate conclusion was ever drawn from an aborted/OOM-killed run).

## NOT BUILT (explicit)
- **AGP package items** — CSV export of the portfolio, scheduled/email digest scheduling UI (the pre-existing manual digest button + endpoint are unchanged), team matrix, cross-org member views: the AGP package is NOT approved; none of it was built.
- No portfolio engine changes beyond the honesty fixes (metrics definitions, flag gating, ordering logic untouched).
- No API changes to organizations/memberships/invitations; no migration (none needed — `Membership.status` and `Organization.currency` already exist).
- No fix for the stored-org-id trust in `layout.tsx` (a stored id whose membership was later suspended is still trusted until the user switches via the new switcher — the switcher's list itself can never reselect it; hardening the layout fallback is a follow-up, not OU1 scope).
- No admin-app switcher (OU1 is the merchant dashboard).
- Switcher placement is the topbar (not the sidebar) — matches the shell's utility cluster (install/theme/notifications) and keeps the dark sidebar unchanged.

## Post-deploy screenshot-QA checklist (runs ONLY after deploy)
- [ ] Two-org account: topbar shows current org name + role; menu lists both orgs with roles; current org checked.
- [ ] Switch org → full reload → every page (orders, inbox, campaigns) shows the OTHER org's data; browser back/refresh keeps the new org.
- [ ] Single-org account: switcher shows the one org, the explanatory note, no clutter.
- [ ] Create flow: name auto-derives slug; taken slug shows the server's message; reserved slug blocked locally; success lands INSIDE the new org as Owner; subscription shows FREE/TRIALING on the billing page.
- [ ] Switcher → "সব Organization-এর সারসংক্ষেপ" opens the portfolio page.
- [ ] Portfolio with a USD org + a BDT org: totals cards appear per currency (no combined money figure anywhere); per-org rows show their own currency codes.
- [ ] Portfolio with a suspended membership: that org is ABSENT from the portfolio (and from the switcher).
- [ ] Conversions visible: totals card + per-org কনভার্সন column match the API response.
- [ ] Weekly digest email: per-currency total lines, per-org currency codes present.
- [ ] Mobile width: switcher button truncates cleanly; menu does not overflow the viewport.
