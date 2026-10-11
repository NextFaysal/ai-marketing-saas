# Real-LLM Live Verification — Gemini (M30 Session 5, code-side evidence)

Date: 2026-10-10. Local verification note only — NO GitHub push.
The API key used was provided by the owner for TEST USE ONLY. It was
held exclusively in the sandbox API process environment
(LLM_PROVIDER / LLM_API_KEY / LLM_MODEL process env) for the duration
of the test and was never written to the repo, any file, the database
(no admin llmConfig was set), a commit, or any log. After the test the
key-bearing process was terminated; production configuration remains
the admin's job via Admin Console -> Dynamic Platform Config.

## Fix that came out of this verification
- GeminiProvider default model changed `gemini-1.5-flash` ->
  `gemini-flash-latest`: dated model ids return 404 "no longer
  available to new users" on a fresh key even though ListModels still
  lists them (verified by the owner against Google directly). The
  alias is the target Google itself points to; the model stays
  overridable in Dynamic Platform Config. Covered by a providers spec
  (default alias in the request URL, explicit model wins, key header).

## Configuration used (sandbox only)
- provider = gemini, model = gemini-3.8-flash (explicit), via process env.
- Sandbox DB check beforehand: no admin `llmConfig` SystemSetting row,
  so env was the effective source.

## App-level evidence (through the app, not direct Google calls)
Fresh tenant + one seeded order (250000 minor = BDT 2,500.00, placed
2 days earlier) in the sandbox DB:

1. **AI chat — real LLM + real tool + grounded answer**
   - Question (Bengali): "গত ৭ দিনে বিক্রি কেমন ছিল?"
   - Response: `provider: "gemini"`, `isRealLlm: true`,
     toolCalls: `get_analytics_overview` (executed, logged).
   - Answer (Bengali, Bengali digits): ১টি অর্ডার, Revenue
     BDT ২,৫০০.০০, AOV BDT ২,৫০০.০০, Ad Spend BDT ০.০০,
     Contribution Profit BDT ২,৫০০.০০ — exactly the seeded data.
2. **Daily report generation**
   - `POST /ai/reports/generate` (daily, bn) returned 201 with
     `provider: "gemini"` recorded on the report; Bengali title and
     structured sections. The report honestly states no orders on its
     anchor day (the seeded order was 2 days old) — correct behaviour.
3. **Token usage rows (AIUsageRecord, estimated = false for both)**
   - chat:   input 806, output 160
   - report: input 516, output 520
   Real counts from the provider's usage metadata, not estimates.
4. **Admin dynamic-config test endpoint** — NOT run: the demo owner's
   login requires TOTP (requiresTotp=true), and the code is not ours
   to bypass. The chat evidence above satisfies the same requirement
   (the app completing through the real provider).

## Notes / limits
- Thinking models spend ~190-280 thought tokens per small prompt;
  with a tiny maxOutputTokens the visible text can be empty. The
  app's planner (500) and answer (1500) budgets were sufficient here;
  an empty/garbled planner response still falls back to the keyword
  planner by design.
- This closes the CODE-SIDE evidence for M30 Session 5 on the
  sandbox. The owner's production key + model choice still go in via
  the Admin Console on his own server.
- Sandbox incident after verification: /tmp was wiped again and the
  sandbox services stopped (recurring sandbox instability, not an app
  defect); all evidence above was captured before the wipe.
