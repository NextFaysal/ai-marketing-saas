import { describe, expect, it, vi } from "vitest";
import { createAiStreamParser, streamAiMessage, type AiStreamEvent } from "./ai-stream";

function collect() {
  const events: AiStreamEvent[] = [];
  const parser = createAiStreamParser((e) => events.push(e));
  return { events, parser };
}

const STEP = 'event: step\ndata: {"type":"step","phase":"planning"}\n\n';
const TOOL_STEP = 'event: step\ndata: {"type":"step","phase":"tool","tool":"get_analytics_overview"}\n\n';
const DELTA = 'event: delta\ndata: {"type":"delta","text":"Hello "}\n\n';
const DONE = 'event: done\ndata: {"type":"done","messageId":"m1","toolsUsed":[{"tool":"get_analytics_overview","status":"success","display":{"orders":42}}],"usage":{"inputTokens":13,"outputTokens":7,"estimated":false},"suggestions":["আরও?"],"proposal":null,"provider":"openai","isRealLlm":true}\n\n';

describe("createAiStreamParser", () => {
  it("dispatches step/delta/done frames in order with the done payload intact", () => {
    const { events, parser } = collect();
    parser.push(STEP + TOOL_STEP + DELTA + DONE);
    expect(events.map((e) => e.type)).toEqual(["step", "step", "delta", "done"]);
    expect(events[1]).toEqual({ type: "step", phase: "tool", tool: "get_analytics_overview" });
    const done = events[3] as Extract<AiStreamEvent, { type: "done" }>;
    expect(done.messageId).toBe("m1");
    expect(done.toolsUsed[0].display).toEqual({ orders: 42 });
    expect(done.usage).toEqual({ inputTokens: 13, outputTokens: 7, estimated: false });
    expect(done.provider).toBe("openai");
    expect(done.isRealLlm).toBe(true);
    expect(done.suggestions).toEqual(["আরও?"]);
  });

  it("is chunk-split safe: a frame split mid-JSON, mid-event-line and across the blank line still parses once", () => {
    const { events, parser } = collect();
    const wire = STEP + DELTA + DONE;
    // Feed the wire one character at a time — the harshest split.
    for (const ch of wire) parser.push(ch);
    expect(events.map((e) => e.type)).toEqual(["step", "delta", "done"]);
    expect(events.filter((e) => e.type === "delta")).toHaveLength(1);
  });

  it("holds a partial frame until its terminating blank line arrives", () => {
    const { events, parser } = collect();
    parser.push('event: delta\ndata: {"type":"delta","text":"Hel');
    expect(events).toHaveLength(0);
    parser.push('lo"}\n');
    expect(events).toHaveLength(0); // still no blank line
    parser.push("\n");
    expect(events).toEqual([{ type: "delta", text: "Hello" }]);
  });

  it("dispatches an error frame with its verbatim message", () => {
    const { events, parser } = collect();
    parser.push('event: error\ndata: {"type":"error","message":"OpenAI request failed (401): bad key"}\n\n');
    expect(events).toEqual([{ type: "error", message: "OpenAI request failed (401): bad key" }]);
  });

  it("ignores comment/heartbeat lines and malformed frames without throwing", () => {
    const { events, parser } = collect();
    parser.push(": heartbeat\n\n");
    parser.push("event: delta\ndata: not-json\n\n");
    parser.push(DELTA);
    expect(events).toEqual([{ type: "delta", text: "Hello " }]);
  });

  it("flush() dispatches a trailing frame that never got its blank line", () => {
    const { events, parser } = collect();
    parser.push('event: delta\ndata: {"type":"delta","text":"tail"}');
    parser.flush();
    expect(events).toEqual([{ type: "delta", text: "tail" }]);
  });
});

describe("streamAiMessage", () => {
  function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
    const fn = vi.fn(impl);
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  function sseResponse(wire: string, ok = true, status = 200, jsonBody?: unknown) {
    const encoder = new TextEncoder();
    // Split the wire into two uneven chunks to exercise the reader path.
    const mid = Math.max(1, Math.floor(wire.length / 3));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(wire.slice(0, mid)));
        c.enqueue(encoder.encode(wire.slice(mid)));
        c.close();
      },
    });
    return {
      ok, status, body: ok ? stream : null,
      json: async () => jsonBody ?? {},
    } as unknown as Response;
  }

  it("posts to the stream endpoint with the bearer token and dispatches callbacks", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", { getItem: () => "tok-1" });
    const fetchFn = stubFetch(async () => sseResponse(STEP + DELTA + DONE));
    const onStep = vi.fn(); const onDelta = vi.fn(); const onDone = vi.fn(); const onError = vi.fn();
    const controller = streamAiMessage("org-1", "conv-1", "হ্যালো", { onStep, onDelta, onDone, onError });
    expect(controller).toBeInstanceOf(AbortController);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/organizations/org-1/ai/chat/conversations/conv-1/messages/stream");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(init.body as string)).toEqual({ content: "হ্যালো" });
    expect(onStep).toHaveBeenCalledWith({ phase: "planning" });
    expect(onDelta).toHaveBeenCalledWith("Hello ");
    expect(onDone.mock.calls[0][0]).toMatchObject({ messageId: "m1", provider: "openai", isRealLlm: true });
    expect(onError).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("surfaces a pre-stream 429 JSON guard failure via onError (no stream events)", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    stubFetch(async () => sseResponse("", false, 429, { message: "Daily AI message limit reached for this organization (200). Try again tomorrow or ask the platform team to raise your plan limit." }));
    const onDone = vi.fn(); const onError = vi.fn();
    streamAiMessage("org-1", "conv-1", "hi", { onDone, onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toContain("Daily AI message limit reached");
    expect(onDone).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("an abort fires neither onDone nor onError", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    stubFetch(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      (init.signal as AbortSignal).addEventListener("abort", () => {
        const err = new Error("aborted"); err.name = "AbortError"; reject(err);
      });
    }));
    const onDone = vi.fn(); const onError = vi.fn();
    const controller = streamAiMessage("org-1", "conv-1", "hi", { onDone, onError });
    controller.abort();
    await new Promise((r) => setTimeout(r, 20));
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
