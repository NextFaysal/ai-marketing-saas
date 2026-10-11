# Social Posts Completion PP3 — Product Image Import (URL → MediaStore) — Acceptance

PP3 removes the SP2/SP4 limit that made product photos unusable in
Social Posts: a product's photo existed only as an external
`imageUrl`, with no way to bring it into the Media Library. A
product-only Template Poster dead-ended in an honest Bengali 400
("…import করার ব্যবস্থা এখনো নেই"). PP3 builds the real import —
a guarded server-side fetch — and closes that dead end.

## What was built

- **Endpoint**: `POST organizations/:organizationId/social/media/import`
  `{ productId }` (WRITE_ROLES: OWNER/ADMIN/MARKETING_MANAGER),
  declared with the SP4 image routes, BEFORE the `media/:id`
  routes, so the literal `import` is never captured as an asset
  id. Response = the asset serialized exactly like the other
  media endpoints (plus `sourceUrl`).
- **Service**: `SocialImportService`
  (`apps/api/src/social/social-import.service.ts`), registered in
  `SocialModule`. `importForProduct(orgId, actorId, productId)`:
  1. Product resolved org-scoped
     (`product.findFirst({ id, organizationId })`) → cross-tenant
     or missing = 404 "Product not found in this organization".
     Empty/null `imageUrl` = Bengali 400, before any network work.
  2. **Dedupe FIRST**: an existing MediaAsset with
     `{ organizationId, sourceUrl: imageUrl }` is returned as-is —
     no DNS, no fetch, no second row. The same product URL imports
     exactly once per organization.
  3. Guarded fetch (below) → bytes.
  4. **Magic-byte sniff** (`detectMediaKind`, the inbox sniffer):
     the bytes must be an image. HTML returns no detection and a
     PDF sniffs as `application/pdf` — both are refused with a
     Bengali 400 naming what was detected. The response's declared
     content-type is never consulted.
  5. Stored through the same MediaStore path as uploads:
     key `<org>/social/<uuid>.<ext>`, MediaAsset
     `{ kind: "image", origin: "imported", sourceUrl: imageUrl,
     name: "<product name> — ছবি", contentType: <detected>,
     sizeBytes, createdById: actor }`.
- **Schema**: migration `20261011000000_pp3_media_source_url`
  adds nullable `MediaAsset.sourceUrl`; the `origin` comment now
  lists `imported` alongside `upload | ai_generated | template`.
- **Template auto-import** (`SocialImageService.createTemplateImage`):
  with `productId` set and `mediaAssetId` NOT set, the product's
  photo is auto-imported and the imported asset row flows through
  exactly the `mediaAssetId` path (org check, kind check, price
  default subtext — unchanged). Import errors propagate
  **unchanged** — they are already Bengali HttpExceptions; nothing
  is wrapped and there is no silent fallback. With `mediaAssetId`
  set, behaviour is byte-identical to before (spec-proven: no
  fetch happens). The importer is an `@Optional()` constructor
  dependency defaulting to a real instance (the
  SocialPublishService pattern), so every existing spec
  construction keeps working.
- **Web** (Social Posts page): the composer media picker gains a
  "🛍️ Product থেকে ছবি" block — a product select reusing the SP3
  panel's already-fetched product list (same
  `GET /products?pageSize=100`, no second fetch) → POST
  `social/media/import` → the returned asset is added to the media
  list AND selected in the picker; a server error is shown
  verbatim in a Bengali error line inside the picker block. The
  Template Poster form now labels the library photo "ঐচ্ছিক" when
  a product is chosen and carries the helper text "Product বাছলে
  তার ছবি নিজে থেকে import হয়ে যাবে" — product-only poster
  creation works from the form.

## The guarded fetch (SSRF discipline, as implemented)

The product `imageUrl` is tenant-supplied data; the server must
never become a proxy into the internal network (cloud metadata
endpoints included). Per hop, in this order:

1. **Parse + scheme**: the URL must parse and be `https:` —
   `http:` or anything else is a Bengali 400 BEFORE any DNS
   lookup or fetch. URL credentials (user/password) → 400.
   An explicit port other than 443 → 400 (WHATWG URL normalizes
   an explicit `:443` away, so it passes).
2. **Resolve + public-IP check**: the host is resolved via
   `dns.lookup(hostname, { all: true })` and **every** returned
   address must be public — one private address in the set
   refuses the import, and the fetch never starts. Empty
   resolution and resolver errors are Bengali 400s (the resolver
   error's message is appended verbatim). Literal-IP hosts flow
   through the same resolver path (dns.lookup echoes the literal),
   so `https://192.168.1.5/…` is judged identically. Refused
   ranges — IPv4: `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT),
   `127/8`, `169.254/16` (link-local, incl. `169.254.169.254`
   metadata), `172.16/12`, `192.168/16`, `224/4` (multicast),
   `240/4` (reserved, incl. broadcast); IPv6: `::` (unspecified),
   `::1` (loopback), `fe80::/10`, `fc00::/7`, `ff00::/8`, and
   IPv4-mapped `::ffff:a.b.c.d` judged by its embedded IPv4.
   Anything that does not parse as an IP fails closed.
3. **Fetch**: `redirect: "manual"`, one AbortController bounding
   the WHOLE chain at ~10 seconds. A 3xx requires a `Location`;
   at most **3 redirect hops** are followed, and **each hop
   re-runs steps 1–2 from scratch** before it is fetched — a
   redirect to a private target is refused and that URL is never
   fetched (spec-proven). A non-2xx final response is a Bengali
   400 carrying the status (`…সাড়া পাওয়া যায়নি (HTTP 404)`);
   a network/timeout failure is a Bengali 400 with the underlying
   error message appended verbatim.
4. **Body read**: the cap (`SOCIAL_MEDIA_MAX_BYTES`, 2.1 MB — the
   same cap as uploads) is enforced **during** the read: the body
   is accumulated chunk-by-chunk via `body.getReader()` and the
   read is cancelled the moment the total passes the cap.
   `content-length` is never trusted. Stub-shaped responses
   without a readable body fall back to `arrayBuffer()` + a
   length check (same refusal).

Test seams follow the PP1 pattern: `fetchFn` and `resolveHost`
are public mutable fields on the service, defaulting to the
global fetch and `node:dns/promises` lookup; every spec replaces
both.

## Audit metadata choice

Action `social.media_imported`, entity MediaAsset, metadata =
`{ productId, sourceHost, contentType, sizeBytes }`. The host is
logged, **not** the full URL: a tenant product URL's query string
could carry a signed token (CDN signatures are common), and audit
rows outlive the import. Host + product id is enough to trace any
import. (The full URL is stored on the asset itself as
`sourceUrl` — that is the tenant's own library data, needed for
dedupe, and is only ever returned to that same org.)

## Honest limit — DNS rebinding (TOCTOU)

This guard is **not absolute**, and it is important to say so
plainly. The service resolves the host, validates the addresses,
and then hands the hostname to Node's `fetch`, which performs
**its own** DNS resolution when connecting. There is no supported
way in Node's fetch to pin the connection to the exact address
that was validated. A hostile DNS server could therefore
theoretically answer the validation lookup with a public address
and the connect lookup with a private one (rebinding), slipping
between the check and the fetch. The mitigations present —
https-only, credentials/port refusal, per-hop re-validation
(a rebind would have to win on every hop), the in-read size cap,
and the magic-byte image sniff (whatever is fetched must actually
be a PNG/JPEG/GIF/WebP image, and it lands in the tenant's own
media library — response bodies are never proxied to anyone) —
reduce the practical risk substantially, but they do **not**
eliminate the TOCTOU window. Closing it fully would require a
fetch implementation with connection-level address pinning
(e.g. a custom undici dispatcher resolving to the validated
address), which is deliberately out of PP3's scope and recorded
here as the known residual risk.

## Contract change (SP2/SP4 dead end → auto-import)

`social-image.spec.ts`'s old test asserted the SP2 deferral 400
for productId-without-mediaAssetId. That assertion is replaced
(with an explanatory comment in the test) by the new behaviour:
the auto-import runs, and for the fake product (which carries no
`imageUrl`) the importer's own Bengali 400 ("…কোনো ছবির URL
নেই…") surfaces from `createTemplateImage`. The success and
failure matrix for auto-import lives in `social-pp3.spec.ts`.

## Evidence

- Gates run in this sandbox: API `tsc --noEmit` clean; full API
  jest **1391 pass / 168 suites** (new `social-pp3.spec.ts`: 55
  tests — the `isPublicAddress` range table, the guarded-fetch
  matrix, dedupe, sniff refusals, both oversize read paths, and
  the three template auto-import cases; `social-image.spec.ts`
  updated for the contract change and green); web vitest
  **72/72**; monorepo `pnpm -r build` **7/7 green**;
  `prisma validate` — schema valid.
- **No live external fetch was made or is claimed**: every spec
  runs against stubbed `fetchFn`/`resolveHost` seams and a
  stubbed MediaStore. The first real product-image import happens
  on the owner's deployment with a real product URL.
- **No Postgres in the sandbox**: the migration is hand-written,
  additive-nullable in the neighbour style, and unapplied locally;
  it applies via `migrate deploy` on the owner's server.
