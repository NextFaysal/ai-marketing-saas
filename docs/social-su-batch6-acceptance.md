# SU Batch 6 Acceptance — SU12 Closing (Final Gate + Summary + Live Checklist)

**Package:** Social Posts Update (SU1–SU12), Batch 6 of 6 — plan:
`docs/social-posts-update-plan.md` (Batch 6: SU12).
**Branch/worktree:** `su-package` in `~/workspace/ai-marketing-saas-su`
(base Batch 5 HEAD `5157e2c`). **LOCAL COMMITS ONLY — nothing pushed.**

SU12's honest scope, per the plan: live verification (SU0) cannot
be done without the owner's real accounts, so this batch builds
**no new feature code**. It closes the package: the final gate is
re-run on the final tree, the package summary and deploy
checklist are written, and the owner's session-wise
live-verification checklist is prepared — with every box left
**unchecked**, because none of it has been done.

## What was produced

| Doc | Contents |
|---|---|
| `docs/social-update-package-summary.md` | SU1–SU12 (+SU0) status table with batch/commit/migration/evidence per item; the full commit list (25, `21dec09` → `5157e2c`); the 5 SU migrations; the deploy checklist (owner push → integration with the union fresh-PG sequence mandatory → 5 migrations on the real DB → Dokploy Redeploy → the 3 per-org job templates → `API_PUBLIC_URL`); integration watch-outs (automation.service.ts, schema.prisma social section, the four SU5 event-emit sites); standing honest limits |
| `docs/social-live-verification-checklist.md` | Session-wise, ALL boxes unchecked, EC12-checklist style: deploy preconditions, then S1 Meta + FB publish/first comment/story, S2 Instagram, S3 AI (Gemini key, copy/plan/script), S4 TikTok inbox, S5 YouTube + metadata + cover, S6 insights/follower/best-time, S7 tracked link + order association, S8 commerce auto-draft, S9 one full queue/evergreen/follower job cycle, S10 production host (ffmpeg, fonts, S3, large video). Each session states what to bring, what to do, and what counts as pass evidence |
| This acceptance | The SU12 record |

## S3 streaming attempt (tasked check, honest outcome)

The sandbox was inspected for MediaStore S3 configuration:
environment variables and every `.env*` file in the worktree.
**No `MEDIA_S3_*` value exists anywhere in the sandbox** (the
`.env.example` ships the names empty). MediaStore therefore runs
in local mode here, and any "round-trip" performed in this
sandbox would have exercised the local path while wearing an S3
label — so **no S3 round-trip was attempted and none is
claimed**. PP2's S3 streaming path remains code/spec-proven
only. The real round-trip is written into the checklist as S10
(owner sets the `MEDIA_S3_*` env on the production deploy, then
a large-video upload → ranged playback → publish is the first
real proof).

## Gates (coordinator-run on the final tree, 2026-10-13)

- **API jest FULL** (`NODE_OPTIONS=--max-old-space-size=4096`,
  `--runInBand`): **320 suites / 3206 tests, ALL PASS** — no new
  SU specs in this batch (no code changed), and the known
  `cx3-debounce` flake did **not** appear in this final run. (For
  the record: it appeared once during Batch 5's gate run and
  passed standalone 18/18 on identical code; its root cause
  remains an open CX-package item.)
- **Web vitest FULL:** **41 files / 315 tests, ALL PASS**.
- **tsc:** API 0, web 0, admin 0. **Prisma:** validate 🚀 valid.
- **Monorepo build:** `pnpm -r build` green, exit 0 (7/7
  packages).
- **Fresh-Postgres migration sequence:** throwaway PostgreSQL
  **16.15** cluster, `prisma migrate deploy` from this tree —
  **150/150 applied (145 integration-2 base + 5 SU), 0 unfinished
  / rolled back, 199 public tables** (verified in
  `_prisma_migrations`, not just the CLI tail). One environment
  incident, recorded plainly: the first attempt died at a base
  migration (`20261010480000_m48_proactive`) with Postgres'
  "No space left on device" — the sandbox's `/tmp` is a 512 MB
  tmpfs and had filled with old throwaway clusters + the jest
  cache. The cluster was recreated under `/var/tmp` and the
  **full sequence re-ran clean from an empty database**; no
  migration was edited, skipped or marked-resolved anywhere in
  this process.

## What remains owner-gated (the SU0 list, in full)

None of the following was done in this batch, and none of it
can be done from the sandbox:

1. **Every live-verification session (S1–S10)** in
   `docs/social-live-verification-checklist.md`:
   - S1 Meta connect with real `pages_manage_posts` /
     `instagram_content_publish` permissions (+ App Review if
     Meta gates it) and real FB text/photo/video publishes,
     a real first comment, a real FB photo story;
   - S2 real Instagram photo / Reels / carousel publishes;
   - S3 a real Gemini (or org LLM) key through verify-before-save,
     a real AI image, content plan and reel script;
   - S4 a real TikTok app + account inbox upload (direct post
     only if the owner's app passes TikTok's audit);
   - S5 a real Google OAuth client + channel and a real YouTube
     upload with metadata + cover (stays Private-labelled until
     Google app verification);
   - S6 real-post insights, follower snapshots and best-time on
     accumulated real data;
   - S7 a real tracked-link click → real order association;
   - S8 commerce auto-drafts from real product / promotion /
     inventory / review events;
   - S9 one full live cycle of the posting-slot queue, a
     recurring series and the evergreen + follower jobs;
   - S10 production host checks (below).
2. **Production host verification:** `ffmpeg -version` and the
   Noto/Bengali fonts inside the **production** container (the
   sandbox has ffmpeg 8.1.2 and fonts — a different machine
   proves nothing about production), and the S3 large-video
   round-trip once `MEDIA_S3_*` is configured.
3. **Screenshot QA:** the SU build has never been deployed, so
   there is no live app carrying the SU surfaces to screenshot.
   Desktop + mobile QA of the 5-tab Social Posts workspace is a
   post-deploy checklist step (S10), not a completed item.
4. **Push, integration and deploy themselves:** the owner's
   explicit push instruction, the integration pass against the
   then-current main (with the union fresh-PG sequence), the 5
   SU migrations on the real production DB, and the manual
   Dokploy Redeploy — all exactly as listed in the package
   summary's deploy checklist.

## Honest limits of this batch

- This batch changed **no code and no schema**; the final gate
  numbers above therefore describe the Batch 5 tree (`5157e2c`)
  plus documentation.
- The package summary's claim "CODE-COMPLETE" is a claim about
  the code and its boundary specs only. **Not one SU feature is
  live-proven**, and SU12 does not change that by a single item —
  closing SU0 remains the owner's session work, prepared here
  but not performed.
