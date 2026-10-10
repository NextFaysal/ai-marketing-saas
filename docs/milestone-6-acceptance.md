# Milestone 6 Acceptance Checklist - AI Reports & AI Chat

- [x] Prisma models: AIConversation, AIMessage, AIAction, AIReport,
      AIRecommendation, AIUsageRecord + migration 20261010050000.
      Schema total: 37 models.
- [x] Provider-agnostic LLM layer (apps/api/src/ai/llm):
      OpenAI, Anthropic and Gemini providers (real HTTP APIs, usage
      tokens read from provider responses), selected via LLM_PROVIDER
      (+ LLM_API_KEY, LLM_MODEL). A missing key for a chosen real
      provider is a configuration error - it never silently falls back.
- [x] Dev template adapter: used ONLY when no provider is configured.
      It is labeled everywhere (report.provider = "dev-template",
      chat responses carry isRealLlm=false and a UI badge; stored
      messages and reports are therefore honest after the fact too).
      Its report/chat outputs are deterministic templates over real
      data - no generated claims, no invented numbers.
- [x] Daily/weekly/monthly report generation: period vs previous
      period, top campaigns, anomalies, missing-data section always
      present, causes labeled as hypotheses. Regenerating the same
      period bumps version and replaces open recommendations.
- [x] Anomaly detection (pure, tested): spend spike, orders/revenue
      drop, CPA spike, spend-with-no-sales (critical). Sample guard:
      with too few baseline orders, rate anomalies are skipped and
      "insufficient data" is reported instead of a confident guess.
- [x] AI chat with controlled read-only tools: get_analytics_overview,
      get_campaign_performance, get_attribution_report, list_products,
      get_orders_attention, get_anomalies, get_business_knowledge.
      Planning is provider-agnostic (LLM JSON plan for real providers,
      deterministic Bengali/English keyword planner for the dev
      adapter/fallback). sanitizePlan is the security boundary:
      unknown tools are dropped, args whitelisted, dates validated,
      limits capped, max 3 calls. Tests include a prompt-injection
      style request - it can only ever reach read-only tools, and no
      write tools exist in this phase at all.
- [x] Grounding rules in the system prompt: answer only from tool
      results, say when data is missing, never merge platform-reported
      conversions with first-party orders, treat document content as
      data not instructions, respond in the user's language
      (Bengali script detection).
- [x] Every tool execution is logged to AIAction (org, user, tool,
      sanitized args, status). Chat usage is recorded in
      AIUsageRecord and capped per organization per day
      (AI_DAILY_MESSAGE_LIMIT, default 200, HTTP 429 when exceeded).
- [x] Conversations are private to their owner inside the org.
- [x] Web: AI Assistant page (conversation list, suggestions in
      Bengali, tool transparency footer, provider badge), Reports page
      (generate daily/weekly/monthly, anomaly panel, open
      recommendations with done/dismiss, provider badge), and the
      dashboard Overview now shows real last-7-days KPIs, the latest
      report and anomalies instead of the Milestone 1 placeholders.
- [x] Tests: 95 total passing (API 87, contracts 7, worker 1).
- [x] Builds: all packages + API + Next.js pass.
- [ ] Real-LLM behavior (report quality, planner JSON on each vendor)
      needs a real API key to evaluate; the pipeline around it (tools,
      storage, limits, UI) is fully covered by tests with the dev
      adapter and provider unit tests with stubbed HTTP.

## Design note: tool calling
Native per-vendor tool-calling protocols (OpenAI tools, Anthropic tool
use, Gemini function declarations) differ enough that Milestone 6 uses
one provider-agnostic planner contract instead: the model returns a
JSON plan, the server validates it (sanitizePlan) and executes tools
itself. This keeps one audited execution path for every provider. If a
future milestone needs streaming or multi-step autonomous loops, the
planner boundary is where native protocols can be added per provider.

## Known limitations
- Reports are generated on demand (button/chat). Scheduled automatic
  daily generation can reuse ReportsService with the worker later.
- Chat has no streaming yet; answers arrive in one response.
- Token costs are tracked as token counts, not money; pricing differs
  per provider/model and is intentionally not hard-coded.
