# Interim Release — 2026-10-16

Owner-approved interim release ("হুম শুরু করো", 2026-10-16 18:01 +06): the five
already-completed local lines, unioned onto current GitHub main. The Messaging
Advanced program (MX) is NOT in this release — it ships in the later final
release together with the Messaging design package.

## Base

- GitHub main at release time: `8f4fd0f3` = GC-stack release `17a2c27` + the
  owner's own 7-step Bangladeshi e-commerce growth & marketing suite
  (`1526500c`, 84 files, incl. one migration) + his merge commit.
- ls-remote was re-checked immediately before the push: main had not moved.
- Push is fast-forward only; no owner code was overwritten or rewritten.

## Composition (per-line HEADs unioned)

| Line | Branch / source | HEAD | Content |
| --- | --- | --- | --- |
| E-Commerce Design ED1–ED18 | design-v3 | `48cee752` | Web-only design program (tokens v3, shop v2, dark mode ED17); no migrations |
| Tenant Domain TD1–TD12 | tenant-domain | `4ca37a3` | +1 migration `20261018000000_td11_slug_tombstone` |
| Admin Design Next (ADNX) | admin-design-next | `7ec9e6d4` | Admin app redesign; no migrations |
| Social Posts Next SN1–SN10 | social-next | `e3cbeb7` | +3 migrations (`20261015100000`, `20261015110000`, `20261015130000`) |
| Business Knowledge → Settings | settings-knowledge | `338a742` | Cherry-picked single commit (see note below); web-only |

Union method: merges for design-v3 / tenant-domain / admin-design-next /
social-next; cherry-pick for settings-knowledge (its branch history rides the
r2-media line — merging it would have replayed that history; the task itself
is exactly one commit, 7 files, web-only).

The settings-knowledge worktree's one dirty file was
`apps/web/tsconfig.tsbuildinfo` (a tsc build cache) — deliberately excluded,
not committed. The same cache file churned in this worktree during gate runs
and was likewise restored before the release commit.

## Migration union

- 216 migration folders total (212 on main incl. the owner's
  `20261016010000_ai_voice_calling_cod`, + TD 1, + SN 3). No timestamp
  collisions; design/ADNX/settings lines add none.
- Fresh-Postgres proof: `prisma migrate deploy` on an empty Postgres 16 —
  **216/216 applied cleanly, 323 tables**.
- No migration in this release has run on the real database; that happens at
  the owner's manual Dokploy Redeploy (API start).

## Gates (all run on the union tree, serialized)

- API tsc: **0 errors**
- API jest (chunked by directory, 502 suite-runs): green except the two
  pre-existing failures below. Every other chunk failure was adjudicated by
  solo `--runInBand` re-runs (all passed) — the chunk failures were worker
  SIGKILL / 5 s-timeout artefacts of running on a 7 GB box alongside other
  batches' gates.
- Web vitest: **893/893** (109 files) — run twice, incl. after the union fixes
- Web tsc: **0 errors**
- Root build (`pnpm -r build`): **7/7 workspaces Done** (api, web, admin,
  worker, @repo/db, @repo/contracts, @repo/ui)
- Prisma schema: valid; no duplicate models after the schema auto-merges.

## Pre-existing failures on current main (NOT caused by this union)

Both were proven to fail identically on a pristine checkout of `8f4fd0f3`:

1. `cc26-payout-automation.spec.ts` (1 test) — the known test-clock mismatch
   (expected `already_created_for_slot`, got `below_threshold`); disclosed in
   the GC-stack release as well. Fix decision remains the owner's.
2. `adx3-nav-counts.spec.ts` (1 test) — `overdueSubscriptions` expected 1,
   got 2; a date-sensitive fixture (passed in the morning gate of the
   GC-stack release, fails on unmodified main by the afternoon of
   2026-10-16).

## Union repairs made during integration (3 commits)

1. `12d7c553` — `platform-config.ts`: the googleOAuth/threads conflict stitch
   dropped the tail of `effectiveGoogleOAuthConfig()` (missing `return
   null`); restored. Both admin-config areas (Google SSO + Threads app)
   survive in full: snapshot fields, PLATFORM_CONFIG_KEYS, admin service
   view/patch branches and the admin settings page sections.
2. `ed49dd95` — GB9 public-docs drift guard: TD added the public route
   `GET /public/shop/domain-allowed` and the owner's suite had added
   `POST /public/shop/:orgSlug/track/ndr-recovery` without regenerating the
   frozen inventory (the guard already failed on main for the latter). Both
   routes are now deliberately registered in the frozen inventory with
   provenance comments; the spec passes on the union tree.
3. `e4ce3ece` — web stitch losses: restored the TD `domainNotice` state
   declaration in the storefront settings page (its handlers and render
   survived; the `useState` line did not); in the customers page, dropped
   the owner's orphaned `notice` banner — in the union every one of those
   feedback flows surfaces through the design system's `useToast()` calls,
   and the banner had no producer left.

## Notable conflict resolutions (zero feature loss)

- `nav.ts` (web): design's lucide icon-key nav kept; the owner's 4 suite
  entries (inventory forecasting, influencers, funnels, WhatsApp bot)
  grafted in with 4 new icon keys. The Business Knowledge nav entry is
  removed by the settings-knowledge change, as the owner decided.
- Abandoned-carts page: design's structure + the owner's WhatsApp recovery
  action and KPI cards.
- Customers page: design shell + the owner's RFM tab and studio.
- Storefront settings page: AB4 checkout-fields section + TD9's unified
  domain section; TD9 replaces the older custom-domain section (dropped).
- Sitemap: rewritten as a union — platform-path and canonical-host builders
  both emit blog entries; the route uses the canonical base.
- API `main.ts`: GC23's `/v1` alias middleware and TD6's dynamic CORS
  checker both kept.
- `social-publish.service.ts`: constructor unioned so SN's positional spec
  construction (YouTube/TikTok/Telegram/Threads slots) and main's
  PublicMediaService both resolve.
- Admin tickets page: the owner's expanded support console (1,324 lines:
  composer modes, attachments, canned responses, AI draft/summary, SLA
  filters) kept as the base, with ADNX's deltas grafted (PageHead,
  last-filters persistence, mobile filter rail, two-step mobile detail
  sheet). ONE deliberate deviation: ADNX's banner→toast conversion was NOT
  applied to tickets — the owner's console routes ~15 composer/AI/canned
  flows through those banners and converting risked silently swallowing
  persistent feedback.

## Honest limits

- Nothing in this release is live-proven. It becomes live only after the
  owner's manual Dokploy Redeploy, which will run the 5 new migrations
  (1 owner-suite migration already on main + TD 1 + SN 3 — 216 total) on
  the real database; fresh-DB proof only.
- Per-org job enables still owed (incl. SN's `social_coach_weekly`,
  `social_syndication_sweep`), plus the standing M30 / TD12 / SN live
  checklists, threadsApp admin config, and screenshot QA for the design
  and ADNX packages.
- A parallel audit (OU0-SN) separately flagged small SN union-craft items
  (nav/meta details, a worker registry entry) being fixed on the
  one-umbrella line; SN also rides the final release, where those fixes
  land and are re-verified.
