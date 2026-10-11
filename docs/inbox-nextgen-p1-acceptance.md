# Inbox Next-Gen — Priority 1 Acceptance (Fixed Workspace + Composer)

Date: 2026-10-11. Scope: the owner's Priority 1 ("Quick Win") from the
Inbox Next-Gen plan. The evidence audit for all 12 plan items lives in
`docs/inbox-nextgen-audit.md` — this document covers what P1 built,
how it was verified, and what is honestly NOT proven.

## What was built

### 1. Fixed-height workspace (web, inbox route only)
- In list view the inbox root is a flex column sized to the dashboard
  shell: `h-[calc(100dvh-164px)]` on mobile (60px topbar + shell
  padding + the M60 bottom-nav spacer), `sm:…-180px`, `lg:…-116px`
  (no bottom nav on desktop). The PAGE does not scroll in list view;
  header/error/notice bars are fixed (`shrink-0`).
- Three independently scrolling regions: conversation list (filters
  fixed on top, cards scroll), thread (header/action rows fixed; ONE
  scroll region holds the autopilot/WhatsApp-window/presence banners,
  the messages and the AI drafts; composer fixed at the bottom), and
  the context panel.
- The context panel is a real third grid column at **xl+** (it used
  to appear at 2xl and drop below the thread on lg). Below xl it is a
  right-side drawer opened by the "👤 তথ্য" button in the thread
  header (backdrop click or ✕ closes it) — no more page scroll to
  reach customer data on laptop widths.
- Board and Media views keep the previous page-scroll layout. The
  settings/report/team, channels, quick-reply/template and
  Meta-connect sections moved behind a new fourth tab
  "⚙️ সেটিংস ও টিম" (hidden in list view, visible in the other three
  views exactly as before).
- Mobile list↔thread pattern unchanged; composer and panels clear
  the M60 bottom navigation via the height budget above.
- Thread auto-scroll: pinned to the newest message on open and on
  own sends; incoming messages only auto-scroll when the agent is
  already near the bottom (history reading is never yanked).
- Known edge: dashboard-shell banners (View-As / platform /
  subscription notices rendered above `<main>`) are outside the
  height budget, so with such a banner visible the page may scroll
  slightly on mobile. The workspace itself never double-scrolls.

### 2. Resizable panels (desktop)
- Drag splitters for the list pane (230–520px, default 300) and the
  context pane (260–520px, default 320), implemented with CSS grid
  variables (`--ilw` / `--icw`) — no layout library.
- Widths persist in `localStorage` (`inbox.listW`, `inbox.ctxW`),
  double-click resets to the default, and each handle is
  keyboard-operable (`role="separator"`, arrow keys ±12px, persisted).

### 3. Composer upgrades
- The reply box is now a 2-row textarea: **Enter sends** (unchanged
  semantics), **Shift+Enter** inserts a newline. The existing
  presence-typing signal, `/` quick-reply trigger and panel, product
  picker and URL image form are untouched.
- **Emoji picker**: built-in curated 65-emoji grid (no dependency),
  inserts at the caret and restores focus/selection.
- **Formatting helpers (WhatsApp only)**: B / I / bullet-list buttons
  wrap the selection in `*…*` / `_…_` / `• ` markers. They render
  ONLY when the open conversation is WhatsApp — the one channel that
  renders these markers natively (see the audit, item 3). On every
  other channel the buttons are hidden rather than pretending the
  markers will format anything. Helpers are pure functions
  (`apps/web/src/lib/composer-format.ts`) with unit tests.
- **Drag-and-drop**: files dropped anywhere on the thread card (with
  a drop overlay), **paste-from-clipboard** files in the composer,
  and a 📎 file button all feed the same upload path. Dropping ONE
  file sends the composer's current text as its caption.
- **Voice recorder** (`apps/web/src/components/inbox-extras.tsx`):
  MediaRecorder with record → live timer → preview/play → send or
  discard; 5-minute cap; mic-permission denial produces a clear
  Bengali instruction message. The recording is a normal File into
  the same upload path.

### 4. The one genuinely-missing API piece: media upload
The audit proved the API had NO upload path (outbound media was
image-by-URL only). P1 adds the minimum, following the codebase's
own patterns (M59 logo upload: base64-in-JSON; U6 MediaStore):

- `POST /organizations/:id/inbox/conversations/:id/messages/media`
  (roles OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT) with
  `{ dataBase64, fileName?, contentType?, caption? }`.
- Decoded-size cap **2MB** (`MEDIA_UPLOAD_MAX_BYTES`; ~2.7MB base64
  stays inside the 3MB JSON body limit) with a Bengali error.
- **Magic-byte sniffing** (`apps/api/src/inbox/media-sniff.ts`): the
  declared content type is never trusted for images/PDF; containers
  (WebM/Ogg/MP4) use it only to split audio vs video. Unknown or
  spoofed payloads are rejected before any row is created.
- Bytes are persisted into the existing MediaStore (same keys as the
  inbound pipeline), so the agent thread renders uploads through the
  existing authenticated media proxy (the thread's media gate now
  also accepts `mediaStorageKey`).
- Delivery mirrors `sendImageReply` discipline exactly: the row is
  `sent` ONLY with the platform's confirmation id; any platform
  error marks the row `failed` and is thrown verbatim
  (`Media was NOT sent: …`).

Per-channel delivery (all real platform paths, no mocks):
- **WhatsApp**: Graph media upload (`POST /{phone}/media`) →
  send-by-media-id (caption skipped for audio, filename only for
  documents).
- **Messenger / Instagram**: `/me/message_attachments` upload
  (documents mapped to type `file`) → send by attachment id.
- **Telegram**: Bot API multipart uploads — sendPhoto / sendVoice
  (OGG only) / sendAudio / sendVideo / sendDocument.
- **Email**: SMTP attachment via the existing credential/threading
  path; counts only with an SMTP message id.
- **Webchat**: the stored row is the delivery (as with text);
  visitors fetch bytes from a new token-guarded route
  `GET /public/chat/:key/messages/:messageId/media` — the
  conversation is derived from the session token (M66 security
  model), the message must belong to it and carry OUR stored copy.
  The widget now renders image/audio/video/file bubbles (built with
  `createElement`, text stays inert) using the payload's `mediaUrl`
  or the same derivation for realtime frames.

## Per-channel truth table (voice + formatting)

| Channel | Voice note upload | Formatting markers |
|---|---|---|
| WhatsApp | Upload path exists; WhatsApp accepts ogg/opus, mp4/aac, mp3, amr audio. **Chrome records webm — WhatsApp will REJECT it and Meta's error shows verbatim** (row marked failed). Safari's mp4 recording is accepted. No transcoding exists in the codebase; none was faked. | `*bold*` / `_italic_` render natively → buttons shown |
| Messenger / IG | Attachment upload accepts audio files; playback is Messenger's own. Same browser-container caveat as the platform enforces. | Rendered literally → buttons hidden |
| Telegram | OGG recordings go via sendVoice (true voice note); other audio via sendAudio. A webm recording may be rejected by Telegram — its error shows verbatim. | Rendered literally (no parse mode anywhere) → buttons hidden |
| Email | Sent as a real SMTP attachment; the recipient's mail client decides playback. | Literal → buttons hidden |
| Webchat | Always works end-to-end: stored by us, played by the widget's own `<audio>` element (proven live, below). | Literal (widget uses textContent) → buttons hidden |

## Verification evidence

- **Web**: `tsc --noEmit` clean; tests **28/28** (20 baseline
  workflow-graph + 8 new composer-format); `next build` green.
- **API**: `tsc` clean; full suite **638/638, 93 suites** (includes
  12 new tests in `nextgen-media.spec.ts`: sniffer cases incl.
  spoofed-image rejection, webchat send flow, failure marking,
  size cap, format rejection).
- **Live (sandbox, servers restarted on the new builds)**:
  API health 200, web 200, `/dashboard/inbox` 200; the built inbox
  chunk contains the new markers (drop overlay text, `inbox.listW`,
  `messages/media`); the new API route answers 401 unauthenticated
  (exists, guarded).
- **Live end-to-end media proof** (throwaway account, scripted):
  register → create org → create webchat site → visitor session →
  visitor message → **agent uploads a PNG via the new endpoint →
  201, status `sent`, `externalId web-…`, media stored** → visitor
  poll returns the message WITH `mediaUrl` → visitor fetches the
  bytes (200, exact PNG bytes) → wrong session token gets **401** →
  a 2MB+1 upload gets **400** with the Bengali cap message.

## Honest limits — what was NOT exercised

- **No real-browser pixel QA**: the fixed layout, splitters and
  drawer were verified by build + served markup + code inspection,
  not by clicking through a rendered browser. Heights are computed
  from the shell's own constants.
- **Microphone behaviour is untestable headless**: the recorder's
  permission flow, mime negotiation and preview are code-reviewed
  and type-checked, but no real recording was made in the sandbox.
- **No live Meta/Telegram sends**: no production channel credentials
  exist in the sandbox (the M30 blocker), so WhatsApp/Messenger/
  Telegram/Email media delivery is proven by unit patterns + code
  paths mirroring the already-live text/image sends — NOT by a real
  platform delivery. Webchat (our own channel) IS proven live
  end-to-end, above. Platform rejections, when they happen with
  real credentials, surface verbatim by design.
- **No audio transcoding**: browser-webm voice notes will fail on
  WhatsApp (see truth table). A server-side transcoder (ffmpeg) is
  a deliberate follow-up decision, not a silent gap.
- The other views (board/media/manage) keep page scrolling by
  design; the fixed workspace applies to the conversation list view
  the owner specified.
