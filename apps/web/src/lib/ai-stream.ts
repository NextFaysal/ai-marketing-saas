import { API_URL, getToken } from "./api";

/**
 * AP1 streaming chat client.
 *
 * Uses fetch + ReadableStream instead of EventSource so the call
 * carries the normal Authorization header (EventSource cannot).
 * The endpoint is POST /organizations/:orgId/ai/chat/conversations/:id/messages/stream
 * and emits SSE frames `event: step|delta|done|error` with JSON data.
 * Guard failures (403/429) happen before the stream starts and arrive
 * as an ordinary JSON HTTP error — surfaced here via onError.
 */

export interface AiStreamToolCall {
  tool: string;
  args?: Record<string, unknown>;
  status: string;
  display?: unknown;
}

export interface AiStreamDone {
  messageId: string;
  toolsUsed: AiStreamToolCall[];
  usage: { inputTokens: number; outputTokens: number; estimated: boolean };
  suggestions: string[];
  // The proposal payload is opaque to the stream client; the page
  // only needs its title (same shape the non-streaming POST returned).
  proposal: { title?: string } | null;
  provider: string;
  isRealLlm: boolean;
}

export interface AiStreamCallbacks {
  onStep?: (step: { phase: "planning" | "tool"; tool?: string }) => void;
  onDelta?: (text: string) => void;
  onDone?: (done: AiStreamDone) => void;
  onError?: (message: string) => void;
}

export type AiStreamEvent =
  | { type: "step"; phase: "planning" | "tool"; tool?: string }
  | { type: "delta"; text: string }
  | ({ type: "done" } & AiStreamDone)
  | { type: "error"; message: string };

/**
 * Incremental SSE frame parser — chunk-split safe. Feed it decoded
 * text in arbitrary slices (a frame, an event name, or even a single
 * JSON character may be split across chunks); complete frames are
 * dispatched to `onEvent` in order. Multi-line `data:` payloads are
 * joined with "\n" per the SSE spec.
 */
export function createAiStreamParser(onEvent: (event: AiStreamEvent) => void) {
  let buffer = "";

  function dispatchFrame(frame: string) {
    let eventName = "";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (clean.startsWith("event:")) eventName = clean.slice(6).trim();
      else if (clean.startsWith("data:")) dataLines.push(clean.slice(5).trim());
      // ":" comment / heartbeat lines and unknown fields are ignored.
    }
    if (dataLines.length === 0) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    } catch {
      return; // a malformed frame must not kill the stream reader
    }
    const type = eventName || (typeof data.type === "string" ? data.type : "");
    if (type === "step") {
      onEvent({ type: "step", phase: data.phase === "tool" ? "tool" : "planning", ...(typeof data.tool === "string" ? { tool: data.tool } : {}) });
    } else if (type === "delta") {
      if (typeof data.text === "string") onEvent({ type: "delta", text: data.text });
    } else if (type === "done") {
      onEvent({
        type: "done",
        messageId: typeof data.messageId === "string" ? data.messageId : "",
        toolsUsed: Array.isArray(data.toolsUsed) ? (data.toolsUsed as AiStreamToolCall[]) : [],
        usage: (data.usage as AiStreamDone["usage"]) ?? { inputTokens: 0, outputTokens: 0, estimated: true },
        suggestions: Array.isArray(data.suggestions) ? (data.suggestions as string[]) : [],
        proposal: (data.proposal as AiStreamDone["proposal"]) ?? null,
        provider: typeof data.provider === "string" ? data.provider : "",
        isRealLlm: data.isRealLlm === true,
      });
    } else if (type === "error") {
      onEvent({ type: "error", message: typeof data.message === "string" ? data.message : "Provider failed" });
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      // Frames are separated by a blank line ("\n\n", tolerating "\r\n").
      let idx = buffer.indexOf("\n\n");
      while (idx >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (frame.trim()) dispatchFrame(frame);
        idx = buffer.indexOf("\n\n");
      }
    },
    /** Flush a trailing frame that arrived without its blank line. */
    flush() {
      const rest = buffer;
      buffer = "";
      if (rest.trim()) dispatchFrame(rest);
    },
  };
}

/**
 * Start one streamed chat message. Returns an AbortController — abort
 * it for the Stop button (the server persists any non-empty partial
 * answer with a stopped marker; the page then reloads the messages).
 * Exactly one of onDone / onError fires for a completed call; an
 * abort fires neither.
 */
export interface AiSendExtras {
  /** G6: the @-mentioned record — type + id only; the server loads
   *  the facts org-scoped and never stores them on the message. */
  entity?: { type: "order" | "customer" | "product" | "campaign"; id: string };
  /** AP2: processed attachment (server-extracted text / vision
   *  description) — stored on the user message server-side. */
  attachment?: { name: string; kind: "file" | "image"; text: string };
}

export function streamAiMessage(
  orgId: string,
  conversationId: string,
  content: string,
  callbacks: AiStreamCallbacks,
  pageContext?: string,
  extras?: AiSendExtras,
): AbortController {
  const controller = new AbortController();

  void (async () => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/organizations/${orgId}/ai/chat/conversations/${conversationId}/messages/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: JSON.stringify({ content, ...(pageContext ? { pageContext } : {}), ...(extras?.entity ? { entity: extras.entity } : {}), ...(extras?.attachment ? { attachment: extras.attachment } : {}) }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      callbacks.onError?.("নেটওয়ার্কে সমস্যা হচ্ছে। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
      return;
    }

    if (!res.ok || !res.body) {
      // Pre-stream guard failure (403 kill switch / 429 daily cap /
      // validation): an ordinary JSON error body, like apiFetch.
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      callbacks.onError?.(body.message ?? `Request failed: ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = createAiStreamParser((event) => {
      if (event.type === "step") callbacks.onStep?.({ phase: event.phase, tool: event.tool });
      else if (event.type === "delta") callbacks.onDelta?.(event.text);
      else if (event.type === "done") callbacks.onDone?.(event);
      else if (event.type === "error") callbacks.onError?.(event.message);
    });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.flush();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      callbacks.onError?.("নেটওয়ার্কে সমস্যা হচ্ছে। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
    }
  })();

  return controller;
}
