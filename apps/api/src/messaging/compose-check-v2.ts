import { composeCheck, SPAM_WORDS_BN, SPAM_WORDS_EN, ComposeWarning } from "./compose-check";
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
  const warnings = composeCheck({ channel: input.channel, subject: input.subject, body: input.body });
  const checks: ChecklistItem[] = [];
  const allText = `${input.subject ?? ""}\n${input.body}\n${input.htmlBody ?? ""}`;
  const links = [...new Set([...findLinks(input.body), ...findLinks(input.subject ?? ""), ...findLinks(input.htmlBody ?? "")])];

  // 1 — URL format validity: every link found must parse as an
  // absolute http(s) URL. Verifies FORMAT only — it does not
  // fetch any link, so reachability is never claimed.
  if (!links.length) {
    checks.push({ code: "URL_FORMAT", label: "Link format", status: "not_run", detail: "No http(s) links were found in the subject/body/HTML, so there was nothing to validate.", verified: "No links present — nothing was fetched or validated." });
  } else {
    const bad: string[] = [];
    for (const link of links) {
      try {
        const u = new URL(link);
        if (u.protocol !== "http:" && u.protocol !== "https:") bad.push(link);
      } catch { bad.push(link); }
    }
    checks.push(bad.length
      ? { code: "URL_FORMAT", label: "Link format", status: "fail", detail: `${bad.length} of ${links.length} link(s) are not valid absolute http(s) URLs: ${bad.join(", ")}`, verified: `Parsed ${links.length} link(s) with the URL parser (format only — no link was fetched, reachability is not claimed).` }
      : { code: "URL_FORMAT", label: "Link format", status: "pass", detail: `All ${links.length} link(s) parse as valid absolute http(s) URLs.`, verified: `Parsed ${links.length} link(s) with the URL parser (format only — no link was fetched, reachability is not claimed).` });
  }

  // 2 — Links present in the tracked-link set: at send time the
  // engine wraps EVERY http(s) link when tracking is enabled, so
  // the tracked set is exactly the found set; when tracking is
  // off the tracked set is empty and that is said out loud.
  if (!links.length) {
    checks.push({ code: "LINKS_TRACKED", label: "Links tracked", status: "not_run", detail: "No links in the content, so there is no tracked-link set to compare against.", verified: "Compared the content's links against the set the send engine will wrap — no links existed." });
  } else if (!input.linkTrackingEnabled) {
    checks.push({ code: "LINKS_TRACKED", label: "Links tracked", status: "warn", detail: `Link tracking is OFF in Messaging settings: all ${links.length} link(s) will be sent exactly as authored and clicks will not be recorded.`, verified: "Read the org's linkTrackingEnabled setting; the tracked set is empty while it is off." });
  } else {
    checks.push({ code: "LINKS_TRACKED", label: "Links tracked", status: "pass", detail: `All ${links.length} link(s) are in the tracked set: at send time each will gain UTM parameters and the signed redirect wrap (clicks recorded).`, verified: "The send engine wraps every http(s) link in the body when tracking is on — the tracked set equals the found set by construction." });
  }

  // 3 — Missing/empty variables over a recipient sample.
  const varKeys = extractVariableKeys(allText);
  if (!varKeys.length) {
    checks.push({ code: "VARIABLES_SAMPLE", label: "Variables filled (sample)", status: "pass", detail: "The content uses no {{variables}}, so no recipient can receive an empty substitution.", verified: "Scanned subject/body/HTML for {{variable}} placeholders — none found." });
  } else if (!input.sampleVars || !input.sampleVars.length) {
    checks.push({ code: "VARIABLES_SAMPLE", label: "Variables filled (sample)", status: "not_run", detail: `The content uses ${varKeys.join(", ")}, but no recipient sample was available (the audience resolved to nobody, or no audience was supplied), so fill could not be checked.`, verified: "Not run — no real recipient sample existed to render against." });
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
      ? { code: "VARIABLES_SAMPLE", label: "Variables filled (sample)", status: "warn", detail: `In a sample of ${sampleVars.length} real recipient(s), these variables render EMPTY: ${empties.map(([k, n]) => `{{${k}}} (${n}/${sampleVars.length})`).join(", ")}. Those recipients would receive the message with that part blank — nothing is invented to fill it.`, verified: `Rendered each variable against the real per-recipient vars of ${sampleVars.length} sampled recipient(s) (the same vars a send builds).` }
      : { code: "VARIABLES_SAMPLE", label: "Variables filled (sample)", status: "pass", detail: `All variables (${varKeys.join(", ")}) render non-empty for every one of the ${sampleVars.length} sampled recipient(s). Recipients outside the sample were not checked.`, verified: `Rendered each variable against the real per-recipient vars of ${sampleVars.length} sampled recipient(s).` });
  }

  // 4 — Image size, only where asset metadata exists.
  const images = extractImageUrls(input);
  if (!images.length) {
    checks.push({ code: "IMAGE_SIZE", label: "Image size", status: "not_run", detail: "No image URLs were found in the HTML/body, so there was no image to size-check.", verified: "Scanned the HTML for <img> tags and the body for image-file links — none found." });
  } else {
    const withMeta = (input.imageAssets ?? []).filter((a) => images.includes(a.url) && typeof a.sizeBytes === "number");
    if (!withMeta.length) {
      checks.push({ code: "IMAGE_SIZE", label: "Image size", status: "not_run", detail: `${images.length} image(s) found, but no size metadata is stored for them anywhere in this system (product/catalog rows carry only the image URL, never byte size), so sizes could not be verified and no image was fetched to measure it.`, verified: "Not run — no asset metadata exists for these images; fetching them to measure would be a network claim this check does not make." });
    } else {
      const big = withMeta.filter((a) => (a.sizeBytes ?? 0) > IMAGE_SIZE_WARN_BYTES);
      checks.push(big.length
        ? { code: "IMAGE_SIZE", label: "Image size", status: "warn", detail: `${big.length} image(s) exceed 1 MB by their stored metadata: ${big.map((a) => `${a.url} (${a.sizeBytes} bytes)`).join(", ")}. Large images slow email loading and can trigger clipping.`, verified: `Compared stored size metadata for ${withMeta.length} of ${images.length} image(s) against the 1 MB threshold.` }
        : { code: "IMAGE_SIZE", label: "Image size", status: "pass", detail: `All ${withMeta.length} image(s) with stored size metadata are at or under 1 MB. ${images.length - withMeta.length > 0 ? `${images.length - withMeta.length} image(s) had no metadata and were not checked.` : ""}`.trim(), verified: `Compared stored size metadata for ${withMeta.length} image(s) against the 1 MB threshold.` });
    }
  }

  // 5 — Spam-word heuristic with the org-visible word list.
  const spamWarning = warnings.find((w) => w.code === "SPAM_WORD");
  checks.push(spamWarning
    ? { code: "SPAM_HEURISTIC", label: "Spam words (heuristic)", status: "warn", detail: spamWarning.message, verified: "HEURISTIC ONLY: matched the content against the fixed word list below (the MS5 list). It predicts nothing about any provider's filter — no deliverability guarantee is made." }
    : { code: "SPAM_HEURISTIC", label: "Spam words (heuristic)", status: "pass", detail: "No word from the spam-word list below appears in the subject/body.", verified: "HEURISTIC ONLY: matched the content against the fixed word list below (the MS5 list). A pass means only that none of these listed words matched — it is not a deliverability guarantee." });

  return {
    checks,
    warnings,
    spamWords: {
      en: [...SPAM_WORDS_EN], bn: [...SPAM_WORDS_BN],
      label: "Heuristic word list (org-visible) — matching these words is a risk hint, not a provider verdict.",
    },
  };
}
