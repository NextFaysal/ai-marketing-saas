import { OrgBrainService } from "./org-brain.service";

/**
 * SA-B1 (Smart AI Phase 0, P1) — OrgBrainService guarantees:
 *  L1: org A's context contains none of org B's data.
 *  L3: the SERIALIZED customer-audience context contains no
 *      internal-visibility document content and no INTERNAL
 *      profile field values — sentinel strings are planted in the
 *      data and scanned for in the output (the OU8 pattern).
 *  Internal audience sees everything for its own org, with
 *  internal documents labelled.
 */

const A = "org-a";
const B = "org-b";

function fakePrisma() {
  const profiles: Record<string, any> = {
    [A]: {
      organizationId: A,
      industry: "Fashion", description: "A clothing shop", brandVoice: "Friendly",
      websiteUrl: "https://a.example",
      goals: "GOAL_SENTINEL_A", monthlyBudgetMinor: BigInt(98765400), budgetCurrency: "BDT",
      targetCustomers: { segment: "TARGET_SENTINEL_A" }, businessModel: "MODEL_SENTINEL_A",
      uniqueSellingPoints: "USP_SENTINEL_A", tradeLicenseNo: "LICENSE_SENTINEL_A",
      billingEmails: ["billing-sentinel-a@example.test"],
      deliveryChargeInsideMinor: BigInt(6000), deliveryChargeOutsideMinor: BigInt(12000),
      codAvailable: true, bkashNumber: "01700000000",
      contactPhone: "01700000000", contactEmail: "a@example.test",
      aiInstructions: "Be polite", aiReplyLanguage: "bn",
    },
    [B]: {
      organizationId: B,
      industry: "Electronics", description: "A gadget shop", brandVoice: "Formal",
      websiteUrl: "https://b.example",
      goals: "GOAL_SENTINEL_B", monthlyBudgetMinor: BigInt(555), budgetCurrency: "BDT",
      targetCustomers: { segment: "TARGET_SENTINEL_B" }, businessModel: "MODEL_SENTINEL_B",
      uniqueSellingPoints: "USP_SENTINEL_B", tradeLicenseNo: "LICENSE_SENTINEL_B",
      billingEmails: ["billing-sentinel-b@example.test"],
      deliveryChargeInsideMinor: BigInt(11100),
      aiInstructions: null, aiReplyLanguage: null,
    },
  };
  const orgs: Record<string, any> = { [A]: { id: A, name: "Shop A" }, [B]: { id: B, name: "Shop B" } };
  const policies = [
    { id: "pol-a-ship", organizationId: A, type: "shipping", title: "Shipping", content: "Ships in 2 days" },
    { id: "pol-b-ship", organizationId: B, type: "shipping", title: "Shipping", content: "B ships in 5 days" },
  ];
  const docs = [
    { id: "a-pub", organizationId: A, kind: "faq", visibility: "public", title: "Warranty policy", content: "Our warranty policy gives a one year replacement guarantee.", createdAt: new Date(3) },
    { id: "a-int", organizationId: A, kind: "note", visibility: "internal", title: "Warranty internal note", content: "Warranty policy INTERNAL_SENTINEL_A supplier margin note.", createdAt: new Date(2) },
    // A legacy row with NO visibility field (pre-migration shape):
    // treated as public, the behaviour it always had.
    { id: "a-legacy", organizationId: A, kind: "faq", title: "Delivery info", content: "Delivery inside Dhaka takes two working days delivery.", createdAt: new Date(1) },
    { id: "b-pub", organizationId: B, kind: "faq", visibility: "public", title: "Warranty policy", content: "WARRANTY_SENTINEL_B shop terms apply.", createdAt: new Date(1) },
  ];
  const byOrg = (rows: any[], where: any) => rows.filter((r) => r.organizationId === where.organizationId);
  const prisma: any = {
    businessProfile: { findUnique: async ({ where }: any) => profiles[where.organizationId] ?? null },
    organization: { findUnique: async ({ where }: any) => orgs[where.id] ?? null },
    businessPolicy: {
      findMany: async ({ where, take }: any) => byOrg(policies, where).slice(0, take ?? 20),
      findFirst: async ({ where }: any) => policies.find((x) => x.organizationId === where.organizationId && x.type === where.type) ?? null,
    },
    knowledgeDocument: {
      findMany: async ({ where, take }: any) => byOrg(docs, where).slice(0, take ?? 100),
    },
  };
  return prisma;
}

const A_SENTINELS = [
  "GOAL_SENTINEL_A", "TARGET_SENTINEL_A", "MODEL_SENTINEL_A", "USP_SENTINEL_A",
  "LICENSE_SENTINEL_A", "billing-sentinel-a@example.test", "INTERNAL_SENTINEL_A", "987654",
];
const B_SENTINELS = ["GOAL_SENTINEL_B", "WARRANTY_SENTINEL_B", "USP_SENTINEL_B"];

function makeService() {
  return new OrgBrainService(fakePrisma() as any);
}

describe("SA-B1 OrgBrainService — customer audience (L3 leak-proof)", () => {
  it("contains public facts and the public doc, and NONE of the internal sentinels when serialized", async () => {
    const ctx = await makeService().getContext(A, { audience: "customer", query: "warranty policy", includeRecentDocs: true });
    // Positive controls: the public surface really is there.
    expect(ctx.factsText).toContain("ডেলিভারি চার্জ");
    expect(ctx.knowledgeMatches.map((m) => m.docId)).toContain("a-pub");
    expect(ctx.orgName).toBe("Shop A");
    expect(ctx.internalProfile).toBeNull();
    // The leak scan over the ENTIRE serialized context.
    const serialized = JSON.stringify(ctx);
    for (const s of [...A_SENTINELS, ...B_SENTINELS]) {
      expect(serialized).not.toContain(s);
    }
    expect(ctx.knowledgeMatches.map((m) => m.docId)).not.toContain("a-int");
    expect(ctx.documents.map((d: any) => d.id)).not.toContain("a-int");
  });

  it("legacy documents without a visibility field stay public (their pre-migration behaviour)", async () => {
    const ctx = await makeService().getContext(A, { audience: "customer", query: "delivery info" });
    expect(ctx.knowledgeMatches.map((m) => m.docId)).toContain("a-legacy");
  });

  it("policies are org-scoped and typedPolicy resolves within the org", async () => {
    const ctx = await makeService().getContext(A, { audience: "customer", policyType: "shipping" });
    expect(ctx.typedPolicy?.id).toBe("pol-a-ship");
    expect(ctx.policies.every((p: any) => p.organizationId === A)).toBe(true);
  });
});

describe("SA-B1 OrgBrainService — internal audience", () => {
  it("sees internal profile fields and internal docs, labelled", async () => {
    const ctx = await makeService().getContext(A, { audience: "internal", query: "warranty policy", includeRecentDocs: true });
    expect(ctx.internalProfile?.goals).toBe("GOAL_SENTINEL_A");
    expect(ctx.internalProfile?.monthlyBudgetMinor).toBe("98765400");
    const internal = ctx.knowledgeMatches.find((m) => m.docId === "a-int");
    expect(internal?.visibility).toBe("internal");
    const pub = ctx.knowledgeMatches.find((m) => m.docId === "a-pub");
    expect(pub?.visibility).toBe("public");
    expect(ctx.documents.map((d: any) => d.id)).toContain("a-int");
  });

  it("internal audience still never crosses orgs", async () => {
    const ctx = await makeService().getContext(B, { audience: "internal", query: "warranty policy", includeRecentDocs: true });
    const serialized = JSON.stringify(ctx);
    for (const s of A_SENTINELS) expect(serialized).not.toContain(s);
    expect(ctx.knowledgeMatches.map((m) => m.docId)).toEqual(["b-pub"]);
    expect(ctx.internalProfile?.goals).toBe("GOAL_SENTINEL_B");
  });
});

describe("SA-B1 OrgBrainService — cross-org isolation + empty orgs", () => {
  it("org B's customer context holds none of org A's values", async () => {
    const ctx = await makeService().getContext(B, { audience: "customer", query: "warranty policy", includeRecentDocs: true });
    const serialized = JSON.stringify(ctx);
    for (const s of A_SENTINELS) expect(serialized).not.toContain(s);
    expect(ctx.orgName).toBe("Shop B");
  });

  it("an org with no rows — and a prisma double with no tables at all — yields an empty context, never a throw", async () => {
    const empty = await makeService().getContext("org-empty", { audience: "customer", query: "warranty", includeRecentDocs: true });
    expect(empty.facts).toEqual([]);
    expect(empty.knowledgeMatches).toEqual([]);
    expect(empty.internalProfile).toBeNull();
    const bare = new OrgBrainService({} as any);
    const ctx = await bare.getContext(A, { audience: "internal", query: "warranty", includeRecentDocs: true, policyType: "shipping" });
    expect(ctx.facts).toEqual([]);
    expect(ctx.policies).toEqual([]);
    expect(ctx.typedPolicy).toBeNull();
  });
});
