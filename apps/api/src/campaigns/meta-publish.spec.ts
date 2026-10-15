import { MetaPublishClient } from "./meta-publish.client";

describe("MetaPublishClient", () => {
  it("creates a campaign PAUSED and requires an id back", async () => {
    let sent = "";
    const fetchFn = async (_url: string, init: any) => { sent = init.body; return { ok: true, status: 200, json: async () => ({ id: "120211" }) } as any; };
    const client = new MetaPublishClient("tok", fetchFn as any);
    const res = await client.createCampaign("12345", { name: "Eid", objective: "OUTCOME_SALES" });
    expect(res.id).toBe("120211");
    expect(sent).toContain("status=PAUSED");
    expect(sent).toContain("objective=OUTCOME_SALES");
  });
  it("a response without an id is a failure, never a success", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) as any;
    const client = new MetaPublishClient("tok", fetchFn as any);
    await expect(client.createCampaign("1", { name: "X", objective: "OUTCOME_TRAFFIC" })).rejects.toThrow("NOT confirmed");
  });
  it("CN2: campaign lifetime budget and ad set bid fields go out verbatim", async () => {
    const bodies: string[] = [];
    const fetchFn = async (_url: string, init: any) => { bodies.push(String(init.body)); return { ok: true, status: 200, json: async () => ({ id: "9" }) } as any; };
    const client = new MetaPublishClient("tok", fetchFn as any);
    await client.createCampaign("1", { name: "CBO", objective: "OUTCOME_SALES", lifetimeBudgetMinor: "900000" });
    const camp = new URLSearchParams(bodies[0]);
    expect(camp.get("lifetime_budget")).toBe("900000");
    expect(camp.get("daily_budget")).toBeNull();
    await client.createAdSet("1", {
      name: "S", campaignId: "9", billingEvent: "IMPRESSIONS", optimizationGoal: "VALUE",
      targeting: { geo_locations: { countries: ["BD"] } },
      bidStrategy: "LOWEST_COST_WITH_MIN_ROAS", bidConstraints: { roas_average_floor: 20000 },
    });
    const set = new URLSearchParams(bodies[1]);
    expect(set.get("bid_strategy")).toBe("LOWEST_COST_WITH_MIN_ROAS");
    expect(JSON.parse(set.get("bid_constraints")!)).toEqual({ roas_average_floor: 20000 });
    expect(set.get("status")).toBe("PAUSED");
  });
  it("API errors surface Meta's message", async () => {
    const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "No ads_management permission", code: 200 } }) }) as any;
    const client = new MetaPublishClient("tok", fetchFn as any);
    await expect(client.setObjectStatus("999", "ACTIVE")).rejects.toThrow("ads_management");
  });
});
