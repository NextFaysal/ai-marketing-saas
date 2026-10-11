import { ImageConfigError, ImageProvider } from "./image.types";
import { GeminiImageProvider } from "./gemini-image.provider";
import { effectiveImageConfig } from "../../common/platform-config";

/** Build an image provider from an explicit config. No silent
 *  fallbacks — an empty name is a configuration error here; the
 *  resolver below decides "not configured" before calling this. */
export function buildImageProvider(name: string, apiKey: string, model?: string): ImageProvider {
  const normalized = (name ?? "").toLowerCase();
  if (normalized === "") throw new ImageConfigError("No image provider configured");
  if (normalized === "gemini") return new GeminiImageProvider(apiKey, model);
  throw new ImageConfigError(`Unknown image provider: ${name} (expected gemini)`);
}

/** Resolve the effective image provider (admin → env). Returns
 *  null when nothing usable is configured — callers surface the
 *  honest "not configured" message instead of faking a result. */
export function resolveImageProvider(): { provider: ImageProvider; providerName: string; model?: string; source: string } | null {
  const cfg = effectiveImageConfig();
  if (!cfg.provider || !cfg.apiKey) return null;
  const provider = buildImageProvider(cfg.provider, cfg.apiKey, cfg.model);
  return { provider, providerName: cfg.provider, model: cfg.model, source: cfg.source };
}
