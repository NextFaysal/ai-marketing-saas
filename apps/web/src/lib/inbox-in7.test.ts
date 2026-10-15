import { describe, expect, it } from "vitest";
import {
  handoverSummaryNotice, isRunnableAction, knowledgeBodyFromDraft,
  proposalAcceptPatch, type NextActionProposal,
} from "./inbox-in7";

const proposal = (over: Partial<NextActionProposal> = {}): NextActionProposal => ({
  action: "create_order", label: "অর্ডার তৈরি করুন", reason: "কারণ",
  tags: [], pipelineStage: null, ...over,
});

describe("IN7 proposalAcceptPatch", () => {
  it("merges new tags with current ones, never duplicates or replaces", () => {
    const patch = proposalAcceptPatch(proposal({ tags: ["vip", "নতুন"] }), ["vip", "পুরনো"]);
    expect(patch).toEqual({ tags: ["vip", "পুরনো", "নতুন"] });
  });

  it("includes the stage only when proposed", () => {
    expect(proposalAcceptPatch(proposal({ pipelineStage: "ordered" }), [])).toEqual({ pipelineStage: "ordered" });
    expect(proposalAcceptPatch(proposal({}), [])).toBeNull();
  });

  it("a proposal whose tags all already exist and no stage -> nothing to accept", () => {
    expect(proposalAcceptPatch(proposal({ tags: ["vip"] }), ["vip"])).toBeNull();
  });
});

describe("IN7 handoverSummaryNotice", () => {
  it("created / attempted-but-failed / policy-blocked are three distinct honest lines", () => {
    expect(handoverSummaryNotice({ attempted: true, created: true })).toContain("যোগ হয়েছে");
    expect(handoverSummaryNotice({ attempted: true, created: false })).toContain("তৈরি হয়নি");
    expect(handoverSummaryNotice({ attempted: false, created: false })).toContain("হ্যান্ডওভার সম্পন্ন");
  });
  it("no outcome -> no line", () => {
    expect(handoverSummaryNotice(null)).toBeNull();
    expect(handoverSummaryNotice(undefined)).toBeNull();
  });
});

describe("IN7 action runnability + knowledge body", () => {
  it("wait_customer is informational; every other action runs an existing path", () => {
    expect(isRunnableAction("wait_customer")).toBe(false);
    for (const a of ["share_tracking", "cod_confirm", "create_order", "reply_manually", "resolve"] as const) {
      expect(isRunnableAction(a)).toBe(true);
    }
  });
  it("knowledge body shapes the existing endpoint's payload", () => {
    expect(knowledgeBodyFromDraft({ title: "শিরোনাম", content: "বিষয়বস্তু" }))
      .toEqual({ title: "শিরোনাম", content: "বিষয়বস্তু", kind: "faq" });
  });
});
