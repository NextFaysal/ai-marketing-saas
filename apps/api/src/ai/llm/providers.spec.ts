import { OpenAiProvider } from "./openai.provider";
import { AnthropicProvider } from "./anthropic.provider";
import { GeminiProvider } from "./gemini.provider";
import { DevTemplateProvider } from "./dev.provider";
import { LlmConfigError } from "./llm.types";

describe("LLM providers", () => {
  it("OpenAI provider maps chat completion + usage", async () => {
    const fetchFn = async () => ({
      ok: true, status: 200,
      json: async () => ({ model: "gpt-4o-mini", choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    }) as any;
    const p = new OpenAiProvider("sk-test", undefined, fetchFn);
    const r = await p.complete([{ role: "user", content: "hi" }]);
    expect(r).toMatchObject({ text: "hello", inputTokens: 10, outputTokens: 5, tokensEstimated: false });
    expect(p.isRealLlm).toBe(true);
  });
  it("Anthropic provider separates the system prompt and joins text blocks", async () => {
    let sentBody: any = null;
    const fetchFn = async (_url: string, init: any) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ model: "claude-x", content: [{ type: "text", text: "ans" }], usage: { input_tokens: 7, output_tokens: 3 } }) } as any;
    };
    const p = new AnthropicProvider("key", undefined, fetchFn as any);
    const r = await p.complete([{ role: "system", content: "be good" }, { role: "user", content: "q" }]);
    expect(r.text).toBe("ans");
    expect(sentBody.system).toBe("be good");
    expect(sentBody.messages).toEqual([{ role: "user", content: "q" }]);
  });
  it("missing keys are configuration errors, never silent", () => {
    expect(() => new OpenAiProvider("")).toThrow(LlmConfigError);
    expect(() => new AnthropicProvider("")).toThrow(LlmConfigError);
    expect(() => new GeminiProvider("")).toThrow(LlmConfigError);
  });
  it("Gemini provider defaults to the gemini-flash-latest alias and sends the API key header", async () => {
    let sentUrl = ""; let sentHeaders: any = null;
    const fetchFn = async (url: string, init: any) => {
      sentUrl = url; sentHeaders = init.headers;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "hi" }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } }) } as any;
    };
    const p = new GeminiProvider("g-test", undefined, fetchFn as any);
    const r = await p.complete([{ role: "user", content: "hello" }]);
    expect(sentUrl).toContain("/models/gemini-flash-latest:generateContent");
    expect(sentHeaders["x-goog-api-key"]).toBe("g-test");
    expect(r).toMatchObject({ text: "hi", model: "gemini-flash-latest", inputTokens: 4, outputTokens: 2, tokensEstimated: false });
    // an explicit model still wins over the default
    const p2 = new GeminiProvider("g-test", "gemini-3.8-flash", fetchFn as any);
    await p2.complete([{ role: "user", content: "hello" }]);
    expect(sentUrl).toContain("/models/gemini-3.8-flash:generateContent");
  });
  it("dev adapter is honestly labeled as not a real LLM", async () => {
    const p = new DevTemplateProvider();
    expect(p.isRealLlm).toBe(false);
    expect(p.name).toBe("dev-template");
    const r = await p.complete([{ role: "user", content: "anything" }]);
    expect(r.text).toContain("DEV TEMPLATE");
    expect(r.tokensEstimated).toBe(true);
  });
});

describe("LLM provider streaming (recorded SSE fixtures)", () => {
  /** Fake fetch response whose body yields the given raw chunks —
   *  chunks may split an SSE line anywhere, like a real socket. */
  function sseResponse(chunks: string[]) {
    return {
      ok: true, status: 200,
      body: (async function* () { for (const c of chunks) yield c; })(),
    } as any;
  }
  async function collect(iter: AsyncIterable<any>) {
    const out: any[] = [];
    for await (const chunk of iter) out.push(chunk);
    return out;
  }

  it("OpenAI completeStream parses data: deltas + final usage", async () => {
    let sentBody: any = null;
    const lines = [
      'data: {"model":"gpt-4o-mini","choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"model":"gpt-4o-mini","choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
      "data: [DONE]\n\n",
    ];
    // split the first line across two socket chunks on purpose
    const fetchFn = async (_url: string, init: any) => { sentBody = JSON.parse(init.body); return sseResponse([lines[0].slice(0, 20), lines[0].slice(20), ...lines.slice(1)]); };
    const p = new OpenAiProvider("sk-test", undefined, fetchFn as any);
    const chunks = await collect(p.completeStream!([{ role: "user", content: "hi" }]));
    expect(sentBody.stream).toBe(true);
    expect(sentBody.stream_options).toEqual({ include_usage: true });
    expect(chunks.filter((c) => c.delta).map((c) => c.delta)).toEqual(["Hel", "lo"]);
    expect(chunks[chunks.length - 1].result).toMatchObject({ text: "Hello", inputTokens: 10, outputTokens: 5, tokensEstimated: false });
  });

  it("OpenAI completeStream without usage falls back to a labelled estimate", async () => {
    const fetchFn = async () => sseResponse(['data: {"choices":[{"delta":{"content":"abc"}}]}\n\n', "data: [DONE]\n\n"]);
    const p = new OpenAiProvider("sk-test", undefined, fetchFn as any);
    const chunks = await collect(p.completeStream!([{ role: "user", content: "hi" }]));
    expect(chunks[chunks.length - 1].result).toMatchObject({ text: "abc", tokensEstimated: true });
  });

  it("OpenAI completeStream surfaces HTTP errors verbatim, like complete()", async () => {
    const fetchFn = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "bad key" } }), body: null }) as any;
    const p = new OpenAiProvider("sk-test", undefined, fetchFn);
    await expect(collect(p.completeStream!([{ role: "user", content: "hi" }]))).rejects.toThrow("OpenAI request failed (401): bad key");
  });

  it("Anthropic completeStream parses message_start / text_delta / message_delta usage", async () => {
    let sentBody: any = null;
    const events = [
      'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-x","usage":{"input_tokens":7,"output_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"an"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"s"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const fetchFn = async (_url: string, init: any) => { sentBody = JSON.parse(init.body); return sseResponse(events); };
    const p = new AnthropicProvider("key", undefined, fetchFn as any);
    const chunks = await collect(p.completeStream!([{ role: "system", content: "be good" }, { role: "user", content: "q" }]));
    expect(sentBody.stream).toBe(true);
    expect(sentBody.system).toBe("be good");
    expect(chunks.filter((c) => c.delta).map((c) => c.delta)).toEqual(["an", "s"]);
    expect(chunks[chunks.length - 1].result).toMatchObject({ text: "ans", model: "claude-x", inputTokens: 7, outputTokens: 3, tokensEstimated: false });
  });

  it("Gemini completeStream uses streamGenerateContent?alt=sse and usageMetadata", async () => {
    let sentUrl = "";
    const lines = [
      'data: {"candidates":[{"content":{"parts":[{"text":"hi "}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":1}}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"there"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2}}\n\n',
    ];
    const fetchFn = async (url: string) => { sentUrl = url; return sseResponse(lines); };
    const p = new GeminiProvider("g-test", undefined, fetchFn as any);
    const chunks = await collect(p.completeStream!([{ role: "user", content: "hello" }]));
    expect(sentUrl).toContain("/models/gemini-flash-latest:streamGenerateContent?alt=sse");
    expect(chunks.filter((c) => c.delta).map((c) => c.delta)).toEqual(["hi ", "there"]);
    expect(chunks[chunks.length - 1].result).toMatchObject({ text: "hi there", inputTokens: 4, outputTokens: 2, tokensEstimated: false });
  });

  it("dev provider completeStream word-chunks its labelled template text", async () => {
    const p = new DevTemplateProvider();
    const full = await p.complete([{ role: "user", content: "anything" }]);
    const chunks = await collect(p.completeStream!([{ role: "user", content: "anything" }]));
    const deltas = chunks.filter((c) => c.delta).map((c) => c.delta);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(full.text);
    expect(chunks[chunks.length - 1].result).toMatchObject({ text: full.text, tokensEstimated: true });
  });
});
