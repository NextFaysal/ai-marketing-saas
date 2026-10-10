import { Injectable } from "@nestjs/common";
import { LlmProvider, LlmConfigError } from "./llm.types";
import { OpenAiProvider } from "./openai.provider";
import { AnthropicProvider } from "./anthropic.provider";
import { GeminiProvider } from "./gemini.provider";
import { DevTemplateProvider } from "./dev.provider";
import { effectiveLlmConfig, llmFingerprint } from "../../common/platform-config";

/** Build a provider from an explicit config. No silent fallbacks:
 *  asking for a real provider without a key is a configuration
 *  error; an empty provider name selects the labeled dev adapter. */
export function buildLlmProvider(name: string, apiKey: string, model?: string): LlmProvider {
  switch ((name ?? "").toLowerCase()) {
    case "openai": return new OpenAiProvider(apiKey, model);
    case "anthropic": return new AnthropicProvider(apiKey, model);
    case "gemini": return new GeminiProvider(apiKey, model);
    case "dev": case "": return new DevTemplateProvider();
    default: throw new LlmConfigError(`Unknown LLM provider: ${name} (expected openai | anthropic | gemini | dev)`);
  }
}

@Injectable()
export class LlmFactory {
  private provider: LlmProvider | null = null;
  private fingerprint = "";

  /** Effective config = Admin Console setting (Milestone 33) when
   *  present, else the LLM_* env vars. The provider instance is
   *  rebuilt whenever the effective config changes, so an admin
   *  edit takes effect without a restart. */
  getProvider(): LlmProvider {
    const fp = llmFingerprint();
    if (this.provider && this.fingerprint === fp) return this.provider;
    const cfg = effectiveLlmConfig();
    this.provider = buildLlmProvider(cfg.provider, cfg.apiKey, cfg.model);
    this.fingerprint = fp;
    return this.provider;
  }
}
