# Final Integration Acceptance — Remote + AI Assistant + EC + MS + IN (2026-10-13)

Owner instruction 2026-10-13 09:14 +06: "শুরু করো — final integration + check +
push" (with the standing conditions: check all code thoroughly, remove
conflicts first, keep all features, keep the better implementation where
two exist).

## What was integrated

Onto the `integration` branch, in order:

1. `b3b2dbd` — owner's remote `fa52681` series (inbox redesign ×4, CX
   Batch 4 + 5, PackingScanLog, knowledge chunks, guard/build fix) merged
   into local master `94429af` (AI Assistant program AP1–AP7 complete).
2. `09b4d4a` — **EC package** (ec-package, EC1–EC12, 32 commits).
3. `9dfe61b` — **MS package** (ms-package, MS1–MS10, 33 commits).
4. `aa33ada` — **IN package** (in-package, IN1–IN10 + Demo Chat Pack,
   18 commits).
5. MS7 constructor-slot fix (below).

Final tree vs remote `fa52681`: **417 files changed, +69,464 / −1,080**
(pre-doc). 130 migrations total in the tree.

## Conflict decisions (best-code rule)

- **EC**: all unions — EC commerce modules join the assistant's module
  graph; `proposals.service.approve()` carries a union options type
  (`{autonomous?: boolean} | string`) so AP7's autonomous path and
  EC11's role floor both work through the one approve flow.
- **MS**: the MS messaging core wins for broadcast architecture; the
  owner's CX10 audience exclusions were plumbed INTO
  `resolveBroadcastRecipients` as Stage 1b (past-days delivery history)
  and Stage 1c (opt-out suppression via the real `unsubscribed`
  columns) instead of being dropped. `previewAudience` (dropped by a
  merge hunk) was restored and rewired through the same resolver.
- **IN / inbox**: the owner's CX inbox (chase sweep, CX marks) and IN
  (SLA chain, identity merge, delivery lifecycle) run side by side.
  Delivery-status handling synthesises MS7's broadcast fallback with
  IN6a's monotonic inbox lifecycle + read watermark. The web inbox page
  keeps the owner's redesign (command bar, channel pills, ContactAvatar)
  with IN's bubble/composer/search/SLA/analytics features spliced in;
  canonical helpers live in `@/lib/inbox-format` + `@/components/inbox-extras`.
- **Constructor slot collision (real integration bug)**: IN2 and MS7
  both appended an optional collaborator at positional slot 11 of
  `InboxService`. Merged order: `customers` @11, `messagingPrefs` @12.
  Production Nest DI resolves by type (unaffected); the MS7 spec's
  positional construction was adjusted with an explanatory comment —
  the same treatment IN2's spec would have needed in the other order.

## Final gate (integrated tree, this branch)

- API jest (serial, full): **272/272 suites, 2625/2625 tests PASS**
- Web vitest: **209/209 PASS**
- API tsc: 0 errors · Web tsc: 0 errors
- Prisma schema: valid · `next build`: green

Notes on the road here: two earlier full-run anomalies were environment
artefacts — one parallel run OOM-aborted a worker (serial rerun clean)
and one summary named spec files that do not exist in this tree
(disregarded; the serial run is authoritative). The known cx3-debounce
timing flake passed in the final serial run.

## Deploy checklist for the owner (nothing here is done by the push)

1. Manual **Dokploy Redeploy** after the push lands.
2. Run **all pending migrations** on the real DB (none have ever run):
   AI ×4, owner CX ×2, IN ×7, EC ×11, MS ×9 — 33 folders.
3. `scripts/cleanup-fabricated-competitor-ads.ts` on the live DB.
4. Set `ASSISTANT_LINK_SECRET` (or confirm `INTERNAL_JOB_SECRET`) so
   AP7 signed approval links work.
5. M30 live verification with real accounts (Meta/LLM/Woo/Shopify/
   courier) — the EC/MS/IN live checklists in their package docs.
