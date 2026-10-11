import { ToolsService } from "./tools.service";
import { sanitizePlan } from "./planner";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * Milestone 77 (Business Command Center, part 3): the AI
 * Assistant's knowledge tool now carries the Command Center
 * facts + the owner's AI behaviour, FAQ documents are
 * ranked by the user's actual question (the sanitizer lets
 * only a bounded query through), and the reply-language
 * setting is a closed set.
 */
const profile = {
  industry: "fashion", description: "d", goals: null, brandVoice: "friendly", websiteUrl: null,
  deliveryChargeInsideMinor: 6000n, deliveryDaysInside: 2, codAvailable: true, bkashNumber: "01712345678",
  contactPhone: "01712345678", aiInstructions: "সবসময় সালাম দিয়ে শুরু করবেন।", aiReplyLanguage: "bn",
};
const docs = [
  { id: "d1", kind: "faq", title: "ওয়ারেন্টি নীতি", content: "সব ঘড়িতে এক বছরের ওয়ারেন্টি।", createdAt: new Date() },
  { id: "d2", kind: "note", title: "অভ্যন্তরীণ নোট", content: "গুদামের ঠিকানা গোপন।", createdAt: new Date() },
];
function tools() {
  const fake: any = {
    businessProfile: { findUnique: jest.fn(async () => profile) },
    businessPolicy: { findMany: jest.fn(async () => [{ type: "shipping", title: "শিপিং", content: "সারা দেশে।" }]) },
    knowledgeDocument: { findMany: jest.fn(async () => docs) },
  };
  return new ToolsService(fake, {} as any, {} as any);
}

describe("M77 brain tool", () => {
  it("knowledge carries facts, owner instructions and ranked matches", async () => {
    const out: any = await (tools() as any).execute("org", { tool: "get_business_knowledge", args: { query: "ওয়ারেন্টি কত দিনের?" } });
    expect(out.facts.join(" ")).toContain("60");
    expect(out.facts.join(" ")).toContain("01712345678");
    expect(out.profile.aiInstructions).toContain("সালাম");
    expect(out.profile.aiReplyLanguage).toBe("bn");
    expect(out.matchedDocuments[0]?.title).toBe("ওয়ারেন্টি নীতি");
  });

  it("without a query there are no ranked matches (recent docs still flow)", async () => {
    const out: any = await (tools() as any).execute("org", { tool: "get_business_knowledge", args: {} });
    expect(out.matchedDocuments).toEqual([]);
    expect(out.documents).toHaveLength(2);
  });

  it("the sanitizer keeps a bounded query and drops junk", () => {
    const plan = sanitizePlan([{ tool: "get_business_knowledge", args: { query: "x".repeat(500), evil: "rm" } }]);
    expect(plan[0].args.query).toHaveLength(200);
    expect(plan[0].args).not.toHaveProperty("evil");
    const plan2 = sanitizePlan([{ tool: "get_business_knowledge", args: { query: 42 } }]);
    expect(plan2[0].args).not.toHaveProperty("query");
  });

  it("the reply language is a closed set on the profile API", async () => {
    const svc = new OrganizationsService({
      businessProfile: { upsert: jest.fn(async ({ create }: any) => ({ id: "p", ...create })) },
    } as any, { log: jest.fn(async () => undefined) } as any);
    await expect(svc.updateBusinessProfile("org", "boss", { aiReplyLanguage: "fr" } as any)).rejects.toThrow(/bn, en/);
    const ok: any = await svc.updateBusinessProfile("org", "boss", { aiReplyLanguage: "bn", aiInstructions: "ভদ্রভাবে উত্তর দিন" } as any);
    expect(ok.aiReplyLanguage).toBe("bn");
  });
});
