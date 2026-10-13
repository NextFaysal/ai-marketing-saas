# Connect Center B3 (CC5+CC6+CC7) — Acceptance (2026-10-13)

Branch `cc-package`, worktree `~/workspace/ai-marketing-saas-cc`. Local commits
only — NO push. Base: B2 HEAD `04675c8`.

## Commits
- `99c247f` CC7 api: Telegram/Email connects keyed by (org, provider,
  externalAccountId) — Telegram key = bot id from verified getMe; Email key =
  mailbox proven by IMAP login + SMTP verify. Reconnect refreshes the row and
  its sealed credential in place; a second bot/mailbox coexists; audit carries
  `reconnected`; Connect Center disconnect leaves siblings intact. cc7 spec;
  U4 inbox suite green unchanged.
- `e68159a` CC5+CC6+CC7 web: connect forms move into the Connect Center.

## Delivered
- **CC5 (Commerce):** `CommerceConnectPanel` extracted verbatim from the
  integrations page and shared by both pages — the integrations page keeps
  its header/banner and is now a thin wrapper; no behaviour removed. Store
  create, WooCommerce key connect (verify-before-save), Woo 1-click wc-auth,
  Shopify legacy-token and Dev Dashboard client-credentials connects, sync
  actions — all callable from the Connect Center via the SAME APIs.
- **CC6 (Courier):** `CourierConnectPanel` on the existing CourierService
  endpoints (verify-before-save unchanged); Steadfast/Pathao/RedX coexist as
  separate accounts; default courier via the B1 PATCH set-default. Live test
  buttons exist ONLY where a real read endpoint exists (Pathao stores,
  RedX areas) — none was invented for Steadfast; its card shows stored status.
- **CC7 (Channels):** `MessagingConnectPanel` using the exact inbox request
  shapes, including the CC4 appSource choice (platform/own) inline; Telegram
  and Email forms (+ email sync) in the Center; inbox channels tab gains a
  Connect Center banner; `lib/connect-forms` body builders pinned by 9 new
  vitest cases.

## Gates (run 2026-10-13, sequentially, after two builder agents were lost
to daemon restarts — the implementation commits were already landed and the
tree clean; gates were run and verified directly)
- API jest FULL (NODE_OPTIONS=--max-old-space-size=4096): **282/282 suites,
  2727/2727 tests PASS** — including the cx3-debounce test this run.
- Web vitest FULL: **34 files, 224/224 PASS** (215 at B2 + 9 connect-forms).
- tsc api + web: **0 errors**. Prisma validate: **valid** (DATABASE_URL set).
- next build: **green**, `/dashboard/connections` route present.
- Schema/migration: **none in B3** (verified from the diff) — migration
  sequence unchanged at 133.

## Honest limits
- No live-provider proof: no real Woo/Shopify store, courier account, Telegram
  bot or mailbox was connected from this sandbox — M30 live verification
  still owed, unchanged.
- Courier "live test" coverage is exactly what the providers' existing read
  endpoints allow (Pathao/RedX); Steadfast has no wired test by design.
- Connect forms now exist in BOTH the Connect Center and the original pages
  (shared components, same APIs) — nothing was removed from the old pages.
