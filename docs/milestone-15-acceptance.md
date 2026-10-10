# Milestone 15 — Phase D (Revenue Automation): Acceptance

Completed 2026-10-10 on the owner's explicit go-ahead, following
`docs/customers-automation-review-2.md` Phase D. Schema: 63 models
(+BotSession; WorkflowRun wait/resume fields; InboxSetting bot
fields), migration `20261010150000_m15_phase_d` applied.

## Delivered

1. **Workflow engine v2**
   - `wait` steps (1 minute to 30 days): the run persists as
     `waiting` with `resumeAt` + `nextStepIndex`; the existing 5-minute
     tick resumes due runs. Disabled/deleted workflows fail the run
     honestly instead of vanishing.
   - `condition` steps (branch): evaluated against the run context;
     on resume the context is REFRESHED from live data
     (conversationStatus, agentReplied, unreadCount), so "send a
     follow-up only if nobody replied during the wait" actually
     works. A failed condition completes the run without executing
     the rest of the branch.
   - `send_inbox_message` steps: free-form text ({{variables}} from
     context) or a registered WhatsApp template, sent through the
     inbox's confirmed send path (`sendAutomatedMessage`: queued ->
     sent only with a Meta id, rows flagged as automated with a
     source tag, audit-logged). WorkflowsModule now imports
     InboxModule (one-directional, no cycle).
   - Create-time validation for all new step shapes.
2. **Recovery sequences** — delivered as one-click presets in the
   workflow builder (1-hour follow-up with agentReplied branch;
   unanswered escalation with a 24-hour second stage) on top of the
   engine above; every stage is visible in run logs.
3. **Order-taking bot** — per-org settings (enable + optional
   delivery charge in the business's own setting; unset = the bot
   honestly says the team will confirm the charge). A new
   `order_intent` classifier intent starts a BotSession; the bot
   walks product (numbered list from the real catalog) -> quantity ->
   name -> phone (BD format validated, Bengali digits accepted) ->
   address -> summary with server-computed totals -> explicit
   হ্যাঁ/না confirmation -> order created through the SAME chat-order
   pipeline (WooCommerce push + recorded sync outcome included),
   customer created from the collected details, address preserved in
   an internal note. Safety rails: typing "এজেন্ট" hands off with a
   note; ANY human agent reply hands off; an agent can stop the bot
   from the panel; sessions expire after 30 idle minutes; a failed
   bot send hands off with the error noted instead of looping.
   COD/CSAT handling takes precedence over the bot, and spam-flagged
   conversations never start it.
4. **Flow builder (basics)** — the workflow builder gains the new
   steps plus ready-made flow presets. A drag-and-drop visual canvas
   remains future work (stated plainly; the form builder + presets
   cover the planned flows).

## Verification

- API tests: 214 passed (11 new): step validation; wait -> pause ->
  resume -> follow-up sent with {{contactName}} rendered; branch
  suppression when an agent replied during the wait; no early
  resume; the full bot script end-to-end (Bengali-digit quantity,
  summary total = 2 x 1500 + 60 delivery, order + customer created,
  completion message), phone re-ask, agent-word handoff, human-reply
  takeover, decline-creates-nothing, disabled-bot silence, panel stop.
- All package builds pass. Live sandbox: migration applied, servers
  restarted; bot settings PATCH verified (demo org: bot ON, delivery
  6000 minor), workflow create with wait/condition/inbox steps 201,
  invalid wait step refused 400. A demo "Recovery demo" workflow
  exists in the demo org.

## Known limitations

- Bot product list caps at 10 active products (numbered); larger
  catalogs need search-by-name (name matching already works as a
  fallback via matchProduct).
- Bot orders are COD only; prepaid flows stay agent-handled.
- Resume granularity is the 5-minute tick; waits are not
  second-precise (documented behavior, fine for follow-ups).
- The bot speaks Bengali; bilingual scripts are a Phase E/F item.
