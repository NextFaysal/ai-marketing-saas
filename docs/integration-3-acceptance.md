# Integration-3 Acceptance — EC Phase 3 × (EC Phase-2 × Connect Center) release line (2026-10-14)

Owner instruction 2026-10-14 02:46 +06: option "1" = Push — integration-2
line + E-Commerce Phase 3 shipped as ONE squash release to GitHub main,
following the final-integration pattern (tree-sync into the deploy
clone, one release commit, verified tree identity before push).

## Remote state found (Step 0)

- Transport rebuilt: direct SSH is reset by the sandbox proxy, so
  `/tmp/proxyconnect.py` (HTTPS_PROXY CONNECT relay) was recreated and
  used via `GIT_SSH_COMMAND` with `ssh.github.com:443` and
  `~/.ssh/id_ed25519` — the same setup as previous releases.
- `git ls-remote origin` BEFORE any work: **main = 3e24bc1** — unchanged
  from the known state; the owner had NOT pushed anything new. No
  owner commits needed integrating; nothing was overwritten and no
  force-push was used anywhere.

## What was merged

New worktree `~/workspace/ai-marketing-saas-int3` (branch
`integration-3`) from integration-2 HEAD `21dec09`; merge commit
`9f1762f` of ec-phase2 `61dd904`. Merge-base was exactly `a029713`
(Phase-2 complete), so the merge brought ONLY E-Commerce Phase 3
(EC25–EC34, 32 commits): storefront accounts/OTP + wishlist (EC25),
COD reconciliation (EC26), storefront SEO/discovery (EC27), retention
(EC28), bundles & gifts (EC29), delivery pricing v2 (EC30),
installments (EC31), affiliates (EC32), inventory intelligence (EC33),
POS (EC34). NOT in this release: SU package, CC Advanced (integrate
later, per scope).

### Conflicts

Exactly ONE content conflict in the whole merge:

- `apps/api/src/app.module.ts` — pure union: integration-2's
  `ConnectionsModule` (Connect Center) kept alongside Phase 3's
  `InstallmentsModule`, `AffiliatesModule`, `PosModule` (and the
  cleanly auto-merged `ReconciliationModule`). Resolved by keeping
  BOTH sides in the import list. No feature dropped; no other file
  conflicted (`schema.prisma` auto-merged as a union; a marker scan
  of the merged tree found no leftover conflict markers).

## Migration union

- **155 folders** in the merged tree (145 integration-2 + 10 Phase-3,
  `20261013510000`–`20261013600000`).
- Static check across the union: NO duplicate `CREATE TABLE`, NO
  duplicate `ALTER TABLE … ADD COLUMN` anywhere (the cx7 failure
  shape). The four known same-prefix pairs (cc2/ec18 @210000,
  cc3/ec19 @220000, cc9/ec14 @230000, cc10/ec16 @240000) remain
  content-distinct folders.
- **Fresh-DB proof (this run):** throwaway PostgreSQL 16.15 cluster,
  `prisma migrate deploy` from `packages/db` — exit 0, **155/155
  finished, 0 failed, 0 unfinished, 209 tables**. Cluster deleted
  after the run.

## Full gate on the merged tree (exit-code based)

- API jest: **323/323 suites, 3243/3243 tests PASS** — run in 5
  sequential chunks (607+625+674+670+667) because a single-process
  serial run aborts with SIGABRT (exit 134) in this sandbox, the same
  environment limit every recent batch hit; every chunk exited 0 and
  no flake appeared (cx3-debounce passed).
- Web vitest: **255/255 PASS** (38 files; integration-2's 242 +
  Phase 3's 13).
- API tsc: 0 errors · Web tsc: 0 errors (web tsc requires the
  workspace packages built first — a fresh worktree shows
  `@repo/contracts` module errors until `pnpm -r build` runs; that
  was setup order, not a merge defect).
- `pnpm -r build`: exit 0, incl. `next build` — route table shows the
  Phase-3 routes (`/dashboard/pos`, `/dashboard/commerce/affiliates`,
  `/dashboard/commerce/reconciliation`, `/shop/[orgSlug]/account`).
- Prisma validate: OK.

## Release + push

- Deploy clone (`~/workspace/github-ai-marketing-saas`, main @
  3e24bc1, clean): tree-synced via `git read-tree --reset -u
  integration-3`, committed as ONE squash release:
  **`7443135` — "release: E-Commerce Phase 3 (EC25-EC34) integrated
  on EC Phase-2 x Connect Center line"** (320 files changed,
  +57,009/−747, **zero file deletions** vs live main).
- Tree identity verified BEFORE push: `git diff HEAD integration-3`
  empty — the release commit's tree is byte-identical to the gated
  integration-3 tree.
- Push: `3e24bc1..7443135 main -> main` (fast-forward, no force).
  Post-push `git ls-remote origin`: **main =
  7443135f0f94d05303673da818bac608107e8b3f** ✔.

## What remains owner-owed (the push does NOT do these)

1. Manual **Dokploy Redeploy** of the new main.
2. Run the **26 pending migrations** on the real DB at deploy
   (`migrate deploy`): the live DB is at the 129-migration state of
   the 3e24bc1 deploy; this release's tree has 155. The 26:
   EC Phase-2 ×12 (20261013190000_ec13 … 20261013300000_cp),
   Connect Center ×4 (cc2_multi_account, cc3_tenant_app_config,
   cc9_tenant_payment, cc10_platform_wallet), EC Phase-3 ×10
   (20261013510000_ec25 … 20261013600000_ec34). Proven 155/155 on a
   FRESH database only — never yet run against the real production
   DB, which carries existing data.
3. Enable the per-org jobs the new features need (in addition to the
   earlier ones, incl. `sync_outbox_process`): `commerce_subscription_sweep`
   (EC24c), `wishlist_price_alert_sweep` (EC28),
   `installment_due_sweep` (EC31), plus the Phase-2/CC job templates
   from their package docs.
4. **EC25 storefront OTP login depends on the org's real SMS
   config** — with no SMS sender configured the request-otp endpoint
   honestly returns 400 (no pretend send); same for EC28/EC31
   customer notifications (`failed_no_channel`).
5. Connect Center go-live items from its package docs (platform
   gateway credentials + wallet fee config + IPN URLs in admin).
6. **EC12 + M30 live verification still entirely open** — no EC/CC
   feature in this release is live-proven with real Woo/Shopify/
   Meta/courier/payment accounts; CP2/CP3-health/CP4 remain
   LIVE-PENDING. SU package and CC Advanced integrate in a later
   release.
