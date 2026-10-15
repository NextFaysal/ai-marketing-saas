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
  it("put sends PUT with JSON body and returns data", async () => {
    const { fn, calls } = fakeFetch({ body: { id: 5, name: "Updated" } });
    const client = new WooClient("https://shop.example.com", { consumerKey: "ck", consumerSecret: "cs" }, fn as any);
    const res = await client.put("/products/5", { name: "Updated" });
    expect(res.data).toEqual({ id: 5, name: "Updated" });
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(calls[0].init.body)).toEqual({ name: "Updated" });
    expect(calls[0].url).toContain("/products/5");
  });
  it("put throws WooApiError verbatim on error", async () => {
    const { fn } = fakeFetch({ ok: false, status: 400, body: "bad request body" });
    const client = new WooClient("https://shop.example.com", { consumerKey: "ck", consumerSecret: "cs" }, fn as any);
    await expect(client.put("/products/5", {})).rejects.toMatchObject({ status: 400 });
    await expect(client.put("/products/5", {})).rejects.toThrow("bad request body");
  });
  it("delete sends DELETE and handles response", async () => {
    const { fn, calls } = fakeFetch({ body: { deleted: true } });
    const client = new WooClient("https://shop.example.com", { consumerKey: "ck", consumerSecret: "cs" }, fn as any);
    const res = await client.delete("/products/5");
    expect(res.data).toEqual({ deleted: true });
    expect(calls[0].init.method).toBe("DELETE");
  });
  it("listWebhooks returns items array", async () => {
    const { fn, calls } = fakeFetch({ body: [{ id: 1, topic: "product.created" }] });
    const client = new WooClient("https://shop.example.com", { consumerKey: "ck", consumerSecret: "cs" }, fn as any);
    const items = await client.listWebhooks(1, 100);
    expect(items).toEqual([{ id: 1, topic: "product.created" }]);
    expect(calls[0].url).toContain("/webhooks");
  });
  it("createWebhook posts to /webhooks", async () => {
    const { fn, calls } = fakeFetch({ body: { id: 9, topic: "order.created" } });
    const client = new WooClient("https://shop.example.com", { consumerKey: "ck", consumerSecret: "cs" }, fn as any);
    const wh = await client.createWebhook({ name: "x", topic: "order.created", delivery_url: "https://cb.example/hook", secret: "s", status: "active" });
    expect(wh).toEqual({ id: 9, topic: "order.created" });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toContain("/webhooks");
  });
  it("deleteWebhook deletes with force=true", async () => {
    const { fn, calls } = fakeFetch({ body: { id: 9 } });
    const client = new WooClient("https://shop.example.com", { consumerKey: "ck", consumerSecret: "cs" }, fn as any);
    await client.deleteWebhook(9);
    expect(calls[0].url).toContain("/webhooks/9?force=true");
    expect(calls[0].init.method).toBe("DELETE");
  });
});
