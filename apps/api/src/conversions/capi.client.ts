/**
 * Meta Conversions API client.
 * POST https://graph.facebook.com/{version}/{dataset_id}/events
 *   { data: [event], test_event_code? }
 *   -> { events_received, messages, fbtrace_id }
 * An event counts as sent ONLY when Meta answers events_received >= 1.
 */
export class CapiError extends Error {}

const VERSION = process.env.META_GRAPH_VERSION || "v21.0";

export interface CapiEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: string;
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

export class MetaCapiClient {
  constructor(private readonly accessToken: string, private readonly fetchFn: typeof fetch = fetch) {}

  async sendEvents(datasetId: string, events: CapiEvent[], testEventCode?: string): Promise<{ eventsReceived: number; fbtraceId?: string }> {
    const res = await this.fetchFn(`https://graph.facebook.com/${VERSION}/${datasetId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: events,
        access_token: this.accessToken,
        ...(testEventCode ? { test_event_code: testEventCode } : {}),
      }),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || body?.error) {
      throw new CapiError(`Conversions API failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
    }
    const received = Number(body?.events_received ?? 0);
    if (received < 1) throw new CapiError(`Conversions API accepted the request but received 0 events${body?.messages?.length ? `: ${JSON.stringify(body.messages)}` : ""}`);
    return { eventsReceived: received, fbtraceId: body?.fbtrace_id };
  }
}
