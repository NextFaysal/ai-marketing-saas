import { ensureShopifyWebhookSubscriptions, SHOPIFY_WEBHOOK_TOPICS } from "./shopify-webhooks";

function fakeClient(opts: { existing?: string[]; readFails?: boolean; userErrorsByTopic?: Record<string, string[]>; throwByTopic?: Record<string, string> } = {}) {
  return {
    webhookTopics: async () => {
      if (opts.readFails) throw new Error("read failed");
      return opts.existing ?? [];
    },
    request: async (_q: string, vars: any) => {
      const topic = vars.topic as string;
      if (opts.throwByTopic?.[topic]) throw new Error(opts.throwByTopic[topic]);
      const errs = opts.userErrorsByTopic?.[topic] ?? [];
      return { webhookSubscriptionCreate: { webhookSubscription: errs.length ? null : { id: "gid://1" }, userErrors: errs.map((m) => ({ field: ["topic"], message: m })) } };
    },
  } as any;
}

describe("ensureShopifyWebhookSubscriptions", () => {
  it("marks existing topics as exists and creates the rest", async () => {
    const client = fakeClient({ existing: ["PRODUCTS_CREATE", "ORDERS_CREATE"] });
    const results = await ensureShopifyWebhookSubscriptions(client, { callbackUrl: "https://cb.example/hook" });
    expect(results).toHaveLength(SHOPIFY_WEBHOOK_TOPICS.length);
    expect(results.find((r) => r.topic === "PRODUCTS_CREATE")?.status).toBe("exists");
    expect(results.find((r) => r.topic === "PRODUCTS_UPDATE")?.status).toBe("created");
  });
  it("proceeds to mutations when topic read fails", async () => {
    const client = fakeClient({ readFails: true });
    const results = await ensureShopifyWebhookSubscriptions(client, { callbackUrl: "https://cb.example/hook" });
    expect(results.every((r) => r.status === "created")).toBe(true);
  });
  it("userErrors -> failed with verbatim joined messages, already -> exists", async () => {
    const client = fakeClient({ userErrorsByTopic: { PRODUCTS_CREATE: ["Callback URL is invalid"], PRODUCTS_UPDATE: ["Subscription already exists"] } });
    const results = await ensureShopifyWebhookSubscriptions(client, { callbackUrl: "https://cb.example/hook" });
    expect(results.find((r) => r.topic === "PRODUCTS_CREATE")).toEqual({ topic: "PRODUCTS_CREATE", status: "failed", error: "Callback URL is invalid" });
    expect(results.find((r) => r.topic === "PRODUCTS_UPDATE")?.status).toBe("exists");
  });
  it("never throws per-topic on request throw", async () => {
    const client = fakeClient({ throwByTopic: { ORDERS_CREATE: "network exploded" } });
    const results = await ensureShopifyWebhookSubscriptions(client, { callbackUrl: "https://cb.example/hook" });
    expect(results.find((r) => r.topic === "ORDERS_CREATE")).toEqual({ topic: "ORDERS_CREATE", status: "failed", error: "network exploded" });
    expect(results.filter((r) => r.status === "created").length).toBeGreaterThan(0);
  });
});
