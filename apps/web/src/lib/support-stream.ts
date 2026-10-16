import { API_URL } from "./api";

export interface TicketStreamEvent {
  type: "message.created" | "ticket.updated" | "ticket.csat" | "typing" | "heartbeat";
  data?: any;
  who?: "tenant" | "admin";
  isTyping?: boolean;
  at?: string;
}

/**
 * Realtime Support Ticket SSE Subscriber (Next AI Marketing).
 *
 * Connects to the tenant ticket stream endpoint via fetch + ReadableStream,
 * preserving Bearer token authorization and auto-reconnecting on disconnect.
 */
export function subscribeTicketStream(
  organizationId: string,
  ticketId: string,
  onEvent: (event: TicketStreamEvent) => void,
): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let retryMs = 1000;

  async function connect() {
    while (!stopped) {
      try {
        controller = new AbortController();
        const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
        const res = await fetch(
          `${API_URL}/organizations/${organizationId}/tickets/${ticketId}/stream`,
          {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              Accept: "text/event-stream",
            },
            signal: controller.signal,
          },
        );

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
                if (parsed && typeof parsed === "object" && parsed.type) {
                  onEvent(parsed as TicketStreamEvent);
                }
              } catch {
                // Heartbeat comments and partial frames are ignored
              }
            }
            idx = buffer.indexOf("\n\n");
          }
        }
      } catch {
        if (stopped) return;
      }
      if (stopped) return;
      await new Promise((r) => setTimeout(r, retryMs));
      retryMs = Math.min(retryMs * 2, 10000);
    }
  }

  void connect();

  return () => {
    stopped = true;
    controller?.abort();
  };
}
