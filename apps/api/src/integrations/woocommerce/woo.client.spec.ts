import { WooClient, WooApiError } from "./woo.client";

function fakeFetch(response: { ok?: boolean; status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: { url: string; init: any }[] = [];
  const fn = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      headers: new Headers(response.headers ?? {}),
      json: async () => response.body,
      text: async () => (typeof response.body === "string" ? response.body : JSON.stringify(response.body)),
    } as any;
  };
  return { fn, calls };
}

describe("WooClient", () => {
  it("builds the wc/v3 URL and sends Basic auth (never the secret in the URL)", async () => {
    const { fn, calls } = fakeFetch({ body: [], headers: { "x-wp-totalpages": "1", "x-wp-total": "0" } });
    const client = new WooClient("https://shop.example.com/", { consumerKey: "ck_1", consumerSecret: "cs_1" }, fn as any);
    await client.listProducts(2, 50);
    expect(calls[0].url).toContain("https://shop.example.com/wp-json/wc/v3/products");
    expect(calls[0].url).toContain("page=2");
    expect(calls[0].url).not.toContain("cs_1");
    expect(calls[0].init.headers.Authorization).toBe("Basic " + Buffer.from("ck_1:cs_1").toString("base64"));
  });
  it("reads pagination totals from WordPress headers", async () => {
    const { fn } = fakeFetch({ body: [{ id: 1 }], headers: { "x-wp-totalpages": "7", "x-wp-total": "640" } });
    const client = new WooClient("https://shop.example.com", { consumerKey: "ck", consumerSecret: "cs" }, fn as any);
    const page = await client.listOrders(1);
    expect(page.totalPages).toBe(7);
    expect(page.total).toBe(640);
  });
  it("throws WooApiError with the status on HTTP errors", async () => {
    const { fn } = fakeFetch({ ok: false, status: 401, body: "Unauthorized" });
    const client = new WooClient("https://shop.example.com", { consumerKey: "ck", consumerSecret: "bad" }, fn as any);
    await expect(client.testConnection()).rejects.toBeInstanceOf(WooApiError);
    await expect(client.testConnection()).rejects.toMatchObject({ status: 401 });
  });
});
