import { detectedLanguageInstruction, type DetectedLanguage } from "../inbox/in7-ai";

/**
 * SA-B9 (Smart AI Phase 1, R3): the ONE reply-quality layer.
 *
 * Before R3 every compose path carried its own copy of the
 * language decision and the style rendering, and they had
 * drifted apart (SA-B9 Step-0 matrix, docs/smart-ai-b9-
 * acceptance.md):
 *  - the inbox autopilot: org setting -> detected, no memory
 *    step at all;
 *  - suggestDraft: org setting only — no detected fallback,
 *    no memory fallback;
 *  - the comment compose: org setting -> detected -> memory;
 *  - the order bot inherited the autopilot's copy.
 * This module is now the single place that decides (a) which
 * language a reply is written in and (b) the shared quality
 * block every customer-facing compose prompt carries —
 * language directive, natural-writing rules, the honesty
 * restatement, and the SA-B5 styleInstructions rendered under
 * the one established label. Path-specific instructions
 * (order steps, comment publicness/length, draft-only-return)
 * stay at the call sites; the QUALITY rules live here only.
 *
 * LANGUAGE PRECEDENCE (one resolver, every channel):
 *  1. an explicit per-call override (the CX2 Instructions
 *     Desk test seam — a test must show what the given
 *     instructions would compose);
 *  2. the org's explicit aiReplyLanguage ("bn" | "en") — an
 *     owner standing instruction, the same class as
 *     ownerInstructions; the shipped IN7 rule ("an explicit
 *     owner override always wins", in7-ai.ts; spec'd in
 *     in7-ai.spec.ts) — the plan brief for this batch listed
 *     detection above the org setting, and this rung is the
 *     ONE recorded deviation: demoting an explicit owner
 *     instruction below a script-ratio heuristic would make
 *     the product disobey its owner and break the shipped
 *     spec; the brief's chain governs every case the owner
 *     has NOT pinned;
 *  3. the customer's detected language from their latest
 *     message (detectReplyLanguage — deterministic, no model
 *     call);
 *  4. the customer's remembered language preference
 *     (CustomerMemory.languagePref — own_customer contexts);
 *  5. default "bn" (the platform's home-market default).
 * "auto" / null org settings are not instructions and fall
 * through. "mixed" is reachable only through detection — an
 * org setting or a memory preference is always bn or en.
 */

export type ReplyLanguage = "bn" | "en" | "mixed";
export type ReplyLanguageSource = "override" | "org" | "detected" | "memory" | "default";

export interface ResolvedReplyLanguage {
  language: ReplyLanguage;
  source: ReplyLanguageSource;
}

const pinned = (v: string | null | undefined): "bn" | "en" | null =>
  v === "bn" ? "bn" : v === "en" ? "en" : null;

export function resolveReplyLanguage(input: {
  /** Explicit per-call override (Desk test seam). */
  override?: string | null;
  /** BusinessProfile.aiReplyLanguage: "bn" | "en" | "auto" | null. */
  orgReplyLanguage?: string | null;
  /** detectReplyLanguage(customer's latest message). */
  detected?: DetectedLanguage | null;
  /** CustomerMemory.languagePref (own_customer contexts). */
  memoryLanguagePref?: string | null;
}): ResolvedReplyLanguage {
  const override = pinned(input.override);
  if (override) return { language: override, source: "override" };
  const org = pinned(input.orgReplyLanguage);
  if (org) return { language: org, source: "org" };
  if (input.detected) return { language: input.detected, source: "detected" };
  const memory = pinned(input.memoryLanguagePref);
  if (memory) return { language: memory, source: "memory" };
  return { language: "bn", source: "default" };
}

/**
 * The ONE rendering of a resolved language as a prompt line.
 * The strings are the established ones — the detected lines
 * are in7-ai's own (spec-pinned), the pinned lines are the
 * "Always reply in …" lines the paths already emitted, and
 * the memory line is SA-B8's comment wording — so unifying
 * the DECISION does not churn the wording any path already
 * produced for the same situation.
 */
export function replyLanguageDirective(resolved: ResolvedReplyLanguage): string {
  if (resolved.source === "detected") {
    return detectedLanguageInstruction(resolved.language) ?? "Always reply in Bengali.";
  }
  if (resolved.source === "memory") {
    return `This customer usually writes in ${resolved.language === "en" ? "English" : "Bengali"} — reply in that language.`;
  }
  return resolved.language === "en" ? "Always reply in English." : "Always reply in Bengali.";
}

/** The stable header line of the shared quality block — the
 * marker specs (and future surfaces) recognise the block by. */
export const REPLY_QUALITY_MARKER = "Reply quality (shared rules):";

/**
 * The shared quality section of a compose prompt: the language
 * directive, the natural-writing rules, the honesty
 * restatement (the grounding law in prompt form), and — when
 * an ACTIVE learned voice profile exists — the Brain's
 * styleInstructions under the one SA-B5 label every path
 * already used; SA-B22 appends the Brain's platformGuidance
 * (Admin Training Console teaching) verbatim after it, last
 * and lowest-precedence (D8). Deliberately channel-invariant: what differs
 * per channel (publicness, length caps, order steps) is
 * genuinely path-specific and stays at the call sites. With
 * no styleInstructions the block is exactly the marker +
 * three rule lines — no empty style artefact.
 */
export function buildReplyQualityBlock(input: {
  language: ResolvedReplyLanguage;
  styleInstructions?: string | null;
  /** SA-B22 (T1): the Brain's platformGuidance block (Admin
   * Training Console teaching), pre-rendered under its yield
   * heading by OrgBrainService. Transported verbatim, after the
   * shop's own style guidance — the last, lowest-precedence
   * guidance in the block (D8). */
  platformGuidance?: string | null;
  channel: "inbox" | "comment" | "draft" | "order_bot";
}): string[] {
  void input.channel; // channel-invariant by design (see header)
  const lines: string[] = [
    REPLY_QUALITY_MARKER,
    replyLanguageDirective(input.language),
    "Write naturally, like a helpful person in a real conversation: short, clear sentences. Do not repeat the customer's name or the product name in every line, and do not open every reply with the same template phrase.",
    "Never invent offers, discounts, deadlines or promises — say only what the verified facts support. When the facts do not cover something, say the team will confirm instead of guessing.",
  ];
  if (input.styleInstructions) {
    lines.push("", `Style guidance from the shop's learned brand voice (shapes WORDING ONLY — never facts, prices or promises): ${String(input.styleInstructions).slice(0, 1200)}`);
  }
  if (input.platformGuidance) {
    lines.push("", String(input.platformGuidance).slice(0, 2400));
  }
  return lines;
}
