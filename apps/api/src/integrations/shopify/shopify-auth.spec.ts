import { exchangeShopifyClientCredentials, normalizeShopifyHost } from "./shopify-auth";

function stubFetch(status: number, body: any) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  })) as any;
}

describe("exchangeShopifyClientCredentials", () => {
  it("normalizes host and returns token/expires/scope", async () => {
    expect(normalizeShopifyHost("https://my-shop.myshopify.com/")).toBe("my-shop.myshopify.com");
    expect(normalizeShopifyHost("my-shop.myshopify.com/admin")).toBe("my-shop.myshopify.com");
    let seenUrl = ""; let seenBody = ""; let seenCt = "";
    const fetchFn = (async (url: any, init: any) => {
      seenUrl = String(url); seenBody = String(init.body); seenCt = init.headers["Content-Type"];
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "shpat_new", expires_in: 86399, scope: "read_products,write_products" }), json: async () => ({}) };
    }) as any;
    const out = await exchangeShopifyClientCredentials("https://my-shop.myshopify.com/", "cid", "csecret", fetchFn);
    expect(out).toEqual({ accessToken: "shpat_new", expiresIn: 86399, scope: "read_products,write_products" });
    expect(seenUrl).toBe("https://my-shop.myshopify.com/admin/oauth/access_token");
    expect(seenCt).toBe("application/x-www-form-urlencoded");
    expect(seenBody).toContain("grant_type=client_credentials");
    expect(seenBody).toContain("client_id=cid");
    expect(seenBody).toContain("client_secret=csecret");
  });

  it("throws verbatim status + body on 401", async () => {
    await expect(exchangeShopifyClientCredentials("shop.myshopify.com", "bad", "bad", stubFetch(401, { error: "invalid_client" })))
      .rejects.toThrow(/401/);
    await expect(exchangeShopifyClientCredentials("shop.myshopify.com", "bad", "bad", stubFetch(401, { error: "invalid_client" })))
      .rejects.toThrow(/invalid_client/);
  });

  it("throws when access_token is missing", async () => {
    await expect(exchangeShopifyClientCredentials("shop.myshopify.com", "cid", "cs", stubFetch(200, { scope: "read_products" })))
      .rejects.toThrow(/missing access_token/);
  });

  it("expiresIn/scope are null when absent", async () => {
    const out = await exchangeShopifyClientCredentials("shop.myshopify.com", "cid", "cs", stubFetch(200, { access_token: "tok" }));
    expect(out).toEqual({ accessToken: "tok", expiresIn: null, scope: null });
  });
});
