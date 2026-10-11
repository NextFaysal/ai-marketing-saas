# Milestone 59 Acceptance — Agency White-Label v1

## Audit first — what already existed (built on, not rebuilt)
- **Organization branding fields:** none. `Organization` had only
  name/slug/country/timezone/currency; `BusinessProfile` carries
  brand *voice* (AI copy tone), not visual identity.
- **Agency portfolio:** M24 AGENCY-tier rollup exists
  (`/dashboard/portfolio`) — untouched, composes with this milestone.
- **Media/logo upload infrastructure:** U6 `MediaStore`
  (S3-compatible or local disk, SigV4 by hand) existed but was only
  used for captured inbox media; creatives "upload" is URL-based.
  The logo uses the MediaStore — bytes at key
  `branding/<orgId>/logo`, the org row keeps only path + type.
- **Shareable reports:** M20 `ReportShare` already provided the
  token mechanism — 24-byte `randomBytes` base64url token,
  `expiresAt`, revoke-by-delete, public endpoint + `/r/[token]`
  page, and an internal-fields exclusion rule (no COGS/profit).
  M59 extends its payload; the mechanism is unchanged.
- **Tenant identity rendering:** shell showed a fixed platform
  brand; M53 PDFs printed `Organization.name` via `orgSender()`;
  M39's stored invoice data has no branding concept (the M53
  invoice PDF is generated from it — branding applies there).
- **Hostname → org resolution:** none anywhere (grep: no hostname
  handling in the API) — hence custom domains are settings +
  guidance only in v1 (see below).

## Delivered
- [x] **Schema — one migration, additive nullable only**
      (`20261010590000_m59_white_label`): `Organization.brandName`,
      `logoUrl`, `logoContentType`, `primaryColor`, `customDomain`.
      Applied to the sandbox DB via `prisma migrate deploy`;
      `prisma generate` run before rebuilding the API.
- [x] **Branding API** (OWNER/ADMIN, TenantGuard):
      `PATCH /organizations/:id/branding` — brand name (blank clears),
      primary colour validated as `#RRGGBB` and stored uppercased,
      custom domain normalised (protocol/path stripped, lowercased),
      hostname-validated and unique across orgs (409 on conflict);
      every change audit-logged (`org.branding.update`).
      `POST /organizations/:id/branding/logo` — base64 JSON upload,
      PNG/JPEG/WebP only, ≤ 1.5 MB decoded, and the declared type
      must match the bytes' magic-byte signature (spoof-proof);
      stored via MediaStore. `DELETE .../branding/logo` removes it.
      `GET /public/branding/:organizationId/logo` (@Public) serves
      the bytes — the ONLY public branding surface; 404 when the org
      has no logo. (Bootstrap note: the JSON body limit was raised
      to 3 MB in `main.ts` — the 100 kb framework default would
      reject a 1.5 MB image's base64; documented in code.)
- [x] **Branding applied — tenant web shell:** the dashboard sidebar
      + mobile topbar show the org's logo and brand/display name
      when set (platform default otherwise, unchanged); the primary
      colour feeds the design system's existing `--brand-from /
      --brand-to` CSS variables for the dashboard subtree (buttons,
      focus rings) — an accent, deliberately not a theme rewrite.
- [x] **Branding applied — PDFs:** `orgSender()` now resolves
      `brandName ?? name` and the primary colour; the M53 label and
      invoice composers draw a brand-colour accent bar when a colour
      is set, and are byte-identical to before when it is not (unit
      proven). Logo *images* are not embedded in the PDFs in v1 —
      the hand-rolled PDF writer has no image XObject support;
      deferred rather than faked.
- [x] **Shareable client report (M20 token, M59 payload):**
      `publicReport` now also returns `branding { name, logoUrl,
      primaryColor }` (brand name wins; the legal org name still
      ships as `business` and is shown as the small line) and a
      `delivery` summary for the report window from the org's real
      `CourierShipment` rows: total shipments, delivered
      (`delivered` + `partial_delivered`), returned, and return rate
      % (null when nothing was decided — never a fake 0). Ad spend /
      revenue / orders / campaign rows are the pre-existing M20
      payload from `AnalyticsService.computeRange`; COGS and profit
      remain excluded. The `/r/[token]` page renders the logo +
      brand name header, accent-coloured KPI values, and a
      ডেলিভারি সারসংক্ষেপ strip. The public response exposes ONLY
      the aggregated report — no member, cost or internal fields.
- [x] **Settings UI:** Organization Settings gains a "ব্র্যান্ডিং —
      White-Label" card: logo upload/preview/remove, brand name,
      colour picker + hex, custom-domain field with step-by-step
      DNS CNAME + Dokploy instructions, and a report-link pointer
      to the existing Analytics share card.
- [x] **Custom-domain boundary, stated in the UI itself:** the
      settings card says plainly (in Bengali) that the field only
      records intent — the domain goes live only after the DNS
      CNAME and the hosting-panel (Dokploy) domain + SSL steps are
      done, and that routing cannot be switched on from inside the
      app. No routing infrastructure was built or implied.

## Tests
- New unit specs (hand-rolled fake-Prisma pattern):
  `organizations/m59-branding.spec.ts` (10 tests: save/normalise,
  clearing, malformed colour/domain 400s, cross-org domain conflict
  409, owner keeps own domain, tenant isolation, logo round-trip
  through the store, type-spoof + oversize rejection, public null
  states, cross-org logo isolation),
  `reports/m59-report-branding.spec.ts` (4: branding + delivery
  payload with window/org filtering, wrong token, expired, revoked),
  `courier/m59-pdf-branding.spec.ts` (4: accent op + brand name in
  label/invoice bytes, no-branding = no colour op, bad colour
  ignored). One regression caught by the OLD suite: phase-i's fake
  Prisma has no `courierShipment` table — the delivery block is now
  defensive (absent table → empty summary) so the report can never
  break on it.
- Full API suite: **580 pass / 82 suites** (baseline 562/79 + 18).
  Web tests: 20 pass. Full monorepo build green.

## Live-proven (sandbox, fresh tenant end-to-end)
Register → create org → PATCH branding (200; name/colour/domain
normalised) → invalid colour 400 → logo upload 201 → public logo
200 `image/png` with real PNG bytes and no auth → unknown org logo
404 → spoofed-type upload 400 → create share → public report 200
carrying branding + delivery block + legal business name → wrong
token 404 → revoke → public report 404 immediately → a second
share with `expiresAt` moved into the past (direct DB update)
flips 200 → 404 → `/r/<token>` page serves 200. PDF accent +
brand name are unit-proven in the PDF bytes (no booked shipment
existed on the fresh live org to print from). The demo org's
stored password differs from the seed on this sandbox DB
incarnation, so the live run used a fresh tenant — which also
exercised register → onboarding-free org creation.

## Deferred (explicit)
Logo image embedding inside PDFs; per-client (sub-org) branding —
v1 branding is per-Organization, and an agency's clients are
separate Organizations with their own branding; actual custom-domain
routing (hosting-panel concern, guidance shipped); theme beyond the
primary-colour accent.

## Roadmap note
Next and last in Batch 5: **M60 PWA Mobile Experience**
(manifest + hand-rolled service worker + inbox-first mobile bottom
navigation). That completes the M50–M60 Next-Level program.
