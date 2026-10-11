import { API_URL } from "./api";

/**
 * Realtime inbox stream client (Unified Inbox U1).
 *
 * Uses fetch + ReadableStream instead of EventSource so the call
 * carries the normal Authorization header (EventSource cannot).
 * Parses SSE frames, reconnects with backoff, and stops cleanly.
 */
export interface InboxStreamEvent {
  type: "message.created" | "conversation.updated" | "presence" | "notification" | "heartbeat" | "visitor.presence";
  conversationId?: string;
  message?: { id: string; [k: string]: unknown };
  patch?: Record<string, unknown>;
  userId?: string;
  typing?: boolean;
  visitorTyping?: boolean;
  at?: string;
}

export function subscribeInboxStream(
  organizationId: string,
  onEvent: (event: InboxStreamEvent) => void,
): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let retryMs = 1000;

  async function connect() {
    while (!stopped) {
      try {
        controller = new AbortController();
        const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
        const res = await fetch(`${API_URL}/organizations/${organizationId}/inbox/conversations/stream`, {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        retryMs = 1000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx = buffer.indexOf("\n\n");
          while (idx >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (dataLine) {
              try {
                const parsed = JSON.parse(dataLine.slice(5).trim());
                if (parsed && typeof parsed === "object" && parsed.type) onEvent(parsed as InboxStreamEvent);
              } catch { /* heartbeat comments and partial frames are ignored */ }
            }
            idx = buffer.indexOf("\n\n");
          }
        }
      } catch {
        if (stopped) return;
      }
      if (stopped) return;
      await new Promise((r) => setTimeout(r, retryMs));
      retryMs = Math.min(15000, retryMs * 2);
    }
  }

  void connect();
  return () => {
    stopped = true;
    try { controller?.abort(); } catch { /* already closed */ }
  };
}
