import { LlmProvider, LlmMessage, LlmResult, LlmConfigError, FetchFn } from "./llm.types";

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  readonly isRealLlm = true;
  private readonly model: string;
  constructor(private readonly apiKey: string, model?: string, private readonly fetchFn: FetchFn = fetch) {
    if (!apiKey) throw new LlmConfigError("LLM_API_KEY is required for the Gemini provider");
    this.model = model || "gemini-1.5-flash";
  }
  async complete(messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<LlmResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }],
    }));
    const res = await this.fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          ...(opts?.jsonMode ? { responseMimeType: "application/json" } : {}),
          ...(opts?.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
        },
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini request failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    return {
      text, model: this.model,
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
      tokensEstimated: false,
    };
  }
}
