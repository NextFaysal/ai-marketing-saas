import { HttpException } from "@nestjs/common";
import type { LlmMessage, LlmProvider, LlmResult, LlmStreamChunk, LlmVisionImage } from "./llm.types";

/**
 * SA-B24 (Smart AI Phase 6, plan T3): the typed refusal every
 * LLM call raises while the AI kill switch is on for its
 * scope. An HttpException with the SAME 403 status and the
 * SAME wording the per-site kill-switch checks have always
 * thrown for a per-org disable ("...disabled for this
 * organization..."), plus the global variant — so a caller
 * that already handles the per-site refusal handles this
 * one identically, and no surface invents its own shape.
 */
export class AiPausedError extends HttpException {
  readonly code = "AI_PAUSED";
  readonly scope: "global" | "org";
  constructor(scope: "global" | "org") {
    super(
      scope === "global"
        ? "AI features are temporarily paused platform-wide by the platform team."
        : "AI features are temporarily disabled for this organization by the platform team.",
      403,
    );
    this.scope = scope;
  }
}

/**
 * Wrap a provider so EVERY completion path (complete /
 * completeStream / completeVision) runs `check` first and
 * refuses with AiPausedError while paused. The check is
 * async and runs per call — a flip takes effect on the next
 * call, never at some cached moment. Optional methods are
 * only wrapped when the inner provider implements them, so
 * the wrapper never makes a capability appear (the
 * LlmProvider contract: absence of completeStream means the
 * caller serves streaming through complete()).
 *
 * `name` / `isRealLlm` delegate live: the family's
 * not-configured honesty (a dev-template provider reads as
 * not-a-real-LLM) is unchanged by the wrap.
 */
export function guardLlmProvider(provider: LlmProvider, check: () => Promise<void>): LlmProvider {
  const wrapped: LlmProvider = {
    name: provider.name,
    get isRealLlm() {
      return provider.isRealLlm;
    },
    async complete(messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<LlmResult> {
      await check();
      return provider.complete(messages, opts);
    },
  };
  if (typeof provider.completeVision === "function") {
    wrapped.completeVision = async (image: LlmVisionImage, prompt: string, opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<LlmResult> => {
      await check();
      return provider.completeVision!(image, prompt, opts);
    };
  }
  if (typeof provider.completeStream === "function") {
    wrapped.completeStream = (messages: LlmMessage[], opts?: { jsonMode?: boolean; maxTokens?: number }): AsyncIterable<LlmStreamChunk> =>
      (async function* () {
        await check();
        yield* provider.completeStream!(messages, opts);
      })();
  }
  return wrapped;
}
