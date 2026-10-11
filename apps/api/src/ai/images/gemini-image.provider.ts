import { ImageConfigError, ImageGenResult, ImageProvider } from "./image.types";
import type { FetchFn } from "../llm/llm.types";

/**
 * Gemini image generation via the generateContent REST API with
 * responseModalities TEXT+IMAGE. Mirrors GeminiProvider's shape:
 * injectable fetchFn for specs, verbatim provider error surfacing.
 */
export class GeminiImageProvider implements ImageProvider {
  readonly name = "gemini";
  readonly isRealProvider = true as const;
  private readonly model: string;

  constructor(
    private readonly apiKey: string,
    model?: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    if (!apiKey) throw new ImageConfigError("IMAGE_API_KEY is required for the Gemini image provider");
    // Availability of a specific image model is account-dependent;
    // the admin verify-before-save catches a bad model with the
    // provider's verbatim error before anything is persisted.
    this.model = model || "gemini-2.5-flash-image";
  }

  async generate(prompt: string): Promise<ImageGenResult> {
    const res = await this.fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      },
    );
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Gemini image request failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
    }
    const parts: any[] = body.candidates?.[0]?.content?.parts ?? [];
    let textPart = "";
    for (const part of parts) {
      if (part?.inlineData?.data) {
        const bytes = Buffer.from(part.inlineData.data, "base64");
        const contentType = part.inlineData.mimeType ?? "image/png";
        const usage = body.usageMetadata;
        return {
          bytes,
          contentType,
          model: this.model,
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
          tokensEstimated: !usage,
        };
      }
      if (typeof part?.text === "string") textPart = part.text;
    }
    throw new Error("Gemini returned no image data" + (textPart ? `: ${textPart.slice(0, 200)}` : ""));
  }
}
