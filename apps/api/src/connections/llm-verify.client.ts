import { buildLlmProvider } from "../ai/llm/llm.factory";

/**
 * CC8 — verify-before-save for a tenant's OWN LLM key: a REAL
 * minimal completion through the chosen provider's own client.
 * The provider implementations (OpenAi/Anthropic/Gemini) throw
 * the provider's own error on a bad key; that message propagates
 * verbatim — nothing here softens or invents an outcome. A class
 * with an injectable seam so specs stub the boundary; the
 * production path is the real provider call (MetaAppClient
 * pattern).
 */
export class LlmVerifyClient {
  async verifyKey(provider: string, apiKey: string, model?: string): Promise<{ model: string }> {
    const llm = buildLlmProvider(provider, apiKey, model);
    const result = await llm.complete(
      [{ role: "user", content: "Reply with the single word: OK" }],
      { maxTokens: 16 },
    );
    if (!result?.text) throw new Error("LLM provider returned an empty response");
    return { model: result.model };
  }
}
