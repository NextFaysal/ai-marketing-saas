import { describe, expect, it } from "vitest";
import {
  approvalAllowsVisibilityChoice,
  approvalTargetText,
  answerStatusLabel,
  brandVoiceStatusText,
  canDeleteLearning,
  canWriteLearning,
  coverageAreaLabel,
  defaultApprovalVisibility,
  invalidReasonLabel,
  languagePrefLabel,
  learnedKindLabel,
  learnedSourceLabel,
  learningStateText,
  previewText,
  unansweredReasonLabel,
  voiceTraitLines,
} from "./ai-learning";

/**
 * SA-B6 (P9): the Learn Dashboard's label layer — every mapping
 * is deterministic and total: known API vocabulary becomes plain
 * Bengali; anything unknown falls back to the raw value so the
 * UI can never silently hide a state it does not recognise.
 */
describe("roles mirror the API discipline", () => {
  it("writes: OWNER/ADMIN/MARKETING_MANAGER; deletes: OWNER/ADMIN only", () => {
    expect(canWriteLearning("OWNER")).toBe(true);
    expect(canWriteLearning("ADMIN")).toBe(true);
    expect(canWriteLearning("MARKETING_MANAGER")).toBe(true);
    expect(canWriteLearning("SUPPORT_AGENT")).toBe(false);
    expect(canWriteLearning("")).toBe(false);
    expect(canWriteLearning(null)).toBe(false);
    expect(canDeleteLearning("OWNER")).toBe(true);
    expect(canDeleteLearning("ADMIN")).toBe(true);
    expect(canDeleteLearning("MARKETING_MANAGER")).toBe(false);
  });
});

describe("learned item labels + approval mapping mirror SA-B4", () => {
  it("kind/source labels", () => {
    expect(learnedKindLabel("faq_pair")).toBe("প্রশ্নোত্তর");
    expect(learnedKindLabel("fact")).toBe("তথ্য");
    expect(learnedKindLabel("product_note")).toBe("পণ্যের নোট");
    expect(learnedSourceLabel("conversation")).toContain("কথোপকথন");
    expect(learnedSourceLabel("performance")).toContain("পারফরম্যান্স");
    expect(learnedKindLabel("mystery")).toBe("mystery");
  });
  it("approval target text follows the service mapping", () => {
    expect(approvalTargetText({ kind: "faq_pair", sourceType: "conversation" })).toContain("উত্তর ভান্ডারে");
    expect(approvalTargetText({ kind: "product_note", sourceType: "product" })).toContain("অভ্যন্তরীণ নোট");
    expect(approvalTargetText({ kind: "fact", sourceType: "performance" })).toContain("অভ্যন্তরীণ তথ্য");
    expect(approvalTargetText({ kind: "fact", sourceType: "website" })).toContain("জ্ঞান ডকুমেন্ট");
  });
  it("visibility choice exists only for plain non-performance facts; defaults match the API", () => {
    expect(approvalAllowsVisibilityChoice({ kind: "fact", sourceType: "website" })).toBe(true);
    expect(approvalAllowsVisibilityChoice({ kind: "fact", sourceType: "performance" })).toBe(false);
    expect(approvalAllowsVisibilityChoice({ kind: "faq_pair", sourceType: "conversation" })).toBe(false);
    expect(defaultApprovalVisibility({ kind: "fact", sourceType: "website" })).toBe("public");
    expect(defaultApprovalVisibility({ kind: "fact", sourceType: "conversation" })).toBe("internal");
    expect(defaultApprovalVisibility({ kind: "fact", sourceType: "performance" })).toBe("internal");
    expect(defaultApprovalVisibility({ kind: "product_note", sourceType: "product" })).toBe("internal");
  });
});

describe("answer store labels", () => {
  it("status + the full SA-B3 invalidation vocabulary", () => {
    expect(answerStatusLabel("active")).toBe("চালু");
    expect(answerStatusLabel("invalidated")).toContain("বাতিল");
    for (const r of ["source_doc_changed", "source_doc_removed", "source_doc_reclassified", "source_policy_changed", "source_policy_removed", "source_profile_changed", "product_unavailable", "product_changed", "live_facts_changed", "number_guard_failed"]) {
      expect(invalidReasonLabel(r)).not.toBe(r);
      expect(invalidReasonLabel(r).length).toBeGreaterThan(0);
    }
    expect(invalidReasonLabel("some_future_reason")).toBe("some_future_reason");
    expect(invalidReasonLabel(null)).toBe("");
  });
});

describe("voice traits in plain language", () => {
  it("closed vocabularies map; verbatim phrases are quoted; unknown values stay visible", () => {
    const lines = voiceTraitLines({ formality: "friendly", emojiUse: "light", languageMix: "bn", avgSentence: "short", greetingStyle: "আসসালামু আলাইকুম", signaturePhrases: ["ধন্যবাদ"] });
    expect(lines).toContain("বন্ধুসুলভ ভঙ্গিতে কথা বলে");
    expect(lines).toContain("মাঝে মাঝে ইমোজি ব্যবহার করে");
    expect(lines).toContain("মূলত বাংলায় লেখে");
    expect(lines.some((l) => l.includes("আসসালামু আলাইকুম"))).toBe(true);
    expect(lines.some((l) => l.includes("ধন্যবাদ"))).toBe(true);
    expect(voiceTraitLines({ formality: "weird" })).toEqual(["ভঙ্গি: weird"]);
    expect(voiceTraitLines(null)).toEqual([]);
  });
  it("status text", () => {
    expect(brandVoiceStatusText("active", false)).toBe("চালু আছে");
    expect(brandVoiceStatusText("active", true)).toContain("অপেক্ষমাণ");
    expect(brandVoiceStatusText("suggested", false)).toContain("প্রস্তাব");
    expect(brandVoiceStatusText("none", false)).toContain("শেখা হয়নি");
  });
});

describe("misc labels", () => {
  it("coverage areas, learning state, language, unanswered reasons, preview", () => {
    expect(coverageAreaLabel("brandVoice")).toBe("ব্র্যান্ড ভয়েস");
    expect(coverageAreaLabel("customerMemory")).toBe("কাস্টমার স্মৃতি");
    expect(learningStateText(null)).toBe("এখনো চালানো হয়নি");
    expect(learningStateText({ lastRunAt: "2026-10-12T00:00:00Z", lastStatus: "ok", reason: null })).toContain("সফল");
    expect(learningStateText({ lastRunAt: "2026-10-12T00:00:00Z", lastStatus: "skipped", reason: "no_website_url" })).toContain("no_website_url");
    expect(languagePrefLabel("bn")).toBe("বাংলা");
    expect(languagePrefLabel(null)).toBe("জানা নেই");
    expect(unansweredReasonLabel("knowledge_gap")).toContain("জ্ঞানে এই তথ্য নেই");
    expect(previewText("abcdef", 3)).toBe("abc…");
    expect(previewText("ab", 3)).toBe("ab");
  });
});
