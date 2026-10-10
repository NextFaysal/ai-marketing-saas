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
  it("API errors surface Meta's message", async () => {
    const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "No ads_management permission", code: 200 } }) }) as any;
    const client = new MetaPublishClient("tok", fetchFn as any);
    await expect(client.setObjectStatus("999", "ACTIVE")).rejects.toThrow("ads_management");
  });
});
