# Milestone 47 Acceptance — AI Assistant Write Actions with Approval

- [x] Schema: `AIActionProposal` model + migration
      `20261010470000_m47_ai_action_proposals` (the parallel Inbox U5
      track independently used the same timestamp prefix for its own
      migration folder; both applied cleanly — Prisma orders by full
      folder name). Schema model count unchanged in spirit: proposals
      are a new table; prisma generate run before rebuild/restart.
- [x] Lifecycle: proposed → approved → executed | failed, or
      proposed → rejected. The decision claim is an atomic
      `updateMany` on status="proposed", so a proposal can never be
      decided/executed twice.
- [x] Action type 1 — pause_campaign: approval calls the EXISTING
      `CampaignsService.setMetaStatus(..., "PAUSED")`, which only
      changes local state after Meta confirms. Proposal-time
      validation requires a published plan with an external campaign
      id.
- [x] Action type 2 — pause_ad_set: approval calls the EXISTING
      `CampaignsService.setAdSetStatus(..., "PAUSED")` (Meta-confirmed
      object status call). Validation requires a published plan and a
      Meta ad set id.
- [x] Action type 3 — create_broadcast_draft: approval calls
      `MessagingService.createBroadcast`, which creates status=draft
      rows only. The result is verified to actually be "draft"
      before the proposal may record executed. There is deliberately
      NO send path in this milestone.
- [x] Action type (c) from the brief — "apply a recommendation's
      linked action" — NOT shipped, honestly: `AIRecommendation`
      carries no machine-actionable link (title/detail/priority and
      an unstructured evidence JSON only), so there is nothing clean
      to execute. Proposals may carry a `recommendationId` for
      traceability when created against one of the two real action
      types above.
- [x] Proposing executes NOTHING (unit-proven: executor stubs see
      zero calls until approve; live-proven: plan metaStatus stayed
      ACTIVE after propose and after chat-created proposal).
- [x] Chat proposals: deterministic detection — a pause request
      (BN+EN keywords) that names a real published campaign plan or
      ad set (exact name match) creates a proposal returned in the
      chat response; unnamed or non-pause messages create nothing.
      Detection failure never breaks the chat answer (optional dep,
      errors swallowed to null). Real-LLM conversations use the same
      server-side propose() validation; the LLM cannot invent a
      target because only stored-row name matches can fire.
- [x] Audit: AIAction rows (proposal.<type> on create,
      execute.<type> success/error on decision) + AuditService
      entries ai.proposal_created / _approved / _rejected /
      _executed / _failed.
- [x] API: GET ai/proposals/targets (published plans + ad sets),
      GET ai/proposals, POST ai/proposals, POST
      ai/proposals/:id/approve and /reject (RolesGuard
      OWNER/ADMIN/MARKETING_MANAGER). Every proposal stores an exact
      Bengali preview of what approval will do; the web UI shows it
      and re-shows it in the approve confirm dialog.
- [x] Web: proposals panel on the AI Assistant page — create form
      (pause campaign / pause ad set from real target lists, or a
      broadcast draft form), status chips, error display, approve /
      reject buttons, and a notice when a chat message created a
      proposal. The page header copy no longer claims the assistant
      can do nothing at all; it states proposals need approval.
- [x] Tests: 9 new tests in ai/proposals.spec.ts (validation
      refusal, zero execution at proposal time, dedupe, approve →
      executed via the confirmed path, platform error → FAILED
      verbatim, reject → never executes + cannot then approve,
      broadcast validation + draft-only execution, ad-set path,
      chat detection, 404). Full API suite: 472 pass / 69 suites.
      Full monorepo build green.
- [x] Live-proven on the sandbox (fresh tenants, real HTTP):
      targets listed the fixture published plan + ad set; propose →
      plan untouched; approve of a pause against a FAKE Meta
      campaign id recorded the proposal as FAILED with the executor's
      error ("Ad account no longer exists" — the confirmed path
      refused) and metaStatus stayed ACTIVE; broadcast draft
      proposal → approve → a real Broadcast row with status "draft";
      ad-set proposal → reject → status rejected, nothing executed;
      chat message "M47 Live Campaign ক্যাম্পেইনটা pause করে দাও" →
      a pause_campaign proposal in the response, plan still ACTIVE.

## Honest boundaries
- A REAL successful pause cannot be proven without the owner's real
  Meta ad account: with a fake/unreachable Meta target the proposal
  correctly records FAILED. The executed-success path is proven by
  unit tests against the same CampaignsService methods the live
  dayparting/rules features already use in production code, and the
  broadcast-draft executed path is proven live end-to-end (it needs
  no Meta account).
- The GROUNDED_SYSTEM prompt now describes the proposal mechanism;
  the dev-template composer's older "read-only" footnote text is
  unchanged (still true of its data tools).
- No pixel QA of the proposals panel (build + live API checks only).
