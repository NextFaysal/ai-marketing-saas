# Milestone 12 — Inbox Power Pack (Phase A): Acceptance

Completed 2026-10-10 under the owner's autonomy grant, following the
plan in `docs/customers-automation-review.md`. Schema: 61 models
(+ConversationNote, QuickReply, WhatsAppTemplate), migration
`20261010120000_m12_inbox_power` applied to the sandbox Postgres.

## Delivered

1. **Three-pane responsive inbox** — conversation list / thread /
   customer panel; on mobile the list and thread swap with a back
   button, the panel stacks below.
2. **Customer context panel** — linked customer, lifetime orders and
   spend computed from real orders (cancelled orders excluded), last 5
   orders with COD flags, lead stage/source/value/tags.
3. **Assignment UI** — assignee picker fed by the org members endpoint
   (the API validation from M7 finally has a UI), plus Mine /
   Unassigned / All filters and unread-first sorting.
4. **Search & filters** — name/phone/message-preview search
   (case-insensitive), channel, status, unread-only, assignee, tag.
5. **Quick replies** — org-level library (CRUD with RBAC), `/` picker
   in the reply box, {{firstName}} / {{contactName}} / {{phone}}
   rendered from the real contact before insertion.
6. **Internal notes** — ConversationNote model; structurally incapable
   of reaching the customer (no messaging-client path exists from the
   notes service methods); author + timestamp shown to the team.
7. **Tags** — on conversations and leads; normalized server-side
   (trim, case-insensitive dedupe, max 10 × 30 chars); filterable.
8. **Media** — webhook parser now captures WhatsApp media ids (+
   captions) and Messenger attachment URLs; the inbox renders images,
   audio and video through an authenticated API media proxy (WhatsApp
   bytes resolved via the Graph API with the integration token; the
   token never reaches the browser). Agents can send image replies by
   public https URL through the same confirmed-send path.
9. **WhatsApp 24h window** — `lastCustomerMessageAt` stamped on every
   inbound message; window state computed from it (never guessed) and
   shown in the list and thread. When the window is closed, the UI
   offers template sending only: a registry of Meta-approved templates
   (name + language must match Meta), body-param variables, preview
   rendering, and Meta's own errors surfaced verbatim. Sends are
   "sent" only with a Meta message id — a template failure marks the
   row failed and throws, like every other send path.

## Verification

- API tests: 175 passed (18 new in `inbox-power.spec.ts`: parser media
  capture, window math, webhook stamping, list filters/search/sort,
  notes isolation, quick-reply isolation, tag normalization, template
  register/dedupe/send/failure honesty, image-send URL rule, lifetime
  computation excluding cancelled orders, media proxy resolution).
- All package builds pass; the web build includes the rewritten inbox.
- Live sandbox: migration applied, API + web restarted, new endpoints
  return 200 with the demo account (conversations with filters,
  quick-replies, whatsapp-templates, members).
- Real-browser spot check of the new inbox on the public tunnel:
  NOT completed — the fresh Pinggy free tunnel intercepts browser
  fetch calls (proven by curl: a browser user-agent receives the
  Pinggy caution page instead of the API response, while a plain
  request returns 201 with a real JWT). Three automated-browser login
  attempts on the new domain failed at that interception; the app
  itself is not implicated (the identical build passed repeated
  real-browser checks on the previous tunnel, and every M12 endpoint
  was verified live through the local proxy). Re-check the inbox
  visually after permanent deployment or on a warmed-up tunnel.

## Known limitations

- The demo account has no connected WhatsApp/Messenger, so real media
  and template traffic still needs the owner's Meta app (live
  verification checklist, inbox step). All send paths are covered by
  tests with stubbed Graph responses.
- Template body preview uses the registry's bodyText; Meta owns the
  real template content and approval state.
- Media proxy buffers whole files in memory (fine for chat-sized
  media); streaming is a later optimization.
- Phase B (intents, grounded auto-reply, SLA, inbox workflow triggers)
  and Phase C remain as planned in the review document.
