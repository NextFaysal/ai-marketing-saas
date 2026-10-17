import { Injectable, Optional } from "@nestjs/common";
import { LlmProvider, LlmConfigError } from "./llm.types";
import { OpenAiProvider } from "./openai.provider";
import { AnthropicProvider } from "./anthropic.provider";
import { GeminiProvider } from "./gemini.provider";
import { DevTemplateProvider } from "./dev.provider";
import { effectiveLlmConfig, llmFingerprint } from "../../common/platform-config";
import { killSwitches } from "../../common/platform-settings";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveOrgLlmConfig, orgLlmFingerprint } from "./org-llm-config";
import { AiPausedError, guardLlmProvider } from "./llm-guard";

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
  private readonly orgProviders = new Map<string, { fingerprint: string; provider: LlmProvider }>();

  /** Prisma is optional so existing direct constructions
   * (`new LlmFactory()` in specs) keep working — without it,
   * forOrg simply falls back to the platform provider. In the
   * running app PrismaModule is global, so DI always supplies it. */
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** SA-B24 (T3): the kill-switch wrap. When this factory has
   *  a Prisma handle (always, in the running app — PrismaModule
   *  is global), every provider it hands out is wrapped so each
   *  completion first reads the switchboard through the ONE
   *  read path (common/platform-settings killSwitches) and
   *  refuses with AiPausedError while paused — for the org when
   *  the resolution knows it, globally otherwise. This is the
   *  backstop choke point: surfaces with no per-site check of
   *  their own (inbox autopilot compose is the deliberate
   *  example — it was never per-site gated) are still covered,
   *  because every provider they can reach was built here.
   *  A direct `new LlmFactory()` (specs) has no Prisma and
   *  stays unwrapped, exactly as before. The settings read is
   *  defensive (platformSetting swallows errors into "no
   *  setting"), so a read failure never blocks by itself. */
  private wrap(provider: LlmProvider, organizationId?: string): LlmProvider {
    if (!this.prisma) return provider;
    const prisma = this.prisma as any;
    return guardLlmProvider(provider, async () => {
      const ks = await killSwitches(prisma);
      if (ks.aiGloballyPaused) throw new AiPausedError("global");
      if (organizationId && ks.aiDisabledOrgIds.includes(organizationId)) throw new AiPausedError("org");
    });
  }

  /** Effective config = Admin Console setting (Milestone 33) when
   *  present, else the LLM_* env vars. The provider instance is
   *  rebuilt whenever the effective config changes, so an admin
   *  edit takes effect without a restart. */
  getProvider(): LlmProvider {
    const fp = llmFingerprint();
    if (this.provider && this.fingerprint === fp) return this.provider;
    const cfg = effectiveLlmConfig();
    this.provider = this.wrap(buildLlmProvider(cfg.provider, cfg.apiKey, cfg.model));
    this.fingerprint = fp;
    return this.provider;
  }

  /**
   * CC8 — the org-aware resolution: when the organization has its
   * OWN LLM config (OrgLlmConfig, enabled), the tenant's provider
   * + key wins for that org; otherwise the platform resolution
   * (getProvider) applies unchanged. Tenant providers are cached
   * per org and rebuilt when the stored key/provider/model
   * changes (fingerprint = hash of the key, never the key).
   */
  async forOrg(organizationId: string): Promise<LlmProvider> {
    if (!organizationId || !this.prisma) return this.getProvider();
    const creds = await resolveOrgLlmConfig(this.prisma as any, organizationId).catch(() => null);
    // SA-B24: the platform fallback is additionally wrapped
    // with THIS org's pause scope (the shared getProvider()
    // wrap can only know the global flag), so a per-org
    // disable reaches factory consumers on the fallback too.
    if (!creds) return this.wrap(this.getProvider(), organizationId);
    const fp = orgLlmFingerprint(creds);
    const cached = this.orgProviders.get(organizationId);
    if (cached && cached.fingerprint === fp) return cached.provider;
    const provider = this.wrap(buildLlmProvider(creds.provider, creds.apiKey, creds.model), organizationId);
    this.orgProviders.set(organizationId, { fingerprint: fp, provider });
    return provider;
  }
}

/**
 * CC8 — call-site helper for services whose LlmFactory may be a
 * spec fake exposing only getProvider(): use the org-aware path
 * when it exists, else the platform provider, exactly as before.
 */
export async function providerForOrg(llm: any, organizationId: string): Promise<LlmProvider> {
  if (llm && typeof llm.forOrg === "function" && organizationId) return llm.forOrg(organizationId);
  return llm.getProvider();
}
