# Social Posts Completion PP1 — SVG → PNG Rasterizer — Acceptance

PP1 removes the SP6 limit that made SP4 Template Posters unpublishable:
an SVG asset is now converted to PNG (sharp) before Meta/Instagram
publishing, cached as a derived MediaAsset, and can also be rasterized
on demand from the media library.

## sharp — real load + conversion evidence (this sandbox)

- `sharp@0.35.5` (added to `apps/api/package.json` + lockfile),
  libvips **8.18.7**.
- The PP1 spec (`apps/api/src/social/social-pp1.spec.ts`) runs the
  REAL sharp against the REAL SP4 composer output
  (`composePosterSvg`, Bengali headline "ঈদ অফার" + subtext):
  - PNG magic bytes `89504e470d0a1a0a` ✔
  - metadata: format `png`, **1080×1080** ✔
  - Headline-band pixel check: raw pixels in the poster's bottom
    band (y 850–960, x 40–700) — **5,532 bright pixels**
    (luminance > 180) measured against the same fixture shape in
    this environment; the spec asserts > 500, i.e. the Bengali
    `<text>` genuinely rendered and the band is not blank ✔
- The sandbox HAS Noto fonts installed, so Bengali text renders
  here. **Production did NOT**: the slim runtime image
  (`node:22-bookworm-slim`) ships no fonts at all, so poster text
  would silently vanish there. The root `Dockerfile` runtime stage
  now installs `fontconfig fonts-noto-core` (Noto Sans + Noto Sans
  Bengali) — this change is REQUIRED for production parity, not
  cosmetic.

## Design

- **Raster service** (`apps/api/src/social/social-raster.service.ts`,
  `SocialRasterService`): `convertSvgToPng(svgBytes)` =
  `sharp(svgBytes).resize({ width: 1080 }).png().toBuffer()`.
  Seams are public fields specs can substitute: `converter`
  (count calls / force failures), `readBytes` / `writeBytes`
  (default to `MediaStore.fromEnv()` get/put).
- **Derived-asset model**: migration
  `20261010990000_pp1_media_derived_from` adds nullable
  `MediaAsset.derivedFromId`. `ensurePngAsset(orgId, actorId, source)`:
  1. Cache lookup `findFirst({ organizationId, derivedFromId: source.id,
     contentType: "image/png" })` → return the row if present
     (org-scoped: another tenant's derived PNG is never reused —
     spec-proven).
  2. Otherwise read the SVG bytes, convert, store the PNG at
     `<org>/social/<newId>.png`, and create the MediaAsset with
     `derivedFromId = source.id`, name `"<source name> (PNG)"`,
     and **`origin` PRESERVED from the source** — origin describes
     the content's provenance (a rasterized template poster is
     still template content); `derivedFromId` records the
     mechanical derivation.
- **Publish path** (`social-publish.service.ts`, Meta branch only;
  the TikTok/YouTube OAuth dispatch is untouched and still runs
  first): each SVG asset row is replaced by its derived PNG row
  before public URLs are minted; non-SVG rows pass through
  unchanged, so the SP6 flow is byte-identical for raster media.
  The raster service is an `@Optional()` constructor dependency
  defaulting to a real instance — every existing spec construction
  (SP5–SP9) keeps working unchanged.
- **Library action**: `POST organizations/:orgId/social/media/:id/rasterize`
  (WRITE_ROLES: OWNER/ADMIN/MARKETING_MANAGER) returns the PNG
  asset serialized like the other media responses; non-SVG →
  honest Bengali 400; cross-org/missing → 404; audit-logged as
  `social.media_rasterized`. The web Social Posts library shows a
  "PNG সংস্করণ তৈরি করুন" button on SVG assets; the returned PNG
  appears in the list and is selectable for a post.

## Contract change (gate → conversion)

SP6's contract was: SVG ⇒ permanent failure with the gate text,
before any platform call or token mint. PP1 replaces it with:
SVG ⇒ convert (cached) ⇒ publish the PNG. The failure side is
preserved and re-scoped in `social-sp6.spec.ts`: a conversion
error fails the post **permanently** (attempts untouched) with
`SVG থেকে PNG তৈরি করা যায়নি: <converter's verbatim message>`,
still before any platform call and before any public-token mint;
the success path is proven in `social-pp1.spec.ts` (published via
the derived PNG's public URL, `contentType: "image/png"` reaching
the publisher, derived row created, source SVG never minted a
token).

## Error semantics

- Missing source bytes in storage → `ensurePngAsset` throws a
  clear Bengali error; in the publish path it is wrapped exactly
  like any conversion failure (permanent, verbatim message kept).
- Converter (sharp) failure → same permanent-failure wrapping;
  no derived row is created and the platform is never called
  (spec-proven with a `boom-fixture` converter).

## Evidence ceiling

- Gates run in this sandbox: API `tsc --noEmit` clean; full API
  jest **1336 pass / 167 suites** (PP1 spec: 5 tests, all green;
  SP6 suite green after the contract re-scope); web vitest
  **72/72**; monorepo build **7/7 green**; `prisma validate` —
  schema valid.
- **No Postgres in the sandbox**: the migration is hand-written
  and unapplied locally; it applies via `migrate deploy` on the
  owner's server.
- **No real Meta publish**: no Meta token exists here; the publish
  proof is at the stub-fetch boundary (SP6 pattern). The first
  real Template-Poster publish belongs to the M30 sprint.
- Production font rendering is fixed by the Dockerfile change
  above but only takes effect on the next image build/deploy.
