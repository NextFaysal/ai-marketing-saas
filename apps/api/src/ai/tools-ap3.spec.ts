import { ToolsService } from "./tools.service";

function matchVal(v: any, cond: any): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    if ("gte" in cond) return new Date(v) >= cond.gte;
    if ("contains" in cond) return String(v ?? "").toLowerCase().includes(String(cond.contains).toLowerCase());
    if ("in" in cond) return cond.in.includes(v);
    return true;
  }
  return v === cond;
}
function rowOk(row: any, where: any): boolean {
  return Object.entries<any>(where ?? {}).every(([k, v]) => {
    if (k === "OR") return v.some((c: any) => rowOk(row, c));
    return matchVal(row[k], v);
  });
}
function table(rows: any[]) {
  return {
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let out = rows.filter((r) => rowOk(r, where));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      if (orderBy?.count === "desc") out = [...out].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
      return take ? out.slice(0, take) : out;
    },
    findFirst: async ({ where, orderBy }: any = {}) => {
      const many = await table(rows).findMany({ where, orderBy });
      return many[0] ?? null;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => rowOk(r, where)).length,
  };
}
const now = Date.now();
const day = 86_400_000;
function fakePrisma() {
  return {
    order: table([
      { id: "o1", organizationId: "org1", customerId: "c1", externalNumber: "1042", externalId: "1042", status: "completed", source: "woocommerce", paymentMethod: "cod", isCod: true, isPractice: false, currency: "BDT", subtotalMinor: 140000n, shippingMinor: 10000n, discountMinor: 0n, totalMinor: 150000n, createdAt: new Date(now - day) },
      { id: "o2", organizationId: "org1", customerId: "c1", externalNumber: "1043", externalId: "1043", status: "processing", source: "woocommerce", paymentMethod: "cod", isCod: true, isPractice: false, currency: "BDT", subtotalMinor: 50000n, shippingMinor: 0n, discountMinor: 0n, totalMinor: 50000n, createdAt: new Date(now - 2 * day) },
    ]),
    orderItem: table([{ id: "i1", orderId: "o1", name: "Panjabi", sku: "PN-1", quantity: 1, totalMinor: 140000n }]),
    courierShipment: table([
      { id: "s1", organizationId: "org1", orderId: "o1", provider: "steadfast", status: "delivered", codAmountMinor: 150000n, trackingCode: "T1", createdAt: new Date(now - day) },
      { id: "s2", organizationId: "org1", orderId: "o2", provider: "steadfast", status: "in_transit", codAmountMinor: 50000n, trackingCode: "T2", createdAt: new Date(now - 5 * day) },
    ]),
    customer: table([{ id: "c1", organizationId: "org1", mergedIntoId: null, firstName: "Rahim", lastName: "Uddin", phone: "01711000", email: null, createdAt: new Date(now - 40 * day) }]),
    lead: table([
      { id: "l1", organizationId: "org1", customerId: "c1", mergedIntoId: null, stage: "qualified", valueMinor: 200000n, nextFollowUpAt: new Date(now - day), createdAt: new Date() },
      { id: "l2", organizationId: "org1", customerId: null, mergedIntoId: null, stage: "new", valueMinor: null, nextFollowUpAt: null, createdAt: new Date() },
    ]),
    channelConversation: table([
      { id: "cc1", organizationId: "org1", channel: "whatsapp", status: "open", assignedUserId: null, createdAt: new Date(now - day), updatedAt: new Date() },
      { id: "cc2", organizationId: "org1", channel: "messenger", status: "closed", assignedUserId: "u9", createdAt: new Date(now - day), updatedAt: new Date() },
    ]),
    aiUnansweredQuestion: table([{ id: "q1", organizationId: "org1", status: "open", normalizedQuestion: "ডেলিভারি চার্জ কত", count: 7, channel: "whatsapp" }]),
    socialPost: table([
      { id: "sp1", organizationId: "org1", status: "published", error: null, createdAt: new Date(now - day) },
      { id: "sp2", organizationId: "org1", status: "failed", error: "Token expired", createdAt: new Date(now - 2 * day) },
    ]),
    adAccount: table([{ id: "aa1", organizationId: "org1", name: "Main", platform: "meta", status: "ACTIVE", platformStatusBucket: "restricted" }]),
    aIUsageRecord: table([
      { id: "u1", organizationId: "org1", feature: "chat", provider: "gemini", inputTokens: 100, outputTokens: 50, createdAt: new Date() },
      { id: "u2", organizationId: "org1", feature: "chat", provider: "gemini", inputTokens: 10, outputTokens: 5, createdAt: new Date(now - day) },
    ]),
    agentState: table([{ id: "as1", organizationId: "org1", userId: "u9", status: "online" }]),
    automationRun: table([
      { id: "r1", organizationId: "org1", kind: "schedule", status: "success", detail: null, createdAt: new Date() },
      { id: "r2", organizationId: "org1", kind: "rule", status: "error", detail: "boom", createdAt: new Date() },
    ]),
  };
}
function makeTools() {
  return new ToolsService(fakePrisma() as any, {} as any, {} as any);
}

describe("ToolsService AP3 tool universe", () => {
  it("get_order_detail returns the order with items and shipment", async () => {
    const r: any = await makeTools().execute("org1", { tool: "get_order_detail", args: { query: "1042" } });
    expect(r.found).toBe(true);
    expect(r.items[0].name).toBe("Panjabi");
    expect(r.shipments[0].provider).toBe("steadfast");
    const miss: any = await makeTools().execute("org1", { tool: "get_order_detail", args: { query: "9999" } });
    expect(miss.found).toBe(false);
  });
  it("get_customer_360 aggregates orders + lifetime + lead stage", async () => {
    const r: any = await makeTools().execute("org1", { tool: "get_customer_360", args: { query: "01711" } });
    expect(r.found).toBe(true);
    expect(r.orders).toBe(2);
    expect(r.leadStage).toBe("qualified");
  });
  it("get_crm_pipeline counts stages and overdue follow-ups", async () => {
    const r: any = await makeTools().execute("org1", { tool: "get_crm_pipeline", args: {} });
    expect(r.totalLeads).toBe(2);
    expect(r.overdueFollowUps).toBe(1);
  });
  it("get_inbox_performance surfaces unassigned + unanswered themes", async () => {
    const r: any = await makeTools().execute("org1", { tool: "get_inbox_performance", args: {} });
    expect(r.unassignedOpen).toBe(1);
    expect(r.topUnansweredThemes[0].askedTimes).toBe(7);
  });
  it("get_social_performance shows the latest failure verbatim", async () => {
    const r: any = await makeTools().execute("org1", { tool: "get_social_performance", args: {} });
    expect(r.byStatus.published).toBe(1);
    expect(r.latestFailure.error).toBe("Token expired");
  });
  it("get_ad_account_health flags non-active accounts", async () => {
    const r: any = await makeTools().execute("org1", { tool: "get_ad_account_health", args: {} });
    expect(r.notActive).toHaveLength(1);
  });
  it("get_usage_summary aggregates features/providers", async () => {
    const r: any = await makeTools().execute("org1", { tool: "get_usage_summary", args: {} });
    expect(r.totalCalls).toBe(2);
    expect(r.byFeature.chat.inputTokens).toBe(110);
  });
  it("get_team_performance + get_automation_health + get_courier_rollup", async () => {
    const tools = makeTools();
    const team: any = await tools.execute("org1", { tool: "get_team_performance", args: {} });
    expect(team.presence.online).toBe(1);
    const auto: any = await tools.execute("org1", { tool: "get_automation_health", args: {} });
    expect(auto.latestErrors[0].detail).toBe("boom");
    const roll: any = await tools.execute("org1", { tool: "get_courier_rollup", args: {} });
    expect(roll.providers[0].deliveryRatePct).toBe(50);
    expect(roll.providers[0].stuckOver72h).toBe(1);
  });
  it("get_sales_forecast refuses thin data and projects with real orders", async () => {
    const tools = makeTools();
    const r: any = await tools.execute("org1", { tool: "get_sales_forecast", args: { days: 7 } });
    // Only 2 selling days in the window → honest refusal.
    expect(r.available).toBe(false);
  });
});
