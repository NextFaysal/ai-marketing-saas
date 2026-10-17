# Final Union Release — 2026-10-17

One release commit on top of GitHub main `985e722a`, unioning every
closed program line. Prepared under the owner's conditional
authorization of 2026-10-16 15:12 +06 and the 2026-10-17 11:40 plan
(one union release after Smart AI closed; base = re-fetched current
main; owner's own commits merged first, never overwritten, never
force-pushed). `git ls-remote` was re-checked immediately before the
release commit was built: remote main was still `985e722a`.

## Composition

Base: owner's main `985e722a` (his 14 feature commits — storefront
themes, WhatsApp catalog bot, abandoned chase, fraud/RTO, influencer
ROI, festival blast, POS receipt, RFM studio, live selling, courier
SLA — plus migration `20261017090000_storefront_marketing_pixels`).

Unioned lines (each merged as a true merge; every line HEAD verified
an ancestor of the union tree):

| Line | HEAD | Content |
|---|---|---|
| Messaging Advanced (MX) | `de24bea5` | MX1–MX16 |
| Messaging Design (MXD) | `3bc9c90d` | Messaging page redesign |
| One Umbrella (OU) | `dbd6b4eb` | OU0–OU12 |
| Organization Next (ORG) | `b3427586` | ORG1–ORG13, ORG16 |
| Campaign Advanced (CA) | `52976c0b` | CA1–CA28 |
| New Frontier (NF) | `e0a840e1` | NF1–NF15 |
| Smart AI (SAI) | `7e163873` | SA Phases 0–6 (26 shipped, 2 partial) |

## Migrations — 280 total

217 on base + 63 new (MX 15, OU 6, ORG 6, NF 15, CA 11, SAI 10,
MXD 0). No base migration missing; no same-name folder collision
(same-timestamp folders carry distinct names). Fresh-Postgres gate:
**280/280 applied** (`prisma migrate status`: up to date; 401 public
tables). One documented environment deviation, used on every SAI
batch on this VM: the embedded Postgres here has no pgvector, so
`20261027000000_sai_vector` first stops at `CREATE EXTENSION vector`;
on the throwaway DB only, a `vector` TEXT domain stand-in was
created, the migration's remaining DDL applied verbatim from the
shipped file, and the migration marked applied — the shipped file
itself was NOT modified for this. On the real deployment the
pgvector extension must exist (compose image swap below).

## Gates (all run serially on the union tree)

- **API jest:** 631 suites / 6,051 tests across chunked runs +
  re-runs. Green except the two documented pre-existing failures
  below. Suites that initially died from a Nest DI bug were re-run
  after the fix (33/33 DI verify; rechunks 278/278 and 218/220, the
  2 failures being the GB9 inventory, since fixed and re-verified
  7/7 solo).
- **API tsc:** 0 errors.
- **Web vitest:** 1,128/1,128 (138 files) after the shop-theme pin
  regeneration described below.
- **Web tsc:** 0 errors. **Web build:** PASS. **Admin build:** PASS.
- **Fresh-PG:** 280/280 (above).
- **Boot smoke:** API boots against the fresh-PG database,
  `GET /health` → `{"status":"ok"}`, **2,040 routes** mapped
  (RouterExplorer). This also proves the TelegramClient /
  ThreadsClient / GoogleBusinessClient DI fixes at runtime.

## Known pre-existing failures (NOT union regressions)

- `adx3-nav-counts` (1 test): spec pins "now" to 2026-10-15 while
  `billingSummary` reads the wall clock; the expected overdue count
  drifts daily. Proven failing on three pristine bases in the
  SA-B22–B25 acceptances.
- `cc26-payout-automation` (1 test): second sweep returns
  `below_threshold` instead of `already_created_for_slot` — recorded
  as "the known cc26 wallet-sweep failure" in SA-B25's acceptance on
  the Smart AI ancestry itself.
- `ca19-geo-holdout` failed once inside a chunk run and passes solo
  (7/7) on the identical tree — treated as an intermittent
  chunk-run artifact.

## Union fixes applied on top of the merges (labelled commits)

1. **Junk cleanup** (`6f16f403`): removed the 2,146 tracked
   jest-cache files under `apps/api/src/~/workspace/.tmp-int7/` that
   the old release commit `17a2c272` had swept into the remote tree;
   `.gitignore` guard added (`apps/api/src/~/`, `**/.tmp-*/`).
2. **OU7 journal rename** (`73f0f758`): NF10 and OU7 both shipped
   models AND tables named `JournalEntry`/`JournalLine` with
   different shapes (`prisma validate` failed). OU7's renamed to
   `Ou7JournalEntry`/`Ou7JournalLine` in the schema, in OU7's
   never-deployed migration, and in the OU7 accounting service +
   spec. NF10 kept the original names.
3. **Three merge stitches** (`398bec14`): `messaging.service.ts`
   (SA-B20 personalisation block had landed inside MX14's `onsite`
   block, eating a closing brace), `inbox.service.ts` (MX6
   keyword-reply closing brace restored), `support.service.ts`
   (deduped; main's current 8-value `TICKET_CATEGORIES` kept).
4. **GoogleBusinessClient `@Optional()`** (`ca0aa8a4`): same
   undecorated-constructor-param bug class as the Telegram/Threads
   fix (NF `b6dcc457`, verified present in the union tree); it was
   killing 4 DI spec suites via Nest `process.exit`.
5. **GB9 drift-guard inventory** (`c73bf42f`): regenerated +3 real
   routes (`/public/shop/:orgSlug/offers`, `.../popup-lead`,
   `.../account/store-credit`).
6. **MX8 × SA-B20 personalisation seam** (`e9151271`): the create
   DTO's single `personalization` input carries two vocabularies on
   two columns; the merged `createBroadcast` ran MX8's strict parser
   unconditionally, rejecting G2-only configs. MX8's block now
   applies only when the input carries MX8 vocabulary; G2 configs
   flow through their own normalizer/assert/persist. MX8 catalogue
   pin regenerated (SA-B20 deliberately lists its memory variables;
   MX8's own variables remain unlisted).
7. **GB7 tracking pins** (`73784a2e`, `00ad6533`, `e61737fc`):
   regenerated from 5 to the shipped 8 tracking fields. This failure
   **pre-existed on GitHub main itself** — the owner's
   marketing-pixels work added `metaPixelId`/`tikTokPixelId`/
   `clarityId` to `TRACKING_FIELDS` (spec and code byte-identical on
   main); the pin was stale there, not a union regression.
8. **Shop-theme pin** (`09ee6226`): regenerated 21 → 23 themes
   (OU8's gallery added `warm` + `ocean` over main's 21).
9. **shop-i18n dedupe** (`343aad7e`): the OU merge had kept both
   sides' bn/en segments — `sort`, `popup`, `brand`, `pages`,
   `blog`, `shop404` twice per locale (TS1117; ShopPopup's lead
   strings resolved against the close-only popup). OU's file differs
   from main's only by the 7 lead-capture keys per locale; the
   deduplicated dictionary restores main's content + those keys.
10. **This release note.**

## Deploy — owner's manual steps (unchanged by this release)

- Dokploy **Redeploy** is still the owner's manual step; the push
  alone does not deploy.
- The Smart AI migrations require pgvector on the production
  database: the Dokploy compose image swap to
  `pgvector/pgvector:pg16` must accompany this release — the SAI
  migrations must not deploy ahead of it.
- Everything else owner-gated stays as recorded per program:
  per-org job enables (all default OFF), Connect Center go-live
  values, wallet legal review, `FRAUD_NETWORK_HMAC_KEY`,
  `INTERNAL_JOB_SECRET`, and all M30 live verification. Nothing in
  this release is live-proven.
