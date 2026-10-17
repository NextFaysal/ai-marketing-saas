import {
  REPLY_QUALITY_MARKER,
  buildReplyQualityBlock,
  replyLanguageDirective,
  resolveReplyLanguage,
} from "./reply-quality";

/**
 * SA-B9 (Smart AI Phase 1, R3): the shared reply-quality
 * layer — pure unit proofs.
 *
 * The resolver's precedence is: per-call override -> the org's
 * explicit aiReplyLanguage (bn/en) -> detected -> remembered
 * preference -> Bengali default. The org rung above detection
 * is the recorded reconciliation with the batch brief: an
 * explicit owner language is a standing owner instruction,
 * and the shipped IN7 rule specs that it wins (in7-ai.spec.ts
 * "owner override (en) wins over a Bengali customer message").
 * Everything the owner has NOT pinned follows the brief's
 * chain exactly.
 */
describe("SA-B9 resolveReplyLanguage — one precedence, every channel", () => {
  it("per-call override beats org, detected and memory", () => {
    expect(resolveReplyLanguage({ override: "en", orgReplyLanguage: "bn", detected: "bn", memoryLanguagePref: "bn" }))
      .toEqual({ language: "en", source: "override" });
    expect(resolveReplyLanguage({ override: "bn", orgReplyLanguage: "en", detected: "en" }))
      .toEqual({ language: "bn", source: "override" });
  });

  it("the org's explicit bn/en beats detection (the shipped IN7 owner rule)", () => {
    expect(resolveReplyLanguage({ orgReplyLanguage: "en", detected: "bn", memoryLanguagePref: "bn" }))
      .toEqual({ language: "en", source: "org" });
    expect(resolveReplyLanguage({ orgReplyLanguage: "bn", detected: "en" }))
      .toEqual({ language: "bn", source: "org" });
  });

  it("\"auto\" / null org settings are not instructions — detection decides", () => {
    expect(resolveReplyLanguage({ orgReplyLanguage: "auto", detected: "en" })).toEqual({ language: "en", source: "detected" });
    expect(resolveReplyLanguage({ orgReplyLanguage: null, detected: "bn" })).toEqual({ language: "bn", source: "detected" });
    expect(resolveReplyLanguage({ orgReplyLanguage: null, detected: "mixed" })).toEqual({ language: "mixed", source: "detected" });
  });

  it("remembered preference applies when nothing is pinned and nothing is detected", () => {
    expect(resolveReplyLanguage({ orgReplyLanguage: "auto", detected: null, memoryLanguagePref: "en" }))
      .toEqual({ language: "en", source: "memory" });
    expect(resolveReplyLanguage({ detected: null, memoryLanguagePref: "bn" }))
      .toEqual({ language: "bn", source: "memory" });
  });

  it("detected beats memory (the customer's current words outrank their history)", () => {
    expect(resolveReplyLanguage({ detected: "en", memoryLanguagePref: "bn" })).toEqual({ language: "en", source: "detected" });
  });

  it("Bengali is the default when nothing resolves; junk values never pin", () => {
    expect(resolveReplyLanguage({})).toEqual({ language: "bn", source: "default" });
    expect(resolveReplyLanguage({ orgReplyLanguage: "fr", detected: null, memoryLanguagePref: "fr" }))
      .toEqual({ language: "bn", source: "default" });
    expect(resolveReplyLanguage({ override: "mixed", orgReplyLanguage: null, detected: null }))
      .toEqual({ language: "bn", source: "default" });
  });
});

describe("SA-B9 replyLanguageDirective — the established wordings, one renderer", () => {
  it("detected lines are in7-ai's own (spec-pinned strings)", () => {
    expect(replyLanguageDirective({ language: "bn", source: "detected" }))
      .toBe("Always reply in Bengali (the customer's last message is mainly in Bengali).");
    expect(replyLanguageDirective({ language: "en", source: "detected" }))
      .toBe("Always reply in English (the customer's last message is mainly in English).");
    expect(replyLanguageDirective({ language: "mixed", source: "detected" }))
      .toBe("Reply in the same mix of Bengali and English (Banglish) as the customer's last message.");
  });

  it("pinned lines (override / org / default) are the plain forced lines", () => {
    expect(replyLanguageDirective({ language: "bn", source: "org" })).toBe("Always reply in Bengali.");
    expect(replyLanguageDirective({ language: "en", source: "override" })).toBe("Always reply in English.");
    expect(replyLanguageDirective({ language: "bn", source: "default" })).toBe("Always reply in Bengali.");
  });

  it("memory lines are SA-B8's wording", () => {
    expect(replyLanguageDirective({ language: "bn", source: "memory" }))
      .toBe("This customer usually writes in Bengali — reply in that language.");
    expect(replyLanguageDirective({ language: "en", source: "memory" }))
      .toBe("This customer usually writes in English — reply in that language.");
  });
});

describe("SA-B9 buildReplyQualityBlock — one block, no artefacts", () => {
  it("marker + language + natural-writing + honesty, in that order", () => {
    const block = buildReplyQualityBlock({ language: { language: "bn", source: "detected" }, channel: "inbox" });
    expect(block[0]).toBe(REPLY_QUALITY_MARKER);
    expect(block[1]).toContain("Always reply in Bengali");
    expect(block[2]).toContain("Write naturally");
    expect(block[3]).toContain("Never invent offers, discounts, deadlines or promises");
  });

  it("an active voice profile's style rides inside the block under the SA-B5 label", () => {
    const style = "Owner's brand voice — standing instruction; it takes precedence over the learned style below wherever they conflict:\nসর্বদা আপনি বলে সম্বোধন করবেন।\nLearned style from the shop's own replies (applies only where it does not conflict with the owner's text above):\nTone: friendly";
    const block = buildReplyQualityBlock({ language: { language: "en", source: "org" }, styleInstructions: style, channel: "comment" });
    const joined = block.join("\n");
    expect(joined).toContain("Style guidance from the shop's learned brand voice (shapes WORDING ONLY — never facts, prices or promises): ");
    expect(joined).toContain("সর্বদা আপনি বলে সম্বোধন করবেন।");
    expect(joined).toContain("Tone: friendly");
  });

  it("no voice profile -> exactly the four rule lines, no style artefact, no empty lines", () => {
    const block = buildReplyQualityBlock({ language: { language: "bn", source: "default" }, styleInstructions: null, channel: "draft" });
    expect(block).toHaveLength(4);
    expect(block.join("\n")).not.toContain("Style guidance");
    expect(block.every((l) => l.trim().length > 0)).toBe(true);
  });

  it("the block is channel-invariant (path rules live at the call sites)", () => {
    const input = { language: { language: "mixed", source: "detected" } as const, styleInstructions: "Tone: friendly" };
    expect(buildReplyQualityBlock({ ...input, channel: "inbox" }))
      .toEqual(buildReplyQualityBlock({ ...input, channel: "comment" }));
    expect(buildReplyQualityBlock({ ...input, channel: "draft" }))
      .toEqual(buildReplyQualityBlock({ ...input, channel: "order_bot" }));
  });
});
