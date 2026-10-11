# Milestone 72 — Acceptance (Team W3: Custom Access)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
Schema 106 models; migration `20261010720000_m72_custom_access`.

## What was built
- **Permission catalog** (`common/permission-catalog.ts`):
  13 areas — inbox, orders, customers, courier, campaigns,
  ads, ai, analytics, automations, integrations, billing,
  team, settings — each with a Bengali label, a note, and the
  baseline role that has it by role alone.
- **`Membership.permissionOverrides`** `{grants[], denies[]}`.
  RolesGuard enforcement on endpoints tagged
  `@PermissionArea(...)`:
  - **DENY** closes the area outright — even on endpoints
    with no `@Roles` (e.g. the inbox conversation list);
  - **GRANT** admits a below-role member — except
    **owner-only gates** (`@Roles("OWNER")` exactly, e.g.
    member removal), which are never grantable;
  - overrides **never apply to the OWNER** (the owner cannot
    be locked out of their own organization);
  - untagged endpoints keep pure role behavior, unchanged.
- **Rollout**: 22 controllers tagged (inbox, campaigns +
  messaging, ads family ×6, analytics family ×3, courier,
  ai + knowledge, customers + leads, automations,
  integrations + imports, orders, payments=billing) plus
  method-level tags on the organization routes (members =
  team, billing, business-profile/branding = settings).
  Tagged controllers now run RolesGuard at class level so
  the deny check reaches list endpoints too.
- **API**: `GET organizations/:id/access-catalog`;
  `GET/PATCH organizations/:id/members/:userId/access`
  (PATCH is OWNER/ADMIN; unknown areas → 400; editing the
  OWNER → 400; every change audited
  `org.member_access_updated` with the grants/denies diff;
  GET is manager-or-self and returns the computed effective
  access per area with its source: role / grant / deny /
  none / owner).
- **Web**: Team page gains a per-member **অ্যাক্সেস** editor
  (OWNER/ADMIN viewers, non-OWNER targets): per area a
  three-way control (Role অনুযায়ী / অনুমতি দিন / বন্ধ রাখুন)
  with the saved effective state shown as a chip, plus
  honest notes (owner-only actions never grantable; some
  endpoints still role-only).

## Verification
- API jest: **653 pass / 95 suites** (10 new M72: the full
  guard matrix incl. the no-@Roles deny case, catalog
  normalization/math, service diff/audit/owner-protection;
  plus a harness repair — the U2 spec's fake findUnique
  learned the `userId_organizationId` composite key that
  M71's roster check uses).
- Full monorepo build green.
- **Live proof** (T1 Shop): agent denied "inbox" → inbox
  list **403** while the owner stayed 200; agent granted
  "billing" → billing page data **200**; agent with a
  "team" grant still got **403** on the owner-only TOTP
  reset; patching the OWNER's access → **400**; clearing
  overrides restored normal access.

## Not built / limits
- Grants/denies apply only where endpoints are tagged;
  the editor says so. Admin (platform) surfaces are
  unaffected — this is tenant-side access only.
- ADMIN-level team actions (role change, suspend) ARE
  grantable via the "team" area by design; only exact
  OWNER gates are sealed.
