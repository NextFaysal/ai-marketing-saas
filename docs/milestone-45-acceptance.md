# Milestone 45 Acceptance — AI Assistant Core v2 (UX completeness)

Governing brief: docs/ai-assistant-remaining-brief.md (M45). Local commit
only — NO GitHub push (owner-only trigger rule, 2026-10-10 22:49).

- [x] Schema: `AIConversation.pinnedAt` + migration
      `20261010451000_m45_ai_assistant_core` (one column). `prisma generate`
      run before rebuild/restart. Schema model count unchanged (102).
- [x] Conversation management API (all owner-scoped via the existing
      getConversation check — another user/org gets 404):
      - `PATCH /organizations/:id/ai/chat/conversations/:cid` — rename
        (trimmed, non-empty, ≤120 chars) and/or pin/unpin
        (`pinned: boolean`, stored as `pinnedAt` timestamp/null).
        Empty patch → 400. `pinned` is validated with `@IsBoolean()`.
      - `DELETE .../conversations/:cid` — deletes messages first, then
        the conversation (the DB relation also cascades).
      - `GET .../conversations?search=` — matches title OR any message
        content, filtered over the owner's own conversations only.
      - List order: pinned first, then most recently updated (cap 30).
      - `GET .../conversations/:cid/export?format=json|markdown` —
        returns `{filename, contentType, content}` built only from the
        stored rows; Markdown includes role headings and the tool-call
        transparency line; JSON includes pinned state + timestamps.
- [x] Follow-up suggestions: `apps/api/src/ai/suggestions.ts` —
      deterministic, derived from the tools that ACTUALLY ran for the
      last answer (successes only), BN + EN, deduplicated, capped at 3,
      generic set as top-up. Returned as `suggestions` on the
      sendMessage response. Every Bengali suggestion is covered by a
      test proving it maps back to a real read-only tool through the
      keyword planner (no dead-end suggestions). Real-LLM refinement
      was NOT added — the deterministic path is the shipped behaviour,
      exactly as the brief allows ("must work and be tested on its own").
- [x] No streaming was added: provider token streaming stays deferred
      per the brief; nothing is labelled as streaming.
- [x] Web UI (apps/web/src/app/dashboard/ai): search box (debounced,
      server-side), per-conversation pin/unpin, rename (prompt),
      export MD/JSON (browser download from the API content), delete
      (with confirm), follow-up chips under the latest answer (clicking
      sends), mobile conversation picker (the sidebar is desktop-only),
      📌 marker on pinned chats.
- [x] Tests: new `suggestions.spec.ts` (4) + M45 block in
      `chat.service.spec.ts` (pin ordering, rename validation, search
      by title/content/owner isolation, delete, export JSON+MD,
      suggestions on send). AI suites: 31 pass. Full API suite run at
      M45 close: all `src/ai` suites green; the only failures seen
      during the run were in the CONCURRENT Unified Inbox U3 track's
      in-progress spec files (their working tree, fixed by that track
      during this session — order-bot re-verified green standalone).
- [x] Builds: full monorepo `pnpm -r build` green.
- [x] Live sandbox check (fresh tenant, real HTTP): register → create
      org → create conversation → Bengali sales question answered by
      the dev-template provider with `suggestions` present → pin
      (pinnedAt set, lists first) → rename → search hit by message
      content AND by title → export Markdown (assistant section +
      filename) and JSON (parses, messages present) → delete (gone
      from list). Migration verified applied in the sandbox DB
      (`pinnedAt` column present).
- [ ] Real-LLM behaviour remains unverified — needs the owner's LLM
      key (M30 Session 5), unchanged from M6.

## Notes
- This batch ran concurrently with the Unified Inbox U3 track in the
  same working tree. Only M45 files were staged for this commit; the
  schema.prisma commit contains ONLY the AIConversation.pinnedAt hunk
  (staged via a handcrafted patch applied to the index), leaving the
  U3 hunks uncommitted for their own track.
