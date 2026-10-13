import type { ShopifyGraphQLClient } from "./shopify-graphql.client";

export const SHOPIFY_WEBHOOK_TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "INVENTORY_LEVELS_UPDATE",
  "FULFILLMENTS_CREATE",
  "REFUNDS_CREATE",
  "CUSTOMERS_CREATE",
  "CUSTOMERS_UPDATE",
  "APP_UNINSTALLED",
  "CHECKOUTS_CREATE",
  "CHECKOUTS_UPDATE",
] as const;

export interface ShopifyWebhookTopicResult {
  topic: string;
  status: "created" | "exists" | "failed";
  error?: string;
}

const CREATE_MUTATION = `mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`;

export async function ensureShopifyWebhookSubscriptions(
  client: Pick<ShopifyGraphQLClient, "webhookTopics" | "request">,
  opts: { callbackUrl: string },
): Promise<ShopifyWebhookTopicResult[]> {
  let existing: string[] = [];
  try {
    existing = await client.webhookTopics();
  } catch {
    existing = [];
  }
  const existingSet = new Set(existing);
  const results: ShopifyWebhookTopicResult[] = [];
  for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
    if (existingSet.has(topic)) {
      results.push({ topic, status: "exists" });
      continue;
    }
    try {
      const data: any = await (client as any).request(CREATE_MUTATION, {
        topic,
        webhookSubscription: { callbackUrl: opts.callbackUrl, format: "JSON" },
      });
      const payload = data?.webhookSubscriptionCreate ?? data;
      const userErrors: any[] = payload?.userErrors ?? [];
      if (userErrors.length > 0) {
        const joined = userErrors.map((e: any) => e?.message ?? String(e)).join("; ");
        if (/already/i.test(joined)) {
          results.push({ topic, status: "exists" });
        } else {
          results.push({ topic, status: "failed", error: joined });
        }
        continue;
      }
      results.push({ topic, status: "created" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already/i.test(msg)) {
        results.push({ topic, status: "exists" });
      } else {
        results.push({ topic, status: "failed", error: msg });
      }
    }
  }
  return results;
}
