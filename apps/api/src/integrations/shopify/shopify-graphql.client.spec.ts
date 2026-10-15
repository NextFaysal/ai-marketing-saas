import { ShopifyGraphQLClient, ShopifyGraphQLError } from "./shopify-graphql.client";

function stubFetch(response: { ok?: boolean; status?: number; body?: unknown }) {
  const calls: { url: string; init: any }[] = [];
  const fn = async (url: string, init: any) => {
    calls.push({ url, init });
    const text = typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? {});
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: async () => text,
      json: async () => (response.body ?? {}),
    } as any;
  };
  return { fn, calls };
}

describe("ShopifyGraphQLClient", () => {
  it("posts to graphql.json with token header and returns data", async () => {
    const { fn, calls } = stubFetch({ body: { data: { shop: { id: "1", name: "Shop" } } } });
    const client = new ShopifyGraphQLClient("https://shop.myshopify.com", "shpat_x", fn as any, "2025-10");
    const data: any = await client.request("query { shop { id } }");
    expect(data).toEqual({ shop: { id: "1", name: "Shop" } });
    expect(calls[0].url).toBe("https://shop.myshopify.com/admin/api/2025-10/graphql.json");
    expect(calls[0].init.headers["X-Shopify-Access-Token"]).toBe("shpat_x");
    expect(JSON.parse(calls[0].init.body).query).toContain("shop");
  });
  it("shopProbe returns shop", async () => {
    const { fn } = stubFetch({ body: { data: { shop: { id: "gid://1", name: "MyShop", currencyCode: "BDT", primaryDomain: { url: "https://x" } } } } });
    const client = new ShopifyGraphQLClient("https://shop.myshopify.com", "tok", fn as any);
    await expect(client.shopProbe()).resolves.toMatchObject({ name: "MyShop" });
  });
  it("accessScopes returns handles", async () => {
    const { fn } = stubFetch({ body: { data: { currentAppInstallation: { accessScopes: [{ handle: "read_products" }, { handle: "write_products" }] } } } });
    const client = new ShopifyGraphQLClient("https://shop.myshopify.com", "tok", fn as any);
    await expect(client.accessScopes()).resolves.toEqual(["read_products", "write_products"]);
  });
  it("webhookTopics returns topics", async () => {
    const { fn } = stubFetch({ body: { data: { webhookSubscriptions: { edges: [{ node: { topic: "PRODUCTS_CREATE" } }, { node: { topic: "ORDERS_CREATE" } }] } } } });
    const client = new ShopifyGraphQLClient("https://shop.myshopify.com", "tok", fn as any);
    await expect(client.webhookTopics()).resolves.toEqual(["PRODUCTS_CREATE", "ORDERS_CREATE"]);
  });
  it("throws with joined verbatim GraphQL errors", async () => {
    const { fn } = stubFetch({ body: { errors: [{ message: "Field shop is wrong" }, { message: "Access denied" }] } });
    const client = new ShopifyGraphQLClient("https://shop.myshopify.com", "tok", fn as any);
    await expect(client.request("query {}")).rejects.toThrow("Field shop is wrong; Access denied");
    await expect(client.request("query {}")).rejects.toBeInstanceOf(ShopifyGraphQLError);
  });
  it("throws on HTTP error with status and body excerpt", async () => {
    const { fn } = stubFetch({ ok: false, status: 401, body: { errors: "Unauthorized token" } });
    const client = new ShopifyGraphQLClient("https://shop.myshopify.com", "tok", fn as any);
    await expect(client.request("query {}")).rejects.toMatchObject({ status: 401 });
    await expect(client.request("query {}")).rejects.toThrow("401");
  });
});
