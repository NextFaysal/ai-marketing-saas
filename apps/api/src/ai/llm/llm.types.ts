export interface LlmMessage { role: "system" | "user" | "assistant"; content: string }
export interface LlmResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  tokensEstimated: boolean;
}

export interface LlmProvider {
  readonly name: string; // openai | anthropic | gemini | dev-template
  readonly isRealLlm: boolean;
  complete(messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<LlmResult>;
}

export class LlmConfigError extends Error {}

type FetchFn = typeof fetch;

export function estimateTokens(text: string): number {
  // Rough heuristic used ONLY for the dev adapter and labeled as estimated.
  return Math.max(1, Math.ceil(text.length / 4));
}
export { type FetchFn };
