import { MetaClient, MetaApiError } from "./meta.client";
import { normalizeMetaInsight, extractConversions } from "./normalize";

function fakeFetch(handler: (url: string) => any) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const body = handler(url);
    return { ok: true, status: 200, json: async () => body } as any;
  };
  return { fn, calls };
}

describe("MetaClient", () => {
  it("verifies a token via /me and lists ad accounts with pagination on graph.facebook.com only", async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.includes("/me/adaccounts")) {
        if (url.includes("cursor=2")) return { data: [{ id: "act_2", name: "Second", currency: "USD", account_status: 1 }] };
        return {
          data: [{ id: "act_1", name: "Main Store", currency: "BDT", account_status: 1 }],
          paging: { next: "https://graph.facebook.com/v21.0/me/adaccounts?cursor=2" },
        };
      }
      return { id: "123", name: "Owner" };
    });
    const client = new MetaClient("token-xyz", fn as any);
    expect((await client.verifyToken()).id).toBe("123");
    const accounts = await client.listAdAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ externalId: "act_1", currency: "BDT" });
    expect(calls.every((u) => u.startsWith("https://graph.facebook.com/"))).toBe(true);
  });
  it("surfaces Meta errors with their message instead of failing silently", async () => {
    const fn = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid OAuth access token", code: 190 } }) }) as any;
    const client = new MetaClient("bad", fn as any);
    await expect(client.verifyToken()).rejects.toBeInstanceOf(MetaApiError);
    await expect(client.verifyToken()).rejects.toMatchObject({ code: 190 });
  });
});

describe("normalizeMetaInsight", () => {
  it("extracts spend, clicks and purchase conversions without double counting", () => {
    const row = {
      date_start: "2026-10-01", campaign_id: "c1", campaign_name: "Eid Sale",
      spend: "1250.50", impressions: "50000", clicks: "1000",
      actions: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "30" },
        { action_type: "purchase", value: "25" },
        { action_type: "link_click", value: "900" },
      ],
      action_values: [{ action_type: "purchase", value: "43750.00" }],
    };
    const n = normalizeMetaInsight(row);
    expect(n.spendMinor).toBe(125050n);
    expect(n.conversions).toBe(25); // "purchase" wins over the pixel duplicate
    expect(n.conversionValueMinor).toBe(4375000n);
    expect(extractConversions(undefined)).toBe(0);
    expect(extractConversions([{ action_type: "lead", value: "5" }])).toBe(0);
  });
});
