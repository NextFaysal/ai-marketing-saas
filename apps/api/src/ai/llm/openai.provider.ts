import { LlmProvider, LlmMessage, LlmResult, LlmStreamChunk, LlmConfigError, FetchFn, estimateTokens, iterateSseJson, throwStreamHttpError } from "./llm.types";

export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  readonly isRealLlm = true;
  private readonly model: string;
  constructor(private readonly apiKey: string, model?: string, private readonly fetchFn: FetchFn = fetch) {
    if (!apiKey) throw new LlmConfigError("LLM_API_KEY is required for the OpenAI provider");
    this.model = model || "gpt-4o-mini";
  }
  async complete(messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<LlmResult> {
    const res = await this.fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model, messages,
        ...(opts?.jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI request failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      model: body.model ?? this.model,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      tokensEstimated: false,
    };
  }

  async *completeStream(messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): AsyncIterable<LlmStreamChunk> {
    const res = await this.fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model, messages, stream: true,
        stream_options: { include_usage: true },
        ...(opts?.jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
    });
    if (!res.ok) await throwStreamHttpError(res, "OpenAI");
    let text = "";
    let model = this.model;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
    for await (const payload of iterateSseJson((res as any).body)) {
      if (payload?.model) model = payload.model;
      if (payload?.usage) usage = payload.usage;
      const delta: string = payload?.choices?.[0]?.delta?.content ?? "";
      if (delta) { text += delta; yield { delta }; }
    }
    if (usage) {
      yield { result: { text, model, inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0, tokensEstimated: false } };
    } else {
      // The vendor did not report usage: fall back to the labelled estimate.
      const input = messages.map((m) => m.content).join("\n");
      yield { result: { text, model, inputTokens: estimateTokens(input), outputTokens: estimateTokens(text), tokensEstimated: true } };
    }
  }
}
