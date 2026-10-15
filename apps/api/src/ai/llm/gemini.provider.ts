import { LlmProvider, LlmMessage, LlmResult, LlmStreamChunk, LlmVisionImage, LlmConfigError, FetchFn, estimateTokens, iterateSseJson, throwStreamHttpError } from "./llm.types";

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  readonly isRealLlm = true;
  private readonly model: string;
  constructor(private readonly apiKey: string, model?: string, private readonly fetchFn: FetchFn = fetch) {
    if (!apiKey) throw new LlmConfigError("LLM_API_KEY is required for the Gemini provider");
    // Default model: the "gemini-flash-latest" alias Google itself
    // points to. Dated defaults DIE for new accounts — gemini-1.5-flash
    // (the previous default) returns 404 "no longer available to new
    // users" on a fresh key even though ListModels still lists it
    // (verified live 2026-10-10 with a new Gemini key). The operator
    // can override the model in Admin Console -> Dynamic Platform
    // Config (Milestone 33) without a code change.
    this.model = model || "gemini-flash-latest";
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

  /** CX8 vision: generateContent with an inlineData image part
   *  alongside the text prompt — same endpoint, key header and
   *  usage shape as complete(). */
  async completeVision(image: LlmVisionImage, prompt: string, opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<LlmResult> {
    const res = await this.fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: image.mimeType, data: image.base64 } },
          ],
        }],
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

  async *completeStream(messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): AsyncIterable<LlmStreamChunk> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }],
    }));
    const res = await this.fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse`, {
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
    if (!res.ok) await throwStreamHttpError(res, "Gemini");
    let text = "";
    let usage: { promptTokenCount?: number; candidatesTokenCount?: number } | null = null;
    for await (const payload of iterateSseJson((res as any).body)) {
      if (payload?.usageMetadata) usage = payload.usageMetadata;
      const delta: string = (payload?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      if (delta) { text += delta; yield { delta }; }
    }
    if (usage) {
      yield { result: { text, model: this.model, inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0, tokensEstimated: false } };
    } else {
      const input = messages.map((m) => m.content).join("\n");
      yield { result: { text, model: this.model, inputTokens: estimateTokens(input), outputTokens: estimateTokens(text), tokensEstimated: true } };
    }
  }
}
