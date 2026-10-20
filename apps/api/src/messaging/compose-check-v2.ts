import { composeCheck, SPAM_WORDS_BN, SPAM_WORDS_EN, ComposeWarning } from "./compose-check";
import { catalogText, normalizeApiLocale, type ApiLocale } from "../i18n/catalog/send-locale";
import { findLinks } from "./link-tracking";
import { renderTemplate } from "./render";

/**
 * MX15 — pre-send checklist v2. EXTENDS the MS5 compose-check
 * (its warnings are included verbatim via composeCheck — there
 * is no second validator) with checks that can honestly run at
 * compose time. Every check states what it actually verified;
 * a check that cannot run reports status "not_run" WITH the
 * reason — never a silent pass. Pure + spec-pinned.
 */

export interface ChecklistItem {
  code: string;
  label: string;
  status: "pass" | "warn" | "fail" | "not_run";
  detail: string;
  verified: string;
}

export interface ComposeCheckV2Input {
  channel: string;
  subject?: string;
  body: string;
  htmlBody?: string | null;
  /** Whether broadcast link tracking is on for the org (MS5
   * setting). False = links go out exactly as authored. */
  linkTrackingEnabled: boolean;
  /** Recipient sample vars (real rows, built by the same
   * buildSnapshotVars a send uses). Null/empty = no sample was
   * available, so the variable check cannot run. */
  sampleVars?: Record<string, unknown>[] | null;
  /** Image assets WITH size metadata, when any system actually
   * holds it. This codebase stores no image byte sizes (product
   * rows carry only imageUrl), so the service passes [] and the
   * image check reports not_run with that reason. */
  imageAssets?: { url: string; sizeBytes?: number | null }[];
  /** MB4: checklist language (default bn — the platform default). */
  locale?: string;
}

export const IMAGE_SIZE_WARN_BYTES = 1024 * 1024;

export function extractVariableKeys(text: string): string[] {
  const keys = new Set<string>();
  for (const m of String(text ?? "").matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) keys.add(m[1]);
  return [...keys];
}

export function extractImageUrls(input: { body: string; htmlBody?: string | null }): string[] {
  const urls = new Set<string>();
  const html = String(input.htmlBody ?? "");
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) urls.add(m[1]);
  for (const link of findLinks(String(input.body ?? ""))) {
    if (/\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(link)) urls.add(link);
  }
  return [...urls];
}

export function composeCheckV2(input: ComposeCheckV2Input): {
  checks: ChecklistItem[];
  warnings: ComposeWarning[];
  spamWords: { en: string[]; bn: string[]; label: string };
} {
  const locale: ApiLocale = normalizeApiLocale(input.locale);
  const warnings = composeCheck({ channel: input.channel, subject: input.subject, body: input.body }, locale);
  const checks: ChecklistItem[] = [];
  const allText = `${input.subject ?? ""}\n${input.body}\n${input.htmlBody ?? ""}`;
  const links = [...new Set([...findLinks(input.body), ...findLinks(input.subject ?? ""), ...findLinks(input.htmlBody ?? "")])];

  // 1 — URL format validity: every link found must parse as an
  // absolute http(s) URL. Verifies FORMAT only — it does not
  // fetch any link, so reachability is never claimed.
  if (!links.length) {
    checks.push({ code: "URL_FORMAT", label: catalogText("messaging.checkUrlLabel", locale), status: "not_run", detail: catalogText("messaging.checkUrlNone", locale), verified: catalogText("messaging.checkUrlNoneVerified", locale) });
  } else {
    const bad: string[] = [];
    for (const link of links) {
      try {
        const u = new URL(link);
        if (u.protocol !== "http:" && u.protocol !== "https:") bad.push(link);
      } catch { bad.push(link); }
    }
    checks.push(bad.length
      ? { code: "URL_FORMAT", label: catalogText("messaging.checkUrlLabel", locale), status: "fail", detail: catalogText("messaging.checkUrlBad", locale, { bad: bad.length, total: links.length, list: bad.join(", ") }), verified: catalogText("messaging.checkUrlParsedVerified", locale, { total: links.length }) }
      : { code: "URL_FORMAT", label: catalogText("messaging.checkUrlLabel", locale), status: "pass", detail: catalogText("messaging.checkUrlOk", locale, { total: links.length }), verified: catalogText("messaging.checkUrlParsedVerified", locale, { total: links.length }) });
  }

  // 2 — Links present in the tracked-link set: at send time the
  // engine wraps EVERY http(s) link when tracking is enabled, so
  // the tracked set is exactly the found set; when tracking is
  // off the tracked set is empty and that is said out loud.
  if (!links.length) {
    checks.push({ code: "LINKS_TRACKED", label: catalogText("messaging.checkLinksLabel", locale), status: "not_run", detail: catalogText("messaging.checkLinksNone", locale), verified: catalogText("messaging.checkLinksNoneVerified", locale) });
  } else if (!input.linkTrackingEnabled) {
    checks.push({ code: "LINKS_TRACKED", label: catalogText("messaging.checkLinksLabel", locale), status: "warn", detail: catalogText("messaging.checkLinksOff", locale, { total: links.length }), verified: catalogText("messaging.checkLinksOffVerified", locale) });
  } else {
    checks.push({ code: "LINKS_TRACKED", label: catalogText("messaging.checkLinksLabel", locale), status: "pass", detail: catalogText("messaging.checkLinksOk", locale, { total: links.length }), verified: catalogText("messaging.checkLinksOkVerified", locale) });
  }

  // 3 — Missing/empty variables over a recipient sample.
  const varKeys = extractVariableKeys(allText);
  if (!varKeys.length) {
    checks.push({ code: "VARIABLES_SAMPLE", label: catalogText("messaging.checkVarsLabel", locale), status: "pass", detail: catalogText("messaging.checkVarsNone", locale), verified: catalogText("messaging.checkVarsNoneVerified", locale) });
  } else if (!input.sampleVars || !input.sampleVars.length) {
    checks.push({ code: "VARIABLES_SAMPLE", label: catalogText("messaging.checkVarsLabel", locale), status: "not_run", detail: catalogText("messaging.checkVarsNotRun", locale, { keys: varKeys.join(", ") }), verified: catalogText("messaging.checkVarsNotRunVerified", locale) });
  } else {
    const sampleVars: Record<string, unknown>[] = input.sampleVars;
    const emptyByKey = new Map<string, number>();
    for (const vars of sampleVars) {
      for (const key of varKeys) {
        const rendered = renderTemplate(`{{${key}}}`, vars ?? {});
        if (!rendered.trim()) emptyByKey.set(key, (emptyByKey.get(key) ?? 0) + 1);
      }
    }
    const empties = [...emptyByKey.entries()];
    checks.push(empties.length
      ? { code: "VARIABLES_SAMPLE", label: catalogText("messaging.checkVarsLabel", locale), status: "warn", detail: catalogText("messaging.checkVarsEmpty", locale, { sample: sampleVars.length, empties: empties.map(([k, n]) => `{{${k}}} (${n}/${sampleVars.length})`).join(", ") }), verified: catalogText("messaging.checkVarsEmptyVerified", locale, { sample: sampleVars.length }) }
      : { code: "VARIABLES_SAMPLE", label: catalogText("messaging.checkVarsLabel", locale), status: "pass", detail: catalogText("messaging.checkVarsOk", locale, { keys: varKeys.join(", "), sample: sampleVars.length }), verified: catalogText("messaging.checkVarsOkVerified", locale, { sample: sampleVars.length }) });
  }

  // 4 — Image size, only where asset metadata exists.
  const images = extractImageUrls(input);
  if (!images.length) {
    checks.push({ code: "IMAGE_SIZE", label: catalogText("messaging.checkImageLabel", locale), status: "not_run", detail: catalogText("messaging.checkImageNone", locale), verified: catalogText("messaging.checkImageNoneVerified", locale) });
  } else {
    const withMeta = (input.imageAssets ?? []).filter((a) => images.includes(a.url) && typeof a.sizeBytes === "number");
    if (!withMeta.length) {
      checks.push({ code: "IMAGE_SIZE", label: catalogText("messaging.checkImageLabel", locale), status: "not_run", detail: catalogText("messaging.checkImageNoMeta", locale, { images: images.length }), verified: catalogText("messaging.checkImageNoMetaVerified", locale) });
    } else {
      const big = withMeta.filter((a) => (a.sizeBytes ?? 0) > IMAGE_SIZE_WARN_BYTES);
      checks.push(big.length
        ? { code: "IMAGE_SIZE", label: catalogText("messaging.checkImageLabel", locale), status: "warn", detail: catalogText("messaging.checkImageBig", locale, { big: big.length, list: big.map((a) => `${a.url} (${a.sizeBytes} bytes)`).join(", ") }), verified: catalogText("messaging.checkImageBigVerified", locale, { withMeta: withMeta.length, images: images.length }) }
        : { code: "IMAGE_SIZE", label: catalogText("messaging.checkImageLabel", locale), status: "pass", detail: catalogText("messaging.checkImageOk", locale, { withMeta: withMeta.length, unchecked: images.length - withMeta.length > 0 ? catalogText("messaging.checkImageUncheckedSuffix", locale, { count: images.length - withMeta.length }) : "" }).trim(), verified: catalogText("messaging.checkImageOkVerified", locale, { withMeta: withMeta.length }) });
    }
  }

  // 5 — Spam-word heuristic with the org-visible word list.
  const spamWarning = warnings.find((w) => w.code === "SPAM_WORD");
  checks.push(spamWarning
    ? { code: "SPAM_HEURISTIC", label: catalogText("messaging.checkSpamLabel", locale), status: "warn", detail: spamWarning.message, verified: catalogText("messaging.checkSpamWarnVerified", locale) }
    : { code: "SPAM_HEURISTIC", label: catalogText("messaging.checkSpamLabel", locale), status: "pass", detail: catalogText("messaging.checkSpamPass", locale), verified: catalogText("messaging.checkSpamPassVerified", locale) });

  return {
    checks,
    warnings,
    spamWords: {
      en: [...SPAM_WORDS_EN], bn: [...SPAM_WORDS_BN],
      label: catalogText("messaging.spamListLabel", locale),
    },
  };
}
