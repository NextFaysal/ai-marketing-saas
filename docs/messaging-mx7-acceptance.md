# MX7 — Drag-drop Email Builder & Content Library — Acceptance

Status: **CODE-COMPLETE** (local commits only, no push). A block-based
email builder in the Messaging composer whose rendered output lands in
the SAME `MessageTemplate.body` / `htmlBody` the existing send path
already renders, a per-org content library of saved blocks, a brand kit
sourced from Organization Settings, template versioning with restore,
and a Bangladeshi festival template pack whose product/coupon slots
fill only from the org's real catalog/discount rows.

Commits (branch `messaging-advanced`, base `a37bae6e`):

- `9ad04cf8` — MX7: block email engine + festival packs + pure specs (9)
- `4a6f55e3` — MX7: schema + migration `20261019040000_mx7_email_builder`
  + service + Org Settings branding extension + service specs (10)
- `62e3f296` — MX7 web: builder section + content library + packs +
  version UI; Settings BrandingCard font/secondary color; web specs (3)
- (this doc's commit — see git log)

## Step 0 — audit findings (recorded before any MX7 code)

**Composer / templates today.** `MessageTemplate` (schema ~line 4449)
is `{ name, channel: email|sms, subject?, body, htmlBody?, createdById }`
— no versioning, no structured content. `createTemplate` /
`updateTemplate` / `deleteTemplate` in `messaging.service.ts` write the
row directly; there is no version history anywhere. The send path is:
template content is COPIED onto a `Broadcast` row at creation
(`createBroadcast` reads subject/body/htmlBody from the template), and
sends render the broadcast's stored copies per recipient
(`renderTemplate` in `render.ts`, `{{variable}}` substitution from real
snapshot data only). `MessageDelivery` rows store outcome/lifecycle
only — they never stored rendered content, so "already-sent messages
don't change" is guaranteed by the broadcast-copy semantics, which MX7
preserves and spec-proves (below).

**`composer-blocks.ts` is NOT a block engine.** Despite the name, the
pre-MX7 file is 61 lines of pure snippet formatters
(`productSnippetText/Html`, `couponSnippetText/Html`, `formatPriceMinor`,
`escapeHtml`) inserted as TEXT into body/htmlBody at compose time; its
own header says "there is no block engine". MX7 therefore built the
block model in a new module (`email-blocks.ts`) and REUSED the snippet
module's price/escape helpers so block-rendered prices are formatted
identically to snippet prices.

**The coupon honesty limit (MS5, recorded in the web mirror).** There
was no tenant coupon picker in messaging: the composer coupon form is
free-text ("the system does not validate, redeem or track the code").
The audit found the org's REAL coupon store does exist elsewhere —
`StoreDiscount` (org-scoped, `@@unique([organizationId, code])`, kind
percent|fixed|free_shipping, active flag) used by checkout/promotions.
The platform `Coupon` model is NOT it (global, plan-scoped, no org).
MX7's coupon slots resolve from `StoreDiscount`; the free-text code
remains available with its MS5 text-only semantics, labelled as such in
the UI.

**Brand assets today.** Organization Settings branding (M59) already
holds `brandName`, `logoUrl`, `primaryColor` on the **Organization
row**, written via `PATCH /organizations/:id/branding`
(`OrganizationsService.updateBranding`, hex-validated) and edited in
the dashboard Settings page's BrandingCard. `BusinessProfile` (the
Business Knowledge record) holds `brandVoice` but NO logo/colors/font.
Missing for a brand kit: a font and a secondary color. Per the task
rule (extend the central place, never a second store), MX7 added
`brandFont` + `brandSecondaryColor` to the Organization row's existing
branding — same endpoint, same card, same hex discipline; the font is
an allowlist key (`BRAND_FONT_STACKS` in `email-blocks.ts`), never
free-text CSS.

**Pins respected.** `ms5-composer.spec.ts` pins "workflow sends are
NEVER rewritten" (link tracking) and MS7 pins no open pixel on
workflow sends. MX7 touched NO send-path rewriting: block rendering
happens only (a) when a template is saved and (b) when a broadcast is
created from a block template. Workflow sends keep reading the
template's stored body/htmlBody exactly as before. No existing spec
was edited; the full messaging suite passes unchanged (Gates).

## Shipped

**Block engine — `apps/api/src/messaging/email-blocks.ts`.**
Six block types (text, image, button, product, coupon, divider) with
strict validation (unknown type / empty text / non-http(s) URLs /
oversized fields are a 400, never silently dropped; max 50 blocks).
Rendering is deterministic and produces the existing output format:
plain-text `body` + `htmlBody`. Interpolated values are HTML-escaped;
text blocks can never inject raw HTML. Product blocks render ONLY
from a real Product row handed in by the service (name, real
`priceMinor`/`currency` via the MS5 formatter, slug URL rule identical
to the composer picker, `imageUrl` when present); coupon blocks
render ONLY from a real StoreDiscount row (code + a label derived
from the row's own kind/value) or an org-authored free-text code.
An unfilled slot or a missing/deleted/inactive row renders NOTHING
and is reported in `emptySlots[]` with the reason — surfaced in the
builder preview and the save response.

**Brand kit.** `GET messaging/brand-kit` reads the Organization row
(brandName with org-name fallback, logoUrl, primaryColor,
brandSecondaryColor, brandFont) — messaging stores no brand data.
The renderer wraps block output with the kit: logo + brand name
header, primary color on buttons/product prices, secondary color on
coupon borders/product links, the allowlisted font stack. Applied at
template save and re-applied at broadcast creation (use time);
already-created broadcasts and stored templates keep their bytes
(spec-proven: after a kit change, the old broadcast and template are
byte-unchanged while a new broadcast from the same template uses the
new kit).

**Templates (service + API).** `createTemplate`/`updateTemplate`
accept `blocks` (email only; blocks + explicit body/htmlBody together
is a 400 — two sources would drift). Without blocks, every pre-MX7
behaviour is byte-identical — spec-proven end-to-end: an old-format
template's body/htmlBody survive create, and a broadcast built from
it carries the EXACT same bytes. New routes: `POST
messaging/blocks/preview` (render-only, saves nothing), `GET
messaging/composer/discounts` (this org's ACTIVE StoreDiscount rows),
`GET messaging/brand-kit`.

**Versioning.** Migration adds `MessageTemplate.version` (starts 1)
and `MessageTemplateVersion` snapshots. Create snapshots v1; a
content-changing PATCH bumps the version and snapshots (a no-op PATCH
does not); `GET templates/:id/versions` lists newest-first; `POST
templates/:id/versions/:version/restore` restores by creating a NEW
version copying the target snapshot — history is append-only.
`Broadcast.templateVersion` is stamped at broadcast creation from the
template actually used, so sends DO record their version (via the
broadcast row their deliveries hang off) — this part is BUILT, not
deferred. One honest bookkeeping note: `updateTemplate`'s route has
never carried an actor (pre-MX7 signature), so a version snapshot
written by an update records the template's original `createdById`
rather than an invented editor id; restore (a POST with a user)
records the real actor.

**Content library.** `MessagingContentBlock` (per org) + CRUD routes
(`content-blocks`): a saved block is one validated email block
(`data` Json + `kind`). The web UI lists them as chips in the builder
— click inserts a copy into the draft; each draft block has a 📚
save-to-library action; delete is per-chip (OWNER/ADMIN at the API).

**Festival pack — `festival-templates.ts`.** Four designs (`eid`,
`puja`, `pohela_boishakh`, `winter_sale`): greeting text + divider +
product slot + coupon slot + closing text, Bengali copy, NO product,
NO coupon code, NO price, NO shop URL baked in (a spec asserts the
serialized blocks contain no ৳/percent/code). `GET
messaging/template-packs` + `POST messaging/template-packs/:key/install`
create a real template through `createTemplate`; its slots render
empty (reported in `emptySlots`) until the org picks real rows in the
builder — after which update re-renders with the real price/code
(spec-proven).

**Web (Messaging page + Settings).** A "🧱 Email Builder ও Content
Library" section inside the existing Messaging page: block palette
(six types), per-type editors (product picker from the existing
composer products, discount picker from real StoreDiscount rows,
free-text code field labelled as unvalidated text), reorder by HTML5
drag AND ↑/↓ buttons (drag alone is not accessible), server-rendered
sandboxed-iframe preview with empty-slot warnings, save as new/existing
template, festival pack install buttons, brand-kit summary line.
Template rows gain a Version chip + history panel with per-version
Restore, and a "🧱 বিল্ডারে খুলুন" button for email templates (a
hand-authored template opens with its body as one text block —
content preserved; saving converts it to a block template). Settings
BrandingCard gains the secondary-color picker + brand-font select
writing the same branding endpoint. Web helpers in
`apps/web/src/lib/email-blocks.ts` (shape/reorder/clean only — the
web never renders final email HTML, so preview can never drift from
what a send uses).

**Migration.** `20261019040000_mx7_email_builder` (first MB3 slot):
Organization.brandFont/brandSecondaryColor, MessageTemplate.blocks/
version, MessageTemplateVersion + MessagingContentBlock tables,
Broadcast.templateVersion. Additive only, existing style followed.

## Scoped gates (actually run, serially)

- **API jest, messaging dir (full): 20 suites / 333 tests — all pass.**
  Includes the two new MX7 suites (mx7-email-blocks 9, mx7-builder 10)
  and every MS/MX pin suite (ms5-composer, ms7-delivery-lifecycle,
  ms10-management, mx1–mx6) unmodified.
- **API jest, organizations branding: 2 suites / 18 tests — all pass**
  (m59-branding, rb4-branding; the MX7 branding fields are additive
  and optional there).
- **API tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Web tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Web vitest (scoped): 2 files / 6 tests — all pass**
  (new `lib/email-blocks.test.ts` 3 + existing composer-blocks 3).
- **Prisma validate: valid** (run with a dummy DATABASE_URL — the CLI
  requires the env var to load the schema).
- NOT run by this worker (coordinator's batch gates): full API jest,
  full web vitest, Next build, fresh-Postgres migration union.

## NOT BUILT / honest limits

- **Per-delivery version column** — version is recorded on the
  Broadcast (templateVersion), not duplicated onto MessageDelivery;
  deliveries reach it via broadcastId. No delivery-level version
  exists and none is claimed.
- **Restore does not re-render blocks** — restore copies the target
  snapshot's stored body/htmlBody/blocks exactly (history fidelity
  over freshness); re-saving in the builder re-renders.
- **Block builder in the broadcast composer** — the builder is
  template-scoped; broadcasts consume builder templates through the
  existing template picker (and inherit the use-time re-render +
  version stamp). The broadcast form's own body/htmlBody fields are
  unchanged.
- **WhatsApp/SMS blocks** — blocks are email-only by design (SMS has
  no HTML part; WhatsApp sends Meta templates). The API refuses
  blocks on non-email templates with that reason.
- **Brand-kit write validation spec** — the new `updateBranding`
  font/secondary-color validation mirrors the spec-covered
  primaryColor pattern and the read side is covered (getBrandKit
  spec; m59/rb4 suites pass), but no dedicated Organizations spec
  asserts the new fields' 400s. Recorded here rather than padded.
- **Version snapshots in pre-MX7 fake-prisma environments** —
  `snapshotTemplateVersion` is table-presence-guarded so older spec
  harnesses keep exact old behaviour; in a real deployment the table
  exists after the migration and snapshots always write.
- No migration has run on a real DB; no live provider proof exists
  for MX7 (M30 owed). No screenshot QA of the builder UI was done.
