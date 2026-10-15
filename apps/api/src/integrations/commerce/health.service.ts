import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { IntegrationsService } from "../integrations.service";
import { ShopifyService } from "../shopify/shopify.service";
import { WooClient } from "../woocommerce/woo.client";
import { SHOPIFY_WEBHOOK_TOPICS } from "../shopify/shopify-webhooks";
import { checkTrackerOnHomepage } from "./tracker-check";

export type HealthStatus = "pass" | "warn" | "fail" | "unknown";

export interface HealthCheck {
  key: string;
  label: string;
  status: HealthStatus;
  evidence: string;
}

const STATUS_ORDER: Record<HealthStatus, number> = { pass: 0, unknown: 1, warn: 2, fail: 3 };

export const SHOPIFY_REQUIRED_SCOPES = [
  "read_products", "write_products", "read_inventory", "write_inventory", "read_orders",
  "write_orders", "read_customers", "write_customers", "read_discounts", "write_discounts",
];

@Injectable()
export class StoreHealthService {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly shopify: ShopifyService,
    // CP3: optional so existing positional constructions keep
    // working; Nest supplies PrismaService (global module). Falls
    // back to the IntegrationsService's own prisma handle.
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async getHealth(organizationId: string, integrationId: string) {
    const integration = await this.integrations.getIntegration(organizationId, integrationId);
    const checks: HealthCheck[] = [];

    checks.push({
      key: "credential_present",
      label: "Credential সংরক্ষিত আছে",
      status: integration.credential ? "pass" : "fail",
      evidence: integration.credential ? "এনক্রিপ্ট করা Credential পাওয়া গেছে" : "কোনো Credential সংরক্ষিত নেই",
    });

    // last sync freshness
    if (!integration.lastSyncAt) {
      checks.push({ key: "last_sync_freshness", label: "সর্বশেষ Sync", status: "warn", evidence: "এখনো কোনো Sync হয়নি" });
    } else {
      const at = new Date(integration.lastSyncAt);
      const ageMs = Date.now() - at.getTime();
      const status: HealthStatus = ageMs < 24 * 3600 * 1000 ? "pass" : ageMs < 7 * 24 * 3600 * 1000 ? "warn" : "fail";
      checks.push({ key: "last_sync_freshness", label: "সর্বশেষ Sync", status, evidence: `সর্বশেষ Sync: ${at.toISOString()}` });
    }

    if (integration.provider === "woocommerce") {
      checks.push(...(await this.wooChecks(integration)));
    } else if (integration.provider === "shopify") {
      checks.push(...(await this.shopifyChecks(integration)));
    }

    const overall = checks.reduce<HealthStatus>((worst, c) => (STATUS_ORDER[c.status] > STATUS_ORDER[worst] ? c.status : worst), "pass");
    return {
      integrationId: integration.id,
      provider: integration.provider,
      checkedAt: new Date().toISOString(),
      overall,
      checks,
    };
  }

  private async wooChecks(integration: any): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    const url: string = integration.store?.url ?? "";
    checks.push({
      key: "store_url_https",
      label: "স্টোর URL HTTPS",
      status: url.startsWith("https://") ? "pass" : "fail",
      evidence: url || "স্টোর URL নেই",
    });

    let client: WooClient | null = null;
    try {
      const secrets = this.integrations.getSecrets(integration);
      client = new WooClient(url, secrets);
    } catch (e) {
      checks.push({ key: "connection", label: "WooCommerce সংযোগ", status: "fail", evidence: e instanceof Error ? e.message : "unknown error" });
    }

    if (client) {
      try {
        const info = await client.testConnection();
        checks.push({
          key: "connection", label: "WooCommerce সংযোগ", status: "pass",
          evidence: `store: ${info.storeName ?? "?"} · version: ${info.version ?? "?"}`,
        });
      } catch (e) {
        checks.push({ key: "connection", label: "WooCommerce সংযোগ", status: "fail", evidence: e instanceof Error ? e.message : "unknown error" });
      }

      // Raw system_status details (WP / WC versions) — evidence only
      // from fields actually present.
      try {
        const { data } = await client.get<any>("/system_status");
        const parts: string[] = [];
        if (data?.environment?.version) parts.push(`WP: ${data.environment.version}`);
        if (data?.database?.wc_database_version) parts.push(`WC DB: ${data.database.wc_database_version}`);
        checks.push({
          key: "wc_version", label: "WordPress / WooCommerce সংস্করণ",
          status: parts.length > 0 ? "pass" : "unknown",
          evidence: parts.length > 0 ? parts.join(" · ") : "system_status থেকে সংস্করণ পাওয়া যায়নি",
        });
      } catch (e) {
        checks.push({ key: "wc_version", label: "WordPress / WooCommerce সংস্করণ", status: "unknown", evidence: e instanceof Error ? e.message : "unknown error" });
      }

      // CP3: read the store's real weight unit from the Woo
      // settings endpoint and persist it on the Store row when it
      // differs — product pushes convert grams into this unit.
      // Failure-isolated: any error keeps the stored value and
      // never fails the health check.
      try {
        const { data } = await client.get<any>("/settings/general");
        const rows = Array.isArray(data) ? data : [];
        const entry = rows.find((r: any) => r?.id === "woocommerce_weight_unit");
        const unit = entry?.value ? String(entry.value) : null;
        if (unit) {
          const storeId = (integration as any).storeId ?? integration.store?.id ?? null;
          const current = integration.store?.weightUnit ?? null;
          if (unit !== current && storeId) {
            const prisma: any = (this as any).prisma ?? (this.integrations as any)?.prisma ?? null;
            if (prisma?.store?.update) {
              await prisma.store.update({ where: { id: storeId }, data: { weightUnit: unit } });
              if (integration.store) integration.store.weightUnit = unit;
            }
          }
          checks.push({
            key: "weight_unit", label: "ওজনের একক", status: "pass",
            evidence: `স্টোরের ওজনের একক: ${unit}`,
          });
        }
      } catch { /* keep the existing Store.weightUnit — see above */ }

      const base = process.env.API_PUBLIC_URL?.replace(/\/+$/, "");
      if (!base) {
        checks.push({ key: "webhook_presence", label: "Webhook উপস্থিতি", status: "unknown", evidence: "API_PUBLIC_URL সেট নেই, যাচাই সম্ভব নয়" });
      } else {
        try {
          const hooks = await client.listWebhooks();
          const ours = (hooks ?? []).filter((h: any) => typeof h?.delivery_url === "string" && h.delivery_url.startsWith(`${base}/webhooks/woocommerce/${integration.id}`));
          checks.push({
            key: "webhook_presence", label: "Webhook উপস্থিতি",
            status: ours.length > 0 ? "pass" : "warn",
            evidence: ours.length > 0 ? `আমাদের ঠিকানায় ${ours.length}টি Webhook পাওয়া গেছে` : "আমাদের ঠিকানায় কোনো Webhook পাওয়া যায়নি",
          });
        } catch (e) {
          checks.push({ key: "webhook_presence", label: "Webhook উপস্থিতি", status: "unknown", evidence: e instanceof Error ? e.message : "unknown error" });
        }
      }
    }

    // EC10: the tracker snippet is what makes abandoned carts
    // visible for this store — verify it on the homepage honestly.
    const trackingKey = integration.store?.trackingKey ?? null;
    try {
      const tc = await checkTrackerOnHomepage(url, trackingKey);
      checks.push({ key: "tracker_detected", label: "Tracker বসানো (Abandoned Cart-এর জন্য)", status: tc.status, evidence: tc.evidence });
    } catch (e) {
      checks.push({ key: "tracker_detected", label: "Tracker বসানো (Abandoned Cart-এর জন্য)", status: "unknown", evidence: e instanceof Error ? e.message : "unknown error" });
    }

    // Honest: a read-only-safe check cannot prove write permission.
    checks.push({
      key: "key_write_permission",
      label: "API Key-এর Write অনুমতি",
      status: "unknown",
      evidence: "শুধুমাত্র পড়ার অনুমতি দিয়ে Write যাচাই করা যায় না — Key-এর Permission আসল স্টোরে Read/Write হতে হবে; একটি Write চেষ্টা না করে এটি প্রমাণ করা সম্ভব নয়।",
    });
    return checks;
  }

  private async shopifyChecks(integration: any): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    let client: any = null;
    try {
      client = await this.shopify.buildGraphQLClient(integration);
    } catch (e) {
      checks.push({ key: "connection", label: "Shopify সংযোগ", status: "fail", evidence: e instanceof Error ? e.message : "unknown error" });
    }

    if (client) {
      try {
        const shop = await client.shopProbe();
        const domain = shop?.primaryDomain?.url ?? shop?.domain ?? shop?.myshopifyDomain ?? "?";
        checks.push({
          key: "connection", label: "Shopify সংযোগ", status: "pass",
          evidence: `shop: ${shop?.name ?? "?"} · domain: ${domain}`,
        });
      } catch (e) {
        checks.push({ key: "connection", label: "Shopify সংযোগ", status: "fail", evidence: e instanceof Error ? e.message : "unknown error" });
      }

      try {
        const granted: string[] = await client.accessScopes();
        const missing = SHOPIFY_REQUIRED_SCOPES.filter((s) => !granted.includes(s));
        checks.push({
          key: "scopes", label: "Access Scopes",
          status: missing.length === 0 ? "pass" : "warn",
          evidence: missing.length === 0 ? `সব প্রয়োজনীয় Scope আছে (${granted.length}টি granted)` : `অনুপস্থিত Scope: ${missing.join(", ")}`,
        });
      } catch (e) {
        checks.push({ key: "scopes", label: "Access Scopes", status: "unknown", evidence: e instanceof Error ? e.message : "unknown error" });
      }

      const base = process.env.API_PUBLIC_URL?.replace(/\/+$/, "");
      if (!base) {
        checks.push({ key: "webhook_presence", label: "Webhook উপস্থিতি", status: "unknown", evidence: "API_PUBLIC_URL সেট নেই, যাচাই সম্ভব নয়" });
      } else {
        try {
          const topics: string[] = await client.webhookTopics();
          const missingTopics = SHOPIFY_WEBHOOK_TOPICS.filter((t) => !topics.includes(t));
          checks.push({
            key: "webhook_presence", label: "Webhook উপস্থিতি",
            status: missingTopics.length === 0 ? "pass" : "warn",
            evidence: missingTopics.length === 0 ? `সব ${SHOPIFY_WEBHOOK_TOPICS.length}টি Webhook Topic সক্রিয়` : `অনুপস্থিত Topic: ${missingTopics.join(", ")}`,
          });
        } catch (e) {
          checks.push({ key: "webhook_presence", label: "Webhook উপস্থিতি", status: "unknown", evidence: e instanceof Error ? e.message : "unknown error" });
        }
      }
    }

    // Token check
    const authType = integration.authType ?? null;
    if (authType === "client_credentials") {
      if (!integration.tokenExpiresAt) {
        checks.push({ key: "token", label: "Access Token", status: "unknown", evidence: "Token-এর মেয়াদ জানা নেই (expires_in পাওয়া যায়নি)" });
      } else {
        const expiresAt = new Date(integration.tokenExpiresAt);
        const remainingMs = expiresAt.getTime() - Date.now();
        checks.push({
          key: "token", label: "Access Token",
          status: remainingMs <= 0 ? "fail" : remainingMs < 3600 * 1000 ? "warn" : "pass",
          evidence: remainingMs <= 0 ? `টোকেনের মেয়াদ শেষ (${expiresAt.toISOString()})` : `মেয়াদ শেষ: ${expiresAt.toISOString()}`,
        });
      }
    } else {
      checks.push({ key: "token", label: "Access Token", status: "unknown", evidence: "Legacy Token — Shopify মেয়াদ জানায় না" });
    }
    return checks;
  }
}
