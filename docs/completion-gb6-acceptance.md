# Completion Program — GB6 Acceptance (GC15 CRM + GC16 Staff)

Batch GB6 of the E-Commerce Completion Program (plan: `Ecommerce-Completion-Plan-2026-10-15.md`),
built on the `completion` branch in `~/workspace/ai-marketing-saas-gc` on top of GB5 HEAD `c86b73f`.
**Local commits only — NOT pushed, NOT deployed.** One migration:
`20261013960000_gb6_crm_staff` — **NOT run on any real DB** (deploy note at the end).

Commits (13 + this docs commit):
`1eac6f8` schema+migration · `7361de6` GC15 CRM depth API · `69424a8` GC15 block enforcement ·
`c7b35eb` GC15 specs (27) · `1e66c80` GC16 preset profiles + guard branch · `94d0079` GC16 custom
roles/sessions/preferences API · `49ded66` GC16 login events + sessions (auth) · `94e6491` GC16
notification categories + wrap of every creation site · `3baa0a7` GC16 specs (35) · `56c6851`
web lib helpers + tests · `649a635` customers CRM UI · `252bf7d` team UI · `dfa367a` settings
my-security UI.

---

## GC15 — CRM completion

### 15.1 Customer record depth — DELIVERED
`Customer` gains `tags` (Json string array), `notes` (Text), `isVip` (default false), `isBlocked`
(default false), `blockedReason` (nullable). All edited through the existing staff
`PATCH organizations/:orgId/customers/:customerId` (OWNER/ADMIN/SUPPORT_AGENT). Discipline:
tags use wholesale replace semantics with the Order-tag limits (≤10 tags × ≤30 chars, trimmed,
deduped); per-field audits (`customer.tags_updated` carries count only, `customer.notes_updated`
carries length only, `customer.vip_updated`, `customer.blocked`/`customer.unblocked` carry the
reason — notes CONTENT never enters an audit body). **Staff-only proof:** a spec drives the real
`ShopAccountService.me()` and asserts the serialized customer JSON contains neither the notes
text nor the blockedReason, and no `notes`/`blockedReason`/`tags` keys at all (EC25 leak guard).
Dashboard detail: tags chip editor (client validation mirrors the server limits, Bengali errors),
VIP toggle, notes editor labelled "শুধুমাত্র কর্মীদের জন্য — গ্রাহক এটি দেখতে পান না", block/unblock
with reason (≤300 chars) and a prominent blocked banner; saves re-seed from the PATCH response.

### 15.2 Block enforcement — DELIVERED
Inside GB3's `CheckoutGuardService.evaluateGate`, in the step-2 blocked family (after the
BlockedIdentifier check, inside the `!trusted` branch so trusted identifiers still bypass): any
Customer row matched by the ON11 normalized-phone key with `isBlocked` refuses checkout with
kind `customer_block` in `FraudAttemptLog`, the SAME generic Bengali refusal message as every
other blocked verdict, fail-open on lookup error (a CRM outage can never take checkout down).
Because it lives in the gate, it also covers the OTP path — consistent with blocked identifiers,
documented here deliberately. Manual staff order creation is NOT refused: the ON11 warning list
gains `customer_blocked` and creation proceeds.

### 15.3 Money/truth columns — DELIVERED
The customers list keeps its existing labelled semantics (`orderCount`/`totalSpentMinor` =
orders excluding cancelled, UI label "বাতিল ছাড়া") but the computation changed from a silent
200-orders-per-customer cap to ONE `order.groupBy` over the page's customers. New fields use the
canonical EC33 sold bucket (`isSoldOrder` from `storefront/ec27-discovery.ts`: not
cancelled/refunded/failed AND (status completed|delivered OR any shipment
delivered/partial_delivered)): `soldOrderCount`, `lifetimeValueMinor` (BigInt → string),
`aovMinor` (null at 0 sold orders), `isRepeat` (sold ≥ 2). Filters: `customerType`
(all|first|repeat|vip|blocked), `tag`, `segmentId`, and the pre-existing `hasDue` still works.
Detail continues to reuse the ON7 খাতা + ON2 Customer 360 — not recomputed.

### 15.4 Segments — DELIVERED
`CrmSegment` (organizationId, name, criteria Json). Criteria vocabulary (strict — unknown keys
are a 400 that names the allowed keys): `tagsAny` (string[], ≤10 × ≤30), `isVip` (bool),
`isRepeat` (bool), `minSpentMinor` (string of digits, compared against the EC33 sold-bucket
lifetime value), `district` (trimmed, case-insensitive exact match on `Customer.district`).
All present criteria must match. Member counts are COMPUTED, never materialized: one evaluator
(`evaluateSegmentMembers`) feeds both `memberCount` and the list endpoint's `segmentId` filter,
and a spec pins count == filtered list total (the OB1 queue discipline). Write routes are
OWNER/ADMIN; audits carry criteria KEYS only, never values. Dashboard: segments panel with live
counts, create/edit form, delete with confirm, "তালিকায় দেখুন" applies the segment filter.
**Messaging relationship (checked, honest):** the Messaging/Audiences code has no
Customer-record criteria concept (its audiences are messaging contacts, a different population);
there was no compatible field vocabulary to mirror, so the segment vocabulary above is defined
fresh per the plan. The resolver was NOT forked and segments do NOT auto-create audiences.

---

## GC16 — Staff completion

### 16.1 THE RBAC AUDIT (as found in code, before this batch)
Authorization today is a TWO-layer system, and both layers are real:

1. **TenantGuard + RolesGuard with `@PermissionArea(area)`** — 57 controller files carry a
   class-level area tag. `effectiveAccess(role, overrides)` in `common/permission-catalog.ts`
   decides: OWNER → all areas; otherwise an area is allowed iff the member's preset role rank
   (linear `ROLE_RANK`: OWNER 100, ADMIN 80, MARKETING_MANAGER 60, ADVERTISER 50,
   SUPPORT_AGENT 40, ANALYST 30, VIEWER 10) is ≥ the area's `minRole`, then per-member
   **grants add / denies remove** (M69 member access overrides — denies always win).
   The REAL area catalog (14 areas, with minRole): inbox (SUPPORT_AGENT), orders
   (SUPPORT_AGENT), customers (SUPPORT_AGENT), courier (SUPPORT_AGENT), campaigns
   (MARKETING_MANAGER), social (MARKETING_MANAGER), ads (ADVERTISER), ai (MARKETING_MANAGER),
   analytics (ANALYST), automations (MARKETING_MANAGER), integrations (ADMIN), billing (ADMIN),
   team (ADMIN), settings (ADMIN).
2. **`@Roles(...)` role-list checks** — 584 decorator usages across controllers. These compare
   the membership's preset `role` against an explicit list and IGNORE areas entirely. Several
   controller families have NO area tag at all and are governed purely by role lists
   (e.g. products/inventory write endpoints).

Consequence, stated plainly: **areas govern area-tagged surfaces; the preset role governs
role-list surfaces.** Any custom-role design that pretended areas replace roles would be
theatre. The design below is built on exactly this split, and the team UI says so.

### 16.2 Custom roles + preset profiles — DELIVERED (with the honest split)
**Design verdict — preset roles are PROFILES, not enum values.** ORDER_MANAGER,
INVENTORY_MANAGER and FINANCE could not be added to the `Role` enum honestly: the linear rank
hierarchy cannot express FINANCE (billing's minRole is ADMIN ⇒ rank ≥ 80 would inherit every
ADMIN area) nor INVENTORY_MANAGER (products/inventory are role-list endpoints with no area
tag). Instead `permission-catalog.ts` gains `PRESET_ROLE_PROFILES`, materialized per org as
`CustomRole` rows with `presetKey` set:
- ORDER_MANAGER → [inbox, orders, customers, courier, analytics]
- INVENTORY_MANAGER → [orders, analytics] (warehouse/purchasing/fulfillment surfaces ride the
  "orders" area tag; product/inventory WRITES remain governed by the member's base preset role)
- FINANCE → [billing, analytics, orders, customers]

`CustomRole` (organizationId, name, areas Json ⊆ the 14 real area keys, presetKey nullable;
@@unique org+name). `Membership.customRoleId` (nullable FK, SetNull on role delete).
Authorization: TenantGuard attaches the role's areas to `req.membership.customRoleAreas`
(defensive separate fetch — a failure attaches nothing and never blocks). RolesGuard gains ONE
branch, after the deny check: when a custom role is set, its areas are the baseline for
`@PermissionArea` endpoints (denies still win, per-member grants still add); **owner-only gates
(`@Roles` exactly ["OWNER"]) can never be passed via areas** — they fall through to the normal
role logic. `effectiveAccess(role, overrides, customAreas?)` mirrors the same semantics for the
access-catalog UI. With no custom role assigned, behaviour is byte-identical to before (pinned
by spec). **Endpoint-family honesty:** custom-role areas govern ONLY area-tagged endpoints;
role-list-only endpoints keep seeing the member's base preset role — the member editor shows
BOTH controls with a Bengali note explaining exactly this. CRUD: GET returns roles +
presetProfiles; create from a presetKey expands the profile (explicit name/areas WITH a
presetKey → 400); unknown areas named in the 400; delete refused (400, with member count)
while assigned; assignment endpoint refuses OWNER targets and foreign-org roles (404); all
mutations audited. Specs (17 in `gb6-rbac.spec.ts`): orders-area-only role passes an orders
endpoint and is refused by a settings endpoint; unassigning restores preset behaviour;
deny-wins, grant-adds, OWNER immunity, owner-gate protection.

### 16.3 Login history — DELIVERED
`LoginEvent` (userId nullable, email as attempted, success, ip, userAgent truncated to 200
chars, createdAt). Written failure-isolated by the auth flow: wrong password, unknown email
(userId null), deleted account, login success, TOTP-verify success, wrong TOTP code.
TOTP-pending records nothing (not a completed login). No password or token is ever written
(spec asserts the stored row). Visibility: own history (`GET auth/login-history`), org
OWNER/ADMIN for their members (`GET organizations/:orgId/members/:userId/login-history`,
last 50) — with a code comment + UI label stating the honest scope: login events are
USER-GLOBAL (the user may belong to several orgs); authority comes from membership in THIS
org. Dashboard: member "লগইন ও সেশন" panel + own history in settings.

### 16.4 Session management — DELIVERED
Token reality as found: stateless JWT access tokens, no refresh/session store; the auth guard
verified the JWT only. Built: `UserSession` (id, userId, createdAt, lastSeenAt, ip,
userAgent, revokedAt). `AuthService.issueToken` creates a session row failure-isolated and
carries its id as the `sid` claim; any failure signs a sid-less token rather than blocking
login. JwtAuthGuard: for sid tokens, a missing or revoked session row → 401 ("Session has
been revoked"); lookup ERRORS fail open (a session-table outage must not log the world out);
lastSeenAt is touched at most every 60s, fire-and-forget (the API-key lastUsedAt pattern).
**Legacy sid-less tokens stay valid until natural expiry** (documented migration path, not a
bug). Admin impersonation tokens (signed directly in admin.service, no sid) are unaffected.
Revoke = set `revokedAt`; a spec proves a revoked session's next request is 401 while the same
user's other session still works. UI: own sessions in settings (current session badged; its
revoke button disabled with an explanation, since the server DOES allow revoking it and that
would log the user out instantly — a deliberate UI guardrail, not a server limit); OWNER/ADMIN
can list + revoke a member's sessions from the team page (revoke-all returns `revokedCount`).

### 16.5 Staff notification preferences — DELIVERED
`NotificationPreference` (@@unique userId+organizationId, mutedCategories Json). Categories
derived from the ACTUAL `AgentNotification` types in code (`common/agent-notify.ts`):
orders ← [urgent], inbox ← [assigned, mention], inventory ← [low_stock, out_of_stock],
billing ← [billing], marketing ← [ad_account_sync_failed, social_post_failed],
automation ← [workflow, workflow_failed, job_dead_letter], leads ← [lead_followup, referral],
general ← catch-all for any other type. One helper, `createAgentNotification(prisma, data)`,
consults the recipient's preference before creating (muted ⇒ no row, returns null); the
preference lookup is fully failure-isolated (an error still creates the notification).
**All 23 production creation sites were wrapped** (AST/grep-verified), including two real
sites found during the sweep that were not on the initial list (campaigns.service,
storefront.service). Endpoints `GET/PATCH organizations/:orgId/my-notification-preferences`
(any active member; unknown category keys → 400; audited with count only). UI copy states
plainly: this mutes IN-APP notifications only and is a preference, not a security control.

### 16.6 Warehouse access — SKIPPED (plan-sanctioned)
The dispatch board endpoint (`GET fulfillments/board`) accepts no filter parameters, and
neither the API nor the web has any bin/warehouse filter — `BinLocation` exists but the board
only renders binCode as a walk order. There is no filter to hang a per-member default on, and
warehouse-wise stock balances are an owner-decision item kept out of this program. Building a
"warehouse permission" here would be theatre. Recorded as the honest skip the plan allows.

---

## Gates (final gate run by the coordinator personally, exit-code checked)

| Gate | Result |
|---|---|
| API jest (chunked `--runInBand`, 5 chunks, all exit 0) | **3779/3779 tests passed, 0 failed** (chunks 179 + 1133 + 1498 + 521 + 448; chunk boundaries covered every `src/` directory) |
| API `tsc --noEmit` | exit 0 |
| Web vitest | **390/390 passed** (52 files; 367 baseline + 23 new GB6 lib tests) |
| Web `tsc --noEmit` | exit 0 |
| Full build `pnpm -r build` (7 workspaces incl. Next build) | exit 0 |
| `prisma validate` | exit 0 |
| Fresh-DB full migration sequence (throwaway PG16) | **170/170 applied clean**, 240 public tables, all 5 GB6 tables present |

Baseline reconciliation: GB5 closed at 3716 API tests per its acceptance; the GB6 coordinator
brief said 3717. 3717 + 62 new GB6 API tests (GC15 27 + GC16 35) = 3779 exactly — the GB5
doc's 3716 appears to be an off-by-one in that document; no test was lost (every suite in
every chunk passed). Known sandbox pattern, reported honestly: a single-process full-suite API
run OOMs on the default heap in this sandbox, so the final gate used the accepted chunked
`--runInBand` pattern; one GC16-era giant parallel run SIGKILLed the `automation/m63-webhooks`
worker, which passes 8/8 standalone and passed inside the coordinator's sequential chunks.

## Deploy notes
- Migration `20261013960000_gb6_crm_staff` has **NOT run on any real DB**. It is additive
  (new columns with defaults, 5 new tables, one nullable FK) and applies cleanly in the full
  170-migration fresh sequence.
- No per-org job enablement is required by GB6. Existing tokens keep working (see 16.4);
  sessions accumulate only from logins after deploy.

## Honest limits
- **Nothing is live-proven.** No GB6 surface has run against the real DB or a real browser
  session; all proof is unit/integration-spec + fresh-DB migration proof. M30-style live
  verification is still owed.
- Suspended-account login (correct password, account SUSPENDED) records no LoginEvent — that
  path throws after credential success and was outside the enumerated failure set; flagged,
  not silently guessed.
- Two legacy counters (leads `notifications++`, workflows `sent++`) count a muted recipient
  as "sent" because only the create call was wrapped at those sites; row-returning sites count
  only real creations. The notification ROW behaviour (the thing the preference promises) is
  correct everywhere.
- Custom roles narrow AREA-checked surfaces only; role-list-only endpoint families (notably
  product/inventory writes) still follow the member's base preset role. The UI states this;
  no surface claims otherwise.
- The web segment form cannot express an explicit `isVip:false` / `isRepeat:false` criterion
  (checkbox = present-or-absent); re-saving such a segment from the form drops that criterion.
  The API accepts and honours explicit false. Noted in the lib code.
- Notification category catalog is mirrored (hardcoded) in the web lib because the API does
  not expose it as an endpoint; the preferences GET response does include the server's
  category list, so drift would be visible, but the two lists must be kept in step manually.
- Session lastSeenAt is best-effort (60s-throttled, fire-and-forget); it is a display value,
  not an audit timestamp.
