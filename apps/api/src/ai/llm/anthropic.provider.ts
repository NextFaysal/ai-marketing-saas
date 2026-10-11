import { LlmProvider, LlmMessage, LlmResult, LlmStreamChunk, LlmConfigError, FetchFn, estimateTokens, iterateSseJson, throwStreamHttpError } from "./llm.types";

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly isRealLlm = true;
  private readonly model: string;
  constructor(private readonly apiKey: string, model?: string, private readonly fetchFn: FetchFn = fetch) {
    if (!apiKey) throw new LlmConfigError("LLM_API_KEY is required for the Anthropic provider");
    this.model = model || "claude-3-5-haiku-latest";
  }
  async complete(messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<LlmResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const rest = messages.filter((m) => m.role !== "system");
    const res = await this.fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model, system: system || undefined,
        messages: rest, max_tokens: opts?.maxTokens ?? 2000,
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Anthropic request failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
    const text = (body.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    return {
      text, model: body.model ?? this.model,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      tokensEstimated: false,
    };
  }

  async *completeStream(messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): AsyncIterable<LlmStreamChunk> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const rest = messages.filter((m) => m.role !== "system");
    const res = await this.fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model, system: system || undefined,
        messages: rest, max_tokens: opts?.maxTokens ?? 2000, stream: true,
      }),
    });
    if (!res.ok) await throwStreamHttpError(res, "Anthropic");
    let text = "";
    let model = this.model;
    let inputTokens = 0;
    let outputTokens = 0;
    let usageSeen = false;
    for await (const payload of iterateSseJson((res as any).body)) {
      if (payload?.type === "message_start") {
        if (payload.message?.model) model = payload.message.model;
        if (typeof payload.message?.usage?.input_tokens === "number") { inputTokens = payload.message.usage.input_tokens; usageSeen = true; }
        if (typeof payload.message?.usage?.output_tokens === "number") outputTokens = payload.message.usage.output_tokens;
      } else if (payload?.type === "content_block_delta" && payload.delta?.type === "text_delta") {
        const delta: string = payload.delta.text ?? "";
        if (delta) { text += delta; yield { delta }; }
      } else if (payload?.type === "message_delta") {
        if (typeof payload.usage?.output_tokens === "number") { outputTokens = payload.usage.output_tokens; usageSeen = true; }
      } else if (payload?.type === "error") {
        throw new Error(`Anthropic request failed: ${payload.error?.message ?? "unknown"}`);
      }
    }
    if (usageSeen) {
      yield { result: { text, model, inputTokens, outputTokens, tokensEstimated: false } };
    } else {
      const input = messages.map((m) => m.content).join("\n");
      yield { result: { text, model, inputTokens: estimateTokens(input), outputTokens: estimateTokens(text), tokensEstimated: true } };
    }
  }
}
