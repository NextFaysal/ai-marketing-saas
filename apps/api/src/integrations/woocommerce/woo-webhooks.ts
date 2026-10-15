import type { WooClient } from "./woo.client";

export const WOO_WEBHOOK_TOPICS = [
  "product.created",
  "product.updated",
  "product.deleted",
  "order.created",
  "order.updated",
] as const;

export interface WooWebhookTopicResult {
  topic: string;
  status: "created" | "exists" | "failed";
  webhookId?: number | string;
  error?: string;
}

export async function registerWooWebhooks(
  client: WooClient,
  opts: { deliveryUrl: string; secret: string; namePrefix?: string },
): Promise<WooWebhookTopicResult[]> {
  let existing: any[] = [];
  try {
    existing = await client.listWebhooks(1, 100);
  } catch {
    existing = [];
  }
  const results: WooWebhookTopicResult[] = [];
  for (const topic of WOO_WEBHOOK_TOPICS) {
    try {
      const match = (existing ?? []).find((w: any) => w.topic === topic && w.delivery_url === opts.deliveryUrl);
      if (match) {
        results.push({ topic, status: "exists", webhookId: match.id });
        continue;
      }
      const created: any = await client.createWebhook({
        name: `${opts.namePrefix ?? "ai-marketing-saas"} ${topic}`,
        topic,
        delivery_url: opts.deliveryUrl,
        secret: opts.secret,
        status: "active",
      });
      // WooClient.createWebhook returns data directly or {data}
      const webhook = created?.id ? created : created?.data ?? created;
      results.push({ topic, status: "created", webhookId: webhook?.id });
    } catch (e) {
      results.push({ topic, status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
