# Live Verification Runbook (DRAFT - for the user's own machine)

Prepared 2026-10-10. Every milestone (1-9) is build- and test-verified
in the sandbox, but exactly 9 acceptance items remain unchecked, and
all of them need the user's own environment or credentials. They form
one dependency chain, so they can be closed in a single sitting in
this order instead of hunting through 9 separate checklists.

## Step 1 - Live Postgres (closes M1 + M2 open items)
From `docs/milestone-1-acceptance.md` / README quick start, on a
machine with Docker:
`docker compose up -d` -> `pnpm install` -> `pnpm db:generate` ->
`prisma migrate deploy` -> `pnpm db:seed`
Dev login: owner@demo.local / ChangeMe123!
Closes: milestone-1-acceptance.md:17, milestone-2-acceptance.md:28.

## Step 2 - Real WooCommerce store (closes M3, unlocks M4)
Connect a real store from Stores & Integrations (key creation steps
are in the UI), run a manual sync, confirm products/orders appear.
Follow the 5-step script in `docs/milestone-3-acceptance.md`.
Closes: milestone-3-acceptance.md:43.
Then install the tracker.js snippet from the Attribution page on the
same store and place a test order to see touchpoint + attribution.
Closes: milestone-4-acceptance.md:41.

## Step 3 - One Meta app + token (closes M5, M7, M8; unblocks M9)
A single Meta app serves four milestones:
- M5: token for Meta ads insights sync (milestone-5-acceptance.md:43)
- M7: WhatsApp/Messenger connect + webhook verify + test message
  (milestone-7-acceptance.md:51)
- M8: Ad Library token - note Meta may require identity confirmation
  for the Facebook user depending on country
  (milestone-8-acceptance.md:50)
- M9: live publishing additionally needs Marketing API /
  ads_management (Advanced Access / App Review for accounts the app
  user does not own) - milestone-9-acceptance.md:50. This is the only
  step that may take days because of Meta review; submit it first if
  publishing matters soonest, then do Steps 1-2 while waiting.

## Step 4 - One LLM API key (closes M6)
Pick one provider (OpenAI / Anthropic / Gemini), set LLM_PROVIDER +
LLM_API_KEY + LLM_MODEL in .env, generate one report and one chat
reply, and confirm the UI badge switches from dev-template to the
real provider. Closes: milestone-6-acceptance.md:53.

## Notes
- Nothing here can be done from the sandbox: no Docker/Postgres, and
  the store/Meta/LLM credentials are the user's alone. Do not paste
  secrets into chat; put them in the local .env / connect forms.
- If any step fails, the failing step's acceptance doc names the
  exact expected behavior, which makes the error report actionable.
