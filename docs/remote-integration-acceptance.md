# Remote Integration Acceptance — owner's GitHub series (fa52681) × local master (94429af)

Date: 2026-10-13 (+06). Branch: `integration` (worktree `~/workspace/ai-marketing-saas-int`).
Owner instruction: integrate without dropping features; where two
implementations exist, keep the better one. NOT pushed — the push
waits for the remaining running packages (IN/EC/MS) per the owner's
conditional push authorization of 2026-10-13 02:19 +06.

## What was merged

Remote main `fa52681` = release `ebe1b28` + 8 owner commits: inbox
redesign ×4 (3-column AiPraktor-style, mobile bottom nav, new-chat
modal, WebAudio chimes), owner's own CX Batch 4 + CX Batch 5, a
syntax fix, and a guard/permission alignment fix. 29 files,
+3,985/−1,201. Merge commit `b3b2dbd`; fallout fixes `2797ddb` and
the CX10 decision commit.

## Conflict resolution (30 files)

- **Ours wholesale (16)** — remote untouched since the squash
  release: all `ai/*`, `ai-rich`, `ai-stream`, AI page, automation
  module, courier service, automations/customers pages, cx6 doc.
- **Clean auto-merge (15 of his files)** — practice-mode.*,
  packing-scan.*, cx-batch4/5 specs, inbox-avatar, knowledge.dto,
  inbox.controller, both CX migrations, his acceptance docs.
- **Union (schema)** — PackingScanLog model + KnowledgeDocument
  chunk fields + his chase fields (`maxChaseAttempts`,
  `chaseMessage`) kept alongside ours; prisma validate OK. His
  migrations `20261012140000/150000` do not collide with the AI
  series (`20261012200000`+).
- **Inbox page** — his redesign is the base; ported back from ours:
  smart-folder chips (সব/আমার/অনির্ধারিত/SLA/VIP + 🤝 Handover +
  😴 Snoozed, server counts), snooze menu + unsnooze, Take over /
  Back to AI, timed-assignment Timer menu, handover row chips
  (reason + waiting minutes), folder empty states, and the settings
  sections he lacked (AI reply delay + per-channel delay, channel
  AI schedule, Review Request, To Chase). Web tsc clean.
- **Duplicate routes disambiguated** — knowledge upload: multipart
  stays at `knowledge-documents/upload`, his JSON ingest at
  `knowledge-documents/ingest`; messaging preview: ours at
  `broadcasts/preview`, his at `broadcasts/preview-audience`
  (`PreviewAudienceDto extends PreviewBroadcastDto`).
- **Chase ×2** — both sweeps registered (`order_chase_sweep` ours,
  settings-rich; `inbox_chase_sweep` his, inbox-native) with both
  setting field sets in schema/DTO/service.
- **Transcription unified** — the auto path now delegates to the
  public `transcribeMessage` over the shared `ensureTranscription`
  core; both CX12c suites + his cx-batch4 pass.
- **CX10 follow-up defaults — decision** — his unconditional static
  day map vs ours' per-org settings (hours, validated, tenant
  isolation). Ours wins (configurable + opt-in discipline);
  `DEFAULT_STAGE_FOLLOWUP_DAYS` remains exported as suggested
  defaults. His two spec tests were adapted to seed the same
  intervals (24h/120h) via `updateFollowUpSetting`.
- **Messaging exclusions** — the shared resolver now applies BOTH
  previous-recipient exclusion (ours) and opt-out + recent-days
  exclusion (his) at preview and send.

## Gates (integrated tree)

- Prisma validate: OK
- API tsc: clean · Web tsc: clean
- Web vitest: 144/144 (21 files)
- Web `next build`: green (all routes incl. /dashboard/inbox, /dashboard/ai)
- API jest full: **1938/1938, 218/218 suites** (final clean run,
  uncontended, 74s). Note: earlier full runs executed concurrently
  with other heavy jobs showed rotating timing-flake failures
  (11–57 across runs, incl. the known cx3-debounce flake); every
  affected suite passes in isolation, and the final uncontended
  full run is completely green.

## Honest limits

- No live visual QA (sandbox has no running app) — the ported inbox
  UI is verified by typecheck + build + static review only.
- Both chase sweeps read the same `chaseEnabled` opt-in; enabling
  both job templates for one org could double-nudge — each honors
  its own interval/attempt settings. Documented, not silently
  merged, because the two engines serve different session models.
- His inbox redesign had dropped the folder-chip UI entry points
  (plumbing remained); the port restores them as chips, styled to
  the redesign.
- Integration with the IN branch (in-package) and EC/MS branches
  is still outstanding — those land on top of this branch (or
  master) before the release push, per the owner's sequencing.
