# CX12c — Voice-Note Ordering: Acceptance

Batch 4 of the CX package. LOCAL ONLY (no push). Base HEAD: d785cbf.

## Audit correction — the provider already existed; this item is the AUTO pipeline

CX12c was scoped as "voice-note ordering", which sounds like building
speech-to-text. Code audit showed that already existed and was NOT the
gap:

- `apps/api/src/inbox/media-intelligence.ts` exports
  `transcribeAudio(bytes, contentType, fetchFn)` — OpenAI Whisper
  (model `whisper-1`, language `"bn"`) or Gemini audio input, chosen
  from the deployment's `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL`;
  Anthropic and unconfigured deployments throw an honest
  `MediaIntelligenceError`. It never invents text.
- `ChannelMessage` already carried `transcription String?` +
  `transcriptionProvider String?`.
- `InboxService.transcribeMessage(...)` (POST
  `conversations/:id/messages/:id/transcribe`) was an AGENT-TRIGGERED
  on-demand path: returns the stored transcription if present, else
  fetches media via `getMessageMedia()`, transcribes, stores, and
  classifies intent from the transcript.

THE GAP: inbound voice notes were never auto-transcribed and never
reached the order bot / autopilot. `processInboundIntelligence` read
`event.content ?? ""`; for an audio message that is empty, so
classification, COD/CSAT/review capture, `handleOrderBot` and
`maybeAutoReply` were ALL skipped. A customer who ordered by voice
note got silence. CX12c closes exactly that gap — no new provider was
built.

## What was built

### 1. Schema + migration (additive)

- `ChannelMessage.transcriptionStatus String?` with a schema comment
  stating the semantics.
- Migration `20261012160000_cx12c_transcription_status` — one
  hand-written `ALTER TABLE ... ADD COLUMN ... TEXT`, no backfill.
- `prisma generate` run (CHECKPOINT_DISABLE=1) after the schema edit.
- **The sandbox has NO Postgres: the migration is written, NOT
  applied.** It must be applied by the normal deploy migration step
  before this code serves traffic against a real database.

Status semantics:

| value         | meaning                                                                 |
|---------------|-------------------------------------------------------------------------|
| `null`        | never attempted / not an audio message                                  |
| `"pending"`   | an attempt is in flight (stamped BEFORE the provider call)              |
| `"done"`      | transcription stored on the row                                         |
| `"failed"`    | provider or media-fetch failure — terminal for the auto path            |
| `"unavailable"` | no speech provider configured (`MediaIntelligenceError`) — terminal for the auto path |

### 2. Shared core: `ensureTranscription(...)`

The core of `transcribeMessage` was extracted into a private helper
used by BOTH paths:

- returns the stored transcript when present (NO provider call);
- otherwise fetches media bytes via `getMessageMedia`, calls
  `transcribeAudio`, stores transcription + provider + status
  `"done"`, and classifies intent from the transcript (only when the
  row has no intent yet — the on-demand path's original rule);
- throws whatever the media fetch / provider throws. Callers decide
  how honest to be: the endpoint surfaces it, the auto path stamps a
  status and swallows it.

`transcribeMessage` behaviour is preserved: same early return for a
stored transcription, same return shape
(`{ transcription, provider, intent }`), and the honest config error
still reaches the agent who clicked (covered by a spec below, plus
the pre-existing media-intelligence spec still passes).

### 3. Auto path inside `processInboundIntelligence`

Hook point: the very top of the dispatch, before classification.
When the dispatch text is empty, `autoTranscribeInbound(...)` runs;
it acts only when `message.type === "audio"` and
`message.direction === "in"`:

- **Stored transcription** → reused as the dispatch text, NO provider
  call; status converged to `"done"` if it was not already.
- **Status `"failed"` / `"unavailable"`** → NOT retried (no retry
  storms on any re-dispatch); the dispatch proceeds with empty text
  exactly as before CX12c. The agent's manual transcribe button is
  the retry path.
- **Otherwise** → stamp `"pending"`, fetch media, transcribe.
  Success: transcript stored + status `"done"`, intent classified
  from it, and the transcript becomes `text` for the REST of this
  dispatch — COD/CSAT/review capture, the order bot and the
  autopilot all receive it exactly like typed text, in the same
  single pass. `MediaIntelligenceError` → `"unavailable"`; any other
  failure → `"failed"`. ALL failure modes are swallowed (the helper
  never throws): ingest and the rest of the intelligence pass
  complete exactly as they do today for audio.
- **Tenant isolation**: the helper refuses unless the conversation
  belongs to the dispatch's organization and the message belongs to
  that conversation; `getMessageMedia` additionally re-resolves the
  conversation under the org.
- **Voice-origin marking**: the stored `transcription` +
  `transcriptionStatus` on the row IS the durable mark, and the
  thread UI shows it. Bot copy was not changed; the bot's
  confirm-before-create discipline lives inside `handleOrderBot`
  and is untouched — feeding it transcript text bypasses nothing.
- `message.content` is never written: the transcript lives only in
  the `transcription` column.

### Double-processing guard + verification

The transcript is used only as the local `text` variable of the one
dispatch that transcribed it. No second dispatch is triggered, and
no other code path feeds an audio row's content into the bot or
autopilot. Verified by reading every `content` consumer in
`inbox.service.ts` (and the inbox helpers): the webhook parser sets
`content` only from a caption/filename (WhatsApp/Messenger audio has
neither → stored `null`); all other readers null-guard
(`m.content ?? ""`, `?? [type]`, truthiness checks) — mood/sentiment
read-time computation, CSV/JSON exports, draft-suggestion context,
summaries — and the CX3 debounce sweep composes its batch text from
stored `content` only, so an audio row contributes nothing there.

Known boundary, stated honestly: because `content` stays null by
design, a CX3-deferred autopilot reply (reply delay > 0) composes
from stored contents at fire time and therefore does not include the
transcript; with delay 0 (the default) the autopilot answers from
the transcript in the original dispatch, as the specs prove.

### 4. Web (inbox thread)

`apps/web/src/app/dashboard/inbox/page.tsx`:

- `Message` interface gains `transcriptionStatus?: string | null`.
  The thread payload needed no serializer change: `getConversation`
  returns the message rows spread (`...m`), so `transcription` and
  `transcriptionStatus` already ride it — verified, not assumed.
- The transcript already rendered under the audio message with a 🎙️
  label; added honest status notes when there is no transcript:
  - `"failed"` → "🎙️ ভয়েস মেসেজ — ট্রান্সক্রিপ্ট পাওয়া যায়নি"
  - `"unavailable"` → "🎙️ ভয়েস মেসেজ — ট্রান্সক্রিপ্ট উপলব্ধ নয়"
- The manual "🎙️ ভয়েস লেখায় রূপান্তর করুন" action remains, and is
  the retry path after a failed/unavailable auto attempt.

## Tests

New spec `apps/api/src/inbox/cx12c-voice-ordering.spec.ts` — 11/11
pass. It `jest.mock`s the media-intelligence module (fake
`transcribeAudio`) and stubs `getMessageMedia` on the service
instance, following the existing fake-prisma harness patterns
(order-bot / media-intelligence specs); dispatch is driven through
the public `ingestChatMessage` entry:

1. audio + provider success → transcription + provider + status
   `done` stored, intent `order_intent`; the order bot received the
   transcript in the same dispatch (observable effect: a bot session
   created at `ask_product` and the product list sent).
2. autopilot receives the transcript too (bot disabled): a grounded
   price auto-reply is sent for the transcribed price question.
3. audio + `MediaIntelligenceError` → status `unavailable`, no
   throw, bot/autopilot fed nothing, no outbound sends.
4. audio + generic provider failure → status `failed`, ingest
   intact, message row otherwise untouched.
5. already-transcribed message → provider NOT called again
   (nor media fetched), stored text drives the dispatch, status
   converges to `done`.
6. status `failed`/`unavailable` → a second dispatch does NOT retry.
7. plain text message → zero transcription activity; the typed text
   still reaches the bot as before.
8. outbound audio → ignored.
9. tenant isolation → another org's dispatch (public entry AND a
   direct auto-path call) never transcribes this org's voice note.
10. on-demand `transcribeMessage` still surfaces the honest config
    error to the agent (behaviour preserved through the refactor).
11. on-demand `transcribeMessage` via the shared core stores
    transcript + status `done`.

Targeted suites (jest --runInBand): the 5 closest inbox suites
(media-intelligence, order-bot, u3-autopilot, inbox.service,
inbox-intelligence) pass 46/46. Full `src/inbox` run: 31/35 suites
pass, 278 tests pass in the suites that run. The 4 failing suites
(nextgen-p2, nextgen-p3, m66-visitor-stream, phase-f) fail at TS
compile on the PRE-EXISTING parallel AG1-track breakage in
`webchat.service.ts` (TS2304 `parseCourierCard`, their uncommitted
work — untouched, not fixed here). `cx3-debounce` is the known
flake: it failed once and passed 18/18 on two consecutive reruns.

Type gates: API `tsc --noEmit` reports exactly ONE error — the same
pre-existing AG1 `webchat.service.ts` TS2304; zero errors in CX12c
files. Web `tsc --noEmit` reports 3 errors, all in
`automations/page.tsx`, caused by the parallel track's deleted
`@/lib/automation-blueprints` module; zero in the inbox page. Web
vitest: 96/96 pass.

## Evidence ceiling

- Transcription is proven ONLY via the faked provider in specs. No
  real Whisper/Gemini transcription was performed or is claimed;
  live verification awaits a configured provider on the deployment
  (the M30 pattern).
- The migration is written but NOT applied in the sandbox (no
  Postgres); no live-DB claim is made.
- No live visual QA of the thread notes was possible in the sandbox;
  the web change is minimal JSX in the existing message rendering,
  type-checked and covered by the web test run above.
- LOCAL commit only. No push, no fetch. Parallel tracks' uncommitted
  work was not staged, restored, or modified: for
  `inbox.service.ts`, only the CX12c hunks were staged (scratch-blob
  method against HEAD), leaving the AG1 hunks in the working tree
  exactly as found.
