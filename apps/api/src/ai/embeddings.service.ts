import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { effectiveLlmConfig } from "../common/platform-config";
import { aiPauseReason, killSwitches } from "../common/platform-settings";
import { resolveOrgLlmConfig } from "./llm/org-llm-config";
import { estimateTokens, type FetchFn } from "./llm/llm.types";

/**
 * SA-B2 (Smart AI Phase 0, P2): EmbeddingsService — turns text
 * into vectors through the SAME provider configuration the chat
 * path resolves (per-org OrgLlmConfig first, then the platform
 * Admin/env config — the exact helpers LlmFactory uses, reused,
 * never forked). The org's CHAT model is never reused as an
 * embedding model: embedding models are a separate default per
 * provider, overridable only via the LLM_EMBEDDING_MODEL env var
 * (the admin llmConfig JSON has a fixed {provider, model, apiKey}
 * shape with no embedding field — recorded in the acceptance doc).
 *
 * HONESTY RULES (Master Plan L2 applied to vectors):
 *  - A provider that cannot embed returns a TYPED unavailable
 *    result. Anthropic has no embeddings API; the dev template
 *    adapter is not a real model. In both cases NOTHING is
 *    stored and callers fall back to keyword retrieval, labelled.
 *  - This service NEVER invents, pads or hashes-out a vector.
 *  - It never throws into callers: indexing runs behind document
 *    CRUD and a provider outage must degrade retrieval, not break
 *    saves. Failures come back as { ok: false, reason }.
 *  - The per-org AI kill switch (killSwitches.aiDisabledOrgIds —
 *    the same switch chat enforces) blocks all calls.
 * Usage is recorded in AIUsageRecord with feature "embedding"
 * (the record's feature is a free string; model carries the
 * embedding model name, outputTokens is 0, and `estimated` is
 * true exactly when the provider reported no usage — Gemini's
 * embed endpoint returns none, so its counts are the codebase's
 * labelled estimateTokens heuristic).
 */

export const EMBEDDING_DEFAULT_MODELS: Record<string, string> = {
  openai: "text-embedding-3-small",
  gemini: "gemini-embedding-001",
};

/** Gemini output dimensionality requested so its vectors match
 *  the OpenAI default's 1536 — one dimension per deployment in
 *  practice; rows still record their own dimension regardless. */
export const GEMINI_EMBEDDING_DIMENSIONS = 1536;

const BATCH_SIZE = 100;

export type EmbedResult =
  | {
      ok: true;
      vectors: number[][];
      provider: string;
      model: string;
      dimension: number;
      inputTokens: number;
      tokensEstimated: boolean;
    }
  | { ok: false; reason: string; detail?: string };

export interface ResolvedEmbeddingConfig {
  provider: string;
  apiKey: string;
  model: string;
}

@Injectable()
export class EmbeddingsService {
  /** Injectable fetch for specs (the LlmProvider fetchFn pattern,
   *  as a field so Nest DI construction stays one-argument). */
  fetchFn: FetchFn = fetch;

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /**
   * Resolve the effective embedding config for an org, or a
   * typed reason why embeddings are unavailable. Exposed (not
   * just private) so the indexing service and specs can label
   * sources keyword-only without making a call.
   */
  async resolveConfig(organizationId: string): Promise<{ ok: true; config: ResolvedEmbeddingConfig } | { ok: false; reason: string }> {
    if (!organizationId) return { ok: false, reason: "missing_organization" };
    if (this.prisma) {
      try {
        const ks = await killSwitches(this.prisma as any);
        const pauseReason = aiPauseReason(ks, organizationId);
        if (pauseReason) return { ok: false, reason: pauseReason };
      } catch {
        /* defensive: a settings read failure never blocks by itself */
      }
    }
    let provider = "";
    let apiKey = "";
    if (this.prisma) {
      const orgCreds = await resolveOrgLlmConfig(this.prisma as any, organizationId).catch(() => null);
      if (orgCreds) {
        provider = orgCreds.provider;
        apiKey = orgCreds.apiKey;
      }
    }
    if (!provider) {
      const platform = effectiveLlmConfig();
      provider = platform.provider;
      apiKey = platform.apiKey;
    }
    provider = (provider ?? "").toLowerCase();
    if (provider === "anthropic") return { ok: false, reason: "provider_has_no_embeddings_api" };
    if (provider !== "openai" && provider !== "gemini") return { ok: false, reason: "no_real_llm_provider" };
    if (!apiKey) return { ok: false, reason: "missing_api_key" };
    const model = (process.env.LLM_EMBEDDING_MODEL ?? "").trim() || EMBEDDING_DEFAULT_MODELS[provider];
    return { ok: true, config: { provider, apiKey, model } };
  }

  /** Embed a batch of texts. Vectors come back in input order. */
  async embed(organizationId: string, texts: string[]): Promise<EmbedResult> {
    const inputs = (texts ?? []).map((t) => String(t ?? ""));
    if (!inputs.length) return { ok: false, reason: "empty_input" };
    const resolved = await this.resolveConfig(organizationId);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const { config } = resolved;
    try {
      const vectors: number[][] = [];
      let inputTokens = 0;
      let tokensEstimated = false;
      for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
        const batch = inputs.slice(i, i + BATCH_SIZE);
        const part =
          config.provider === "openai"
            ? await this.embedOpenAi(config, batch)
            : await this.embedGemini(config, batch);
        vectors.push(...part.vectors);
        inputTokens += part.inputTokens;
        tokensEstimated = tokensEstimated || part.tokensEstimated;
      }
      const dimension = vectors[0]?.length ?? 0;
      if (!dimension || vectors.some((v) => v.length !== dimension)) {
        return { ok: false, reason: "request_failed", detail: "provider returned inconsistent vector dimensions" };
      }
      await this.recordUsage(organizationId, config, inputTokens, tokensEstimated);
      return { ok: true, vectors, provider: config.provider, model: config.model, dimension, inputTokens, tokensEstimated };
    } catch (e) {
      return { ok: false, reason: "request_failed", detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async embedOne(organizationId: string, text: string): Promise<EmbedResult> {
    return this.embed(organizationId, [text]);
  }

  private async embedOpenAi(
    config: ResolvedEmbeddingConfig,
    batch: string[],
  ): Promise<{ vectors: number[][]; inputTokens: number; tokensEstimated: boolean }> {
    const res = await this.fetchFn("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, input: batch }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI embeddings request failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
    const rows = [...(body.data ?? [])].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== batch.length) throw new Error("OpenAI embeddings returned a mismatched vector count");
    return {
      vectors: rows.map((r: any) => (r.embedding ?? []).map(Number)),
      inputTokens: body.usage?.prompt_tokens ?? batch.reduce((n, t) => n + estimateTokens(t), 0),
      tokensEstimated: body.usage?.prompt_tokens == null,
    };
  }

  private async embedGemini(
    config: ResolvedEmbeddingConfig,
    batch: string[],
  ): Promise<{ vectors: number[][]; inputTokens: number; tokensEstimated: boolean }> {
    const res = await this.fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:batchEmbedContents`,
      {
        method: "POST",
        headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${config.model}`,
            content: { parts: [{ text }] },
            outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
          })),
        }),
      },
    );
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini embeddings request failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
    const rows = body.embeddings ?? [];
    if (rows.length !== batch.length) throw new Error("Gemini embeddings returned a mismatched vector count");
    // The Gemini embed endpoint reports no token usage: the count
    // is the codebase estimate, labelled estimated (never exact).
    return {
      vectors: rows.map((r: any) => (r.values ?? []).map(Number)),
      inputTokens: batch.reduce((n, t) => n + estimateTokens(t), 0),
      tokensEstimated: true,
    };
  }

  private async recordUsage(
    organizationId: string,
    config: ResolvedEmbeddingConfig,
    inputTokens: number,
    estimated: boolean,
  ): Promise<void> {
    if (!this.prisma) return;
    try {
      await (this.prisma as any).aIUsageRecord?.create?.({
        data: {
          organizationId,
          feature: "embedding",
          provider: config.provider,
          model: config.model,
          inputTokens,
          outputTokens: 0,
          estimated,
        },
      });
    } catch {
      /* usage accounting must never fail an embedding call */
    }
  }
}
