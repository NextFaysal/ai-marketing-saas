/**
 * ML10 (Multi-Language MB4) — API message catalog core renderer.
 *
 * Laws (Master Plan §২ / ML-L6): the catalog is the single source
 * for API user-visible message text; every entry carries bn + en;
 * an unknown locale falls back to bn; a missing key falls back to
 * the bn text and logs a warning (never a silent blank, never a
 * thrown error from the renderer itself).
 *
 * Param syntax is `{{name}}` — the API's existing render
 * convention (messaging/render.ts, ON5; decision D-MB4-10).
 */
import { Logger } from "@nestjs/common";
import { MESSAGE_CATALOG, type CatalogEntry } from "./catalog";

export type ApiLocale = "bn" | "en";
export const API_LOCALES: readonly ApiLocale[] = ["bn", "en"];
export const DEFAULT_API_LOCALE: ApiLocale = "bn";

const logger = new Logger("ApiI18n");

/** Anything that is not exactly "en" resolves to bn (ML-L6). */
export function normalizeApiLocale(value: unknown): ApiLocale {
  return value === "en" ? "en" : "bn";
}

export function hasCatalogCode(code: unknown): code is string {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(MESSAGE_CATALOG, code);
}

export function catalogEntry(code: string): CatalogEntry | undefined {
  return MESSAGE_CATALOG[code];
}

/** Placeholder names (`{{name}}`) declared by a template string. */
export function placeholdersOf(template: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Render a catalog message. Missing locale text → bn text;
 * missing key entirely → warn + return the code itself (visible
 * in logs/UI as a bug marker, never a crash). A param that is not
 * supplied keeps its `{{placeholder}}` so the gap is visible.
 */
export function renderMessage(
  locale: unknown,
  code: string,
  params?: Record<string, unknown> | null,
): string {
  const loc = normalizeApiLocale(locale);
  const entry = MESSAGE_CATALOG[code];
  if (!entry) {
    logger.warn(`Missing catalog key "${code}" (locale ${loc})`);
    return code;
  }
  let text = entry[loc];
  if (typeof text !== "string" || text.length === 0) {
    logger.warn(`Catalog key "${code}" has no ${loc} text — bn fallback`);
    text = entry.bn;
  }
  if (!params) return text;
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? "") : whole,
  );
}
