// Queue names are contracts between API (producer) and worker (consumer).
// New queues are added per phase; do not rename without a migration plan.
export const QUEUES = {
  SYNC_STORE: "sync-store",           // Milestone 3: WooCommerce / Shopify sync
  SYNC_ADS: "sync-ads",               // Milestone 5: Meta / Google / TikTok insights
  AGGREGATE_DAILY: "aggregate-daily", // Milestone 5: daily metric rollups
  AI_REPORT: "ai-report",             // Milestone 6: daily AI reports
  COMPETITOR_SCAN: "competitor-scan", // Phase 8
  WEBHOOK: "webhook",                 // Phase 7: inbound webhooks
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
