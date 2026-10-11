# AI Assistant — Full Plan: Basics → Advanced (Features + Design)

Owner instruction 2026-10-12 02:08 +06: "AI Assistant-এর জন্য একটা details
প্ল্যান করো — full basics to advance features list, with design,
everything."

This plan builds on what already exists (audited below). It does **not**
re-plan delivered work. The Assistant's job in one line: **ask anything
about the business in Bangla/English → get a grounded answer → turn it
into a drafted action → approve → it executes through the platform's own
confirmed paths → and it watches the business proactively.**

## 0. Current state (code-verified 2026-10-12 — EXISTS, do not rebuild)

- Chat (`/dashboard/ai`): private per-user conversations, pin / rename /
  delete / search / export (JSON+MD), deterministic follow-up suggestions
  (BN+EN), Markdown answers, tool-transparency footer, provider badge.
- **13 grounded read-only tools** via provider-agnostic planner +
  `sanitizePlan` (unknown tools dropped, args whitelisted, max 3 calls,
  prompt-injection tested): analytics overview, campaign performance,
  attribution, product list, orders needing attention, anomalies,
  business knowledge, customer segments, inventory health, courier
  performance, product profit, period comparison, competitor
  intelligence (M77 brain tool).
- Reports: daily/weekly/monthly, period-vs-previous, missing-data section
  always present, causes labelled Hypothesis; scheduled `daily_report`.
- Recommendations with Done/Dismiss; deterministic anomaly detection
  (spend spike, revenue drop, CPA spike, spend-with-no-sales; sample
  guard reports "insufficient data" instead of guessing).
- **Write actions with approval (M47):** `AIActionProposal` lifecycle
  proposed → approved → executed/failed (atomic claim, never twice);
  campaign pause, ad-set pause, broadcast **draft** creation — execution
  only through existing confirmed services; full audit.
- **Proactive (M48):** daily briefing + critical-anomaly alerts as
  in-app notifications from real rows only, per-org settings, dedupe.
- Platform: OpenAI / Anthropic / Gemini providers via Admin Dynamic
  Config (no restart), labelled Dev Template mode when no key
  (`isRealLlm=false` everywhere it matters), per-org kill switch, daily
  caps, `AIUsageRecord` token accounting, Gemini **live-verified** (M46).
- Sibling AI surfaces that must stay consistent with this plan (not part
  of it): Inbox autopilot + copilot (ghost text, tone, AI Draft), AI
  Instructions Desk (CX2), Creative Studio, comment AI, competitor
  counter-ads, AI image provider (`ai/images`, Gemini).

Deliberately deferred in the M45–M48 program and picked up here:
native streaming, voice questions, in-answer charts, knowledge file
upload + citations.

## 1. Design (applies to every phase)

### 1.1 Surfaces
1. **AI page v2** (`/dashboard/ai`) — the command center (below).
2. **Global assistant** — a floating sparkle button + `Cmd/Ctrl+J`
   panel available on *every* dashboard page: same conversation,
   page-aware context ("ask about this page" — the panel knows which
   module you are on and pre-scopes its tools). Slide-over on desktop,
   full-screen sheet on mobile.
3. **Inline copilots stay where they are** (inbox etc.) but share the
   same brand primitives, provider/dev-mode badge, and draft labelling
   as the Assistant, so the whole product feels like one AI.

### 1.2 AI page layout (Design v2 system, brand tokens throughout)
- **3-zone workspace** (collapsible, resizable like Inbox):
  left = conversation rail (search, pinned first, date groups);
  center = chat canvas; right = **context panel**: active proposals
  queue, today's briefing card, usage/cap meter, quick tools.
  Mobile: single column, rail and panel become bottom-sheet tabs.
- **Chat canvas:** streaming token render with a typing caret; message
  bubbles in the Inbox v2 language; **tool-call transparency cards**
  (which tool ran, on what data, how long — collapsible, replaces the
  current text footer); **rich answers**: inline mini charts (bar/line
  from tool data), tables, stat tiles — never a wall of text when the
  data has shape; copy / export / "turn into action" per answer.
- **Proposal cards inline in chat**: an action the AI suggests appears
  as a card with exact Bengali preview, target, and Approve / Reject —
  the M47 lifecycle, surfaced in the conversation where it was born
  (the AI page form stays as the manual path).
- **Composer v2:** floating shell like Inbox v2 — attach file, voice
  mic button, prompt-library picker (`/` shortcuts), suggestion chips
  above it (context-aware, from tools actually usable), char/cap hint.
- **States:** skeleton while tools run (per-tool shimmer rows), honest
  empty states ("এই সময়ে ডেটা নেই"), dev-mode banner when
  `isRealLlm=false`, reduced-motion respected, touch targets ≥40px,
  Hind Siliguri Bengali rendering (already shipped in UX1).
- **Trust furniture on every surface:** provider badge, grounded-data
  note ("উত্তরটি আপনার স্টোরের আসল ডেটা থেকে"), estimate labels on
  anything predictive, draft labels on anything generative.

### 1.3 Personality & language
- Answers in the user's language; Bengali in Bengali script by default.
- Per-org assistant identity (name + tone) read from Business Profile /
  AI Instructions — white-label tenants get *their* assistant, not ours.
- No invented numbers, ever (standing rule). Missing data is said
  plainly; estimates carry method + range, never fake precision.

## 2. Feature roadmap — Basics → Advanced

### Tier A — Basics, perfected (gaps in what exists)
A1. **Streaming responses** (SSE): token-by-token render, stop button,
    tool steps shown live; planner + sanitizePlan unchanged.
A2. **In-answer charts & tables** from tool results (renderer maps tool
    output → chart/table/stat components; LLM never draws numbers).
A3. **Conversation intelligence:** auto-titles, topic tags, "continue
    where I left off" recap card, search inside one conversation.
A4. **Prompt library:** org-saved prompts + product-shipped starter
    pack (BN+EN: "গত সপ্তাহের লাভ?", "কোন প্রোডাক্ট থামানো উচিত?"…),
    `/`-picker in composer, per-role visibility.
A5. **Share & hand-off:** share a conversation (read-only link inside
    the org), assign an answer/proposal to a team member.

### Tier B — Knowledge & input depth
B1. **Chat file upload:** CSV / PDF / image dropped into chat → parsed,
    summarized, and usable as *cited* context for that conversation
    (files are data, never instructions — existing grounding rule).
B2. **Knowledge Base completion:** file ingestion into the org
    Knowledge Base (align with the CX/AG knowledge-files work — one
    pipeline, not two), answers cite the exact document + section.
B3. **Voice questions:** mic → speech-to-text (BN+EN) → same pipeline;
    optional spoken answer (TTS) with a mute-first default.
B4. **Image questions:** send a product photo / ad screenshot → vision
    analysis grounded in the catalog (which product is this, what does
    the competitor ad say) — connects the existing image provider and
    the AG10 image-recognition direction; output labelled as analysis
    of *that* image only.
B5. **Long-term org memory:** the assistant remembers org-level facts
    the owner confirms ("আমাদের ডেলিভারি চার্জ ৬০ টাকা") in a visible,
    editable Memory panel — never silent learning, every entry
    owner-approved and deletable.

### Tier C — Every module becomes a tool (analysis depth)
C1. **Tool registry:** each domain module registers its read tools in
    one registry (name, args schema, RBAC, cost class) — new modules
    plug in without touching the planner. `sanitizePlan` stays the
    single security boundary; per-tool RBAC (an ANALYST can't pull
    finance tools).
C2. **New read tools:** orders detail & customer 360, leads/CRM
    pipeline health, inbox performance (response time, AI resolution,
    unanswered themes — from CX2's `AiUnansweredQuestion`), social
    post performance, ad-account health & spend watchdog state,
    billing/usage, team performance (M70 scorecard inputs), automation
    run health (A3 dead-letters), courier live status rollup.
C3. **Multi-step tasks:** planner may chain up to N tools for one
    question ("কেন Eid campaign লাভজনক হয়নি?") with the step list
    shown before/while running; still read-only.
C4. **Forecasting (labelled estimates):** revenue trend, stock-out
    date, courier success trend — deterministic models first (moving
    average / linear), method + confidence band shown, sample guard
    refuses thin data. LLM explains; it never computes.
C5. **Scenario answers:** "বাজেট ২০% বাড়ালে?" — computed from real
    CPA/ROAS ranges in the data, presented as a range with assumptions
    listed, never a promise.

### Tier D — Actions, with approval (extends M47)
D1. **More proposal types** (each only via its existing confirmed
    service path, preview + diff before approval):
    campaign/ad-set resume & budget change, campaign **draft**
    creation from a brief, product price/stock edit, discount/coupon
    creation, broadcast draft + schedule, social post draft + schedule,
    automation job creation, lead follow-up task creation, inbox
    quick-reply/template draft.
D2. **Bulk proposals:** one approval covers a listed set (e.g. pause 5
    bleeding ad sets) with per-item results reported verbatim —
    partial failure is shown per item, never averaged away.
D3. **Dry-run diffs:** every proposal shows before → after values from
    live reads at approval time (stale preview = re-confirm).
D4. **Undo where the platform allows** (resume a paused campaign,
    delete a draft) as a first-class proposal type; where undo is
    impossible the card says so before approval.
D5. **Autonomy levels (OWNER DECISION):** per org — (0) suggest-only,
    (1) approve-everything (today), (2) auto-execute low-risk classes
    under hard caps (e.g. draft creation only; never sends, never
    spends) with instant audit + daily digest. Default stays (1).

### Tier E — Proactive & agentic (extends M48)
E1. **Morning brief everywhere:** in-app + Telegram (existing alert
    dispatcher pattern); WhatsApp only via the approved channel when
    it exists — no new unofficial channel.
E2. **Opportunity radar:** daily scan joining real signals — own
    low stock + rising demand, competitor stock-out (from *real*
    observations only, post-Honesty-Fix), trending own products,
    courier deterioration — each as a briefing item with a one-tap
    draft action attached.
E3. **Goal pacing:** owner sets a monthly revenue/order target; the
    assistant reports pace ("মাসের ৪০% সময়ে লক্ষ্যের ৩২%") in the
    briefing and suggests grounded corrections.
E4. **Task inbox:** proposals, unanswered-question themes, and
    briefing action items live in one Assistant Task Inbox with
    states (new / approved / done / dismissed) — the assistant's
    work queue, visible to OWNER/ADMIN.
E5. **Scheduled custom reports:** "প্রতি শুক্রবার সেরা ১০ প্রোডাক্ট"
    — owner-defined prompt + schedule, delivered like the briefing,
    built only from tools.

### Tier F — Frontier (later, individually gated)
F1. **Specialist personas:** Ads Analyst / Inbox Coach / Finance
    Analyst modes — same tools, different system framing + default
    tool sets; selectable in the composer.
F2. **Voice-first mode:** hands-free conversation loop for the owner
    (driving/at the shop), with on-screen transcript.
F3. **Assistant API:** org-scoped API + webhook so the assistant can
    answer inside the tenant's own tools (same RBAC, caps, audit).
F4. **Cross-surface actions:** approve proposals from Telegram
    (signed one-time links, same atomic claim) — only after a
    security review; in-app approval stays the default.

## 3. Architecture notes
- **Transport:** SSE endpoint beside the existing chat POST; the
  non-streaming path stays for API consumers and tests.
- **Tool registry** (`ai/tools/registry.ts`): tools self-describe;
  planner prompt is generated from the registry; `sanitizePlan`
  validates against it — one source of truth for tools/RBAC/cost.
- **Rendering protocol:** tools return `{ data, display }` hints
  (chart/table/stat) so the web renders rich answers deterministically
  without the LLM inventing layout or numbers.
- **Memory layers:** conversation history (exists) · confirmed org
  memory (B5, new table, owner-approved writes only) · document
  context (B1/B2, cited chunks). Nothing else is "remembered".
- **Cost & safety (unchanged discipline):** kill switch, daily caps,
  per-feature usage records, provider errors verbatim, dev-template
  labelled, every action audited (`AIAction` + audit log), proposals
  execute only through domain services' confirmed paths.
- **Schema expected:** org memory table (B5), prompt library (A4 —
  may fit existing models; verify), task inbox (E4 — likely extends
  `AIActionProposal` + notifications; verify before proposing a new
  model). Each phase confirms its own schema in its brief.

## 4. Phasing (packages, sequential, local commits, no push)
- **AP1 — Experience:** A1 streaming + A2 rich answers + page v2
  design (§1.2) + A3 conversation intelligence. *(Pure assistant
  surface; no other track collision expected.)*
- **AP2 — Input & Knowledge:** B1 file upload + B2 knowledge citations
  (coordinate with CX/AG knowledge-files work — land after it, reuse
  its pipeline) + A4 prompt library + A5 share/hand-off.
- **AP3 — Tool Universe:** C1 registry + C2 new read tools + C3
  multi-step + B5 org memory.
- **AP4 — Estimates:** C4 forecasting + C5 scenarios (deterministic
  models, labelled) — small, honesty-critical package.
- **AP5 — Actions++:** D1–D4 proposal expansion + global assistant
  surface (§1.1.2). D5 autonomy ships only if the owner decides it.
- **AP6 — Proactive++:** E1–E5 (brief channels, radar, goal pacing,
  task inbox, scheduled custom reports).
- **AP7 — Frontier (optional, per-item owner go-ahead):** F1–F4,
  B3 voice, B4 image questions (voice/image may move earlier if the
  owner prioritises them).

Each package: audit-first brief → build → tests (planner/injection
suite must stay green throughout) → acceptance doc with honest limits
→ local commit. Live LLM verification follows the M46 pattern (owner's
real key via Admin Dynamic Config) and is claimed only when run.

## 5. Owner-decision items (not assumed)
1. D5 autonomy level 2 (any auto-execution at all).
2. Voice provider (B3/F2) — cost per minute vs. value; BN STT quality
   varies by provider.
3. E1 WhatsApp briefing channel — only via an approved official path.
4. F4 approving from Telegram — security review first.
5. Assistant naming/persona per tenant (B/§1.3) — product call on how
   far white-labelling goes.
