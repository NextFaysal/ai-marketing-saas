import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { encryptJson, decryptJson } from "../crypto";
import { IntegrationsService } from "../integrations.service";
import { InventoryService } from "../../inventory/inventory.service";
import { ShopifyClient, ShopifySecrets } from "./shopify.client";
import { normalizeShopifyProduct, normalizeShopifyOrder, normalizeShopifyVariant } from "./normalize";
import { exchangeShopifyClientCredentials } from "./shopify-auth";
import { ShopifyGraphQLClient } from "./shopify-graphql.client";
import { BULK_PRODUCTS_QUERY, parseBulkProductsJsonl } from "./shopify-bulk";
import { ensureShopifyWebhookSubscriptions } from "./shopify-webhooks";
import { normalizeShopifyCustomerNode, upsertSyncedCustomer } from "../customer-sync";
import { ErasureService } from "../../customers/erasure.service";
import { upsertAbandonedStoreCheckout } from "./shopify-checkouts";
import { cadenceSkip } from "../sync-cadence";
import { isOrderLimitBlocked } from "../../common/plan-limit-checks";

const EC_CUSTOMERS_QUERY = `query ecCustomers($first: Int!, $after: String) { customers(first: $first, after: $after) { edges { node { id firstName lastName email phone defaultAddress { address1 address2 city zip country phone } } } pageInfo { hasNextPage endCursor } } }`;

/** EC2: stored Shopify secrets — legacy fields plus the optional
 *  Dev Dashboard client-credentials pair. apiSecret stays the HMAC
 *  secret for webhooks; for client_credentials it equals clientSecret. */
export interface ShopifyStoredSecrets extends ShopifySecrets {
  clientId?: string;
  clientSecret?: string;
  authType?: string;
}

export function verifyShopifyHmac(rawBody: string, hmacHeader: string | undefined, secret: string): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
    @Optional() private readonly inventory?: InventoryService,
    // CP6: shared GDPR erasure (see customers/erasure.service).
    @Optional() private readonly erasure?: ErasureService,
  ) {}

  async connect(organizationId: string, actorId: string, dto: { storeId: string; accessToken: string; apiSecret: string }) {
    const store = await (this.prisma as any).store.findFirst({ where: { id: dto.storeId, organizationId } });
    if (!store) throw new NotFoundException("Store not found in this organization");
    const secrets: ShopifySecrets = { accessToken: dto.accessToken, apiSecret: dto.apiSecret };
    // Verified against the real shop BEFORE anything is saved.
    let shop: { id: number; name: string; currency: string; domain: string };
    try {
      shop = await new ShopifyClient(store.url, secrets).testConnection();
    } catch (e) {
      throw new BadRequestException(`Shopify connection failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const existing = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "shopify", storeId: store.id },
    });
    let integration = existing;
    if (integration) {
      integration = await (this.prisma as any).integration.update({
        where: { id: integration.id }, data: { status: "CONNECTED", lastError: null, externalAccountId: String(shop.id) },
      });
      await (this.prisma as any).integrationCredential.upsert({
        where: { integrationId: integration.id },
        update: { encryptedData: encryptJson(secrets) },
        create: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
      });
    } else {
      integration = await (this.prisma as any).integration.create({
        data: { organizationId, storeId: store.id, provider: "shopify", status: "CONNECTED", externalAccountId: String(shop.id) },
      });
      await (this.prisma as any).integrationCredential.create({
        data: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "integration.connect", entityType: "Integration", entityId: integration.id, metadata: { provider: "shopify", shop: shop.domain } });
    const webhookRegistration = await this.attemptShopifyWebhookSubscriptions(integration);
    return {
      id: integration.id, provider: "shopify", status: integration.status, storeId: store.id,
      externalAccountId: integration.externalAccountId, shopName: shop.name, currency: shop.currency,
      webhookRegistration,
    };
  }

  /** EC2: Shopify Dev Dashboard client-credentials connect.
   *  Token exchange and a GraphQL shop probe happen BEFORE anything
   *  is saved — a failure saves nothing and surfaces verbatim. */
  async connectClientCredentials(organizationId: string, actorId: string, dto: { storeId: string; clientId: string; clientSecret: string }) {
    if (!dto.clientId || !dto.clientSecret) throw new BadRequestException("clientId এবং clientSecret দুটোই দিন");
    const store = await (this.prisma as any).store.findFirst({ where: { id: dto.storeId, organizationId } });
    if (!store) throw new NotFoundException("Store not found in this organization");
    let exchanged: { accessToken: string; expiresIn: number | null; scope: string | null };
    try {
      exchanged = await exchangeShopifyClientCredentials(store.url, dto.clientId, dto.clientSecret);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "unknown error");
    }
    let probe: any;
    try {
      probe = await new ShopifyGraphQLClient(store.url, exchanged.accessToken).shopProbe();
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "unknown error");
    }
    const secrets: ShopifyStoredSecrets = {
      accessToken: exchanged.accessToken, apiSecret: dto.clientSecret,
      clientId: dto.clientId, clientSecret: dto.clientSecret, authType: "client_credentials",
    };
    const tokenExpiresAt = exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000) : null;
    const probeId = probe?.id;
    let externalAccountId: string | undefined;
    if (typeof probeId === "number" && Number.isFinite(probeId)) externalAccountId = String(probeId);
    else if (typeof probeId === "string" && /^\d+$/.test(probeId)) externalAccountId = probeId;
    else if (typeof probeId === "string") { const m = probeId.match(/(\d+)\s*$/); if (m) externalAccountId = m[1]; }
    const shopDomain = probe?.primaryDomain?.url ?? probe?.domain ?? probe?.myshopifyDomain ?? store.url;
    const existing = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "shopify", storeId: store.id },
    });
    let integration = existing;
    if (integration) {
      integration = await (this.prisma as any).integration.update({
        where: { id: integration.id },
        data: { status: "CONNECTED", lastError: null, authType: "client_credentials", tokenExpiresAt, ...(externalAccountId ? { externalAccountId } : {}) },
      });
      await (this.prisma as any).integrationCredential.upsert({
        where: { integrationId: integration.id },
        update: { encryptedData: encryptJson(secrets) },
        create: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
      });
    } else {
      integration = await (this.prisma as any).integration.create({
        data: { organizationId, storeId: store.id, provider: "shopify", status: "CONNECTED", authType: "client_credentials", tokenExpiresAt, ...(externalAccountId ? { externalAccountId } : {}) },
      });
      await (this.prisma as any).integrationCredential.create({
        data: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "integration.connect", entityType: "Integration", entityId: integration.id, metadata: { provider: "shopify", authType: "client_credentials", shop: shopDomain } });
    const webhookRegistration = await this.attemptShopifyWebhookSubscriptions(integration);
    return {
      id: integration.id, provider: "shopify", status: integration.status, storeId: store.id,
      externalAccountId: integration.externalAccountId ?? externalAccountId, shopName: probe?.name,
      currency: probe?.currencyCode ?? probe?.currency, authType: "client_credentials", webhookRegistration,
    };
  }

  /**
   * EC2: return usable secrets, re-exchanging a client-credentials
   * token when it is expired / inside the 5-minute safety window.
   * When the exchange reports no expires_in, tokenExpiresAt is set
   * to null and the token is treated as non-expiring for refresh
   * purposes (a null tokenExpiresAt with a present access token does
   * not trigger another exchange). Exchange failure throws a
   * BadRequest with the verbatim message — sync failing loudly
   * beats silently using a dead token.
   */
  async refreshTokenIfNeeded(integration: any): Promise<ShopifyStoredSecrets> {
    if (!integration.credential) throw new BadRequestException("Shopify credentials are missing; reconnect");
    const secrets = decryptJson<ShopifyStoredSecrets>(integration.credential.encryptedData);
    const authType = (secrets as any).authType ?? integration.authType;
    if (authType !== "client_credentials") return secrets;
    if (secrets.accessToken) {
      if (integration.tokenExpiresAt === null || integration.tokenExpiresAt === undefined) return secrets; // non-expiring per exchange (see above)
      const expiresAt = new Date(integration.tokenExpiresAt);
      if (expiresAt.getTime() > Date.now() + 5 * 60 * 1000) return secrets;
    }
    if (!secrets.clientId || !secrets.clientSecret) {
      throw new BadRequestException("Shopify client credentials are missing; reconnect with clientId/clientSecret");
    }
    if (!integration.store?.url) throw new BadRequestException("Shopify integration has no store");
    let exchanged: { accessToken: string; expiresIn: number | null; scope: string | null };
    try {
      exchanged = await exchangeShopifyClientCredentials(integration.store.url, secrets.clientId, secrets.clientSecret);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "unknown error");
    }
    const next: ShopifyStoredSecrets = { ...secrets, accessToken: exchanged.accessToken, apiSecret: secrets.clientSecret };
    const tokenExpiresAt = exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000) : null;
    await (this.prisma as any).integrationCredential.upsert({
      where: { integrationId: integration.id },
      update: { encryptedData: encryptJson(next) },
      create: { integrationId: integration.id, encryptedData: encryptJson(next) },
    });
    await (this.prisma as any).integration.update({ where: { id: integration.id }, data: { tokenExpiresAt } });
    integration.tokenExpiresAt = tokenExpiresAt;
    if (integration.credential) integration.credential.encryptedData = encryptJson(next);
    return next;
  }

  /** EC2: token-aware GraphQL client for this integration. */
  async buildGraphQLClient(integration: any): Promise<ShopifyGraphQLClient> {
    const secrets = await this.refreshTokenIfNeeded(integration);
    return new ShopifyGraphQLClient(integration.store.url, secrets.accessToken);
  }

  private async recordShopifyWebhookStatus(integration: any, webhookStatus: any): Promise<void> {
    integration.webhookStatus = webhookStatus;
    try {
      await (this.prisma as any).integration.update({ where: { id: integration.id }, data: { webhookStatus } });
    } catch (e) { this.logger.warn(`recording shopify webhookStatus failed: ${e instanceof Error ? e.message : "unknown"}`); }
  }

  /** EC2: ensure webhook subscriptions; never throws. */
  private async attemptShopifyWebhookSubscriptions(integration: any, _actorId?: string): Promise<string> {
    const base = process.env.API_PUBLIC_URL?.replace(/\/+$/, "");
    if (!base) {
      const webhookStatus = { provider: "shopify", status: "skipped_no_public_url", updatedAt: new Date().toISOString() };
      await this.recordShopifyWebhookStatus(integration, webhookStatus);
      return "skipped_no_public_url";
    }
    const callbackUrl = `${base}/webhooks/shopify/${integration.id}`;
    let results: Array<{ topic: string; status: string; error?: string }>;
    try {
      const client = await this.buildGraphQLClient(integration);
      results = await ensureShopifyWebhookSubscriptions(client, { callbackUrl });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      const webhookStatus = { provider: "shopify", status: "manual_required", error: message, updatedAt: new Date().toISOString() };
      await this.recordShopifyWebhookStatus(integration, webhookStatus);
      return "manual_required";
    }
    const okCount = results.filter((r) => r.status === "created" || r.status === "exists").length;
    const status = okCount === results.length && results.length > 0 ? "registered" : okCount > 0 ? "partial" : "failed";
    const topics: Record<string, { status: string; error?: string }> = {};
    for (const r of results) topics[r.topic] = { status: r.status, ...(r.error ? { error: r.error } : {}) };
    const webhookStatus = { provider: "shopify", status, topics, callbackUrl, updatedAt: new Date().toISOString() };
    await this.recordShopifyWebhookStatus(integration, webhookStatus);
    return status;
  }

  /** EC2: re-run Shopify webhook subscription ensure. */
  async repairWebhooks(organizationId: string, actorId: string, integrationId: string) {
    const integration = await this.integrations.getIntegration(organizationId, integrationId);
    if (integration.provider !== "shopify") throw new BadRequestException("Webhook repair is only available for Shopify integrations");
    const webhookRegistration = await this.attemptShopifyWebhookSubscriptions(integration, actorId);
    await this.audit.log({ organizationId, userId: actorId, action: "integration.repair_webhooks", entityType: "Integration", entityId: integration.id, metadata: { provider: "shopify", webhookRegistration } });
    return { integrationId: integration.id, webhookRegistration, webhookStatus: integration.webhookStatus };
  }

  /**
   * EC2: mandatory Shopify GDPR webhooks (customers/data_request,
   * customers/redact, shop/redact). There is no single integration
   * id in the URL for these, so the owning integration is found by
   * verifying the HMAC against candidate integrations' apiSecrets.
   * AuditService maps userId "system" to a null actor (real FK).
   */
  async handleGdpr(topic: string, rawBody: string, hmac: string | undefined, webhookId?: string) {
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch { throw new BadRequestException("Invalid Shopify GDPR payload"); }
    const shopDomain: string | undefined = payload?.shop_domain;
    let candidates: any[] = await (this.prisma as any).integration.findMany({
      where: { provider: "shopify" }, include: { credential: true, store: true }, take: 50,
    });
    candidates = candidates ?? [];
    const hostOf = (url: string | undefined) => { try { return new URL(url ?? "").host; } catch { return undefined; } };
    if (process.env.SHOPIFY_APP_SECRET && shopDomain) {
      const matching = candidates.filter((c: any) => hostOf(c.store?.url) === shopDomain);
      if (matching.length > 0) {
        // Env-secret handling first: try the app secret against the
        // domain-matching candidates before per-integration secrets.
        for (const integration of matching) {
          if (verifyShopifyHmac(rawBody, hmac, process.env.SHOPIFY_APP_SECRET)) {
            return this.recordGdpr(integration, topic, payload, shopDomain, webhookId);
          }
        }
      }
    }
    let verified: any = null;
    for (const integration of candidates) {
      if (!integration.credential) continue;
      let apiSecret: string | undefined;
      try { apiSecret = decryptJson<ShopifyStoredSecrets>(integration.credential.encryptedData).apiSecret; } catch { continue; }
      if (apiSecret && verifyShopifyHmac(rawBody, hmac, apiSecret)) { verified = integration; break; }
      // A shared app secret may be the HMAC secret even when the
      // stored apiSecret differs (env-configured app).
      if (process.env.SHOPIFY_APP_SECRET && verifyShopifyHmac(rawBody, hmac, process.env.SHOPIFY_APP_SECRET)) { verified = integration; break; }
    }
    if (!verified) throw new BadRequestException("Invalid Shopify webhook signature");
    return this.recordGdpr(verified, topic, payload, shopDomain, webhookId);
  }

  private async recordGdpr(integration: any, topic: string, payload: any, shopDomain: string | undefined, webhookId?: string) {
    if (webhookId) {
      const seen = await (this.prisma as any).webhookEvent.findFirst({ where: { integrationId: integration.id, deliveryId: webhookId } });
      if (seen) return { received: true, duplicate: true };
    }
    await (this.prisma as any).webhookEvent.create({
      data: { integrationId: integration.id, provider: "shopify", topic, deliveryId: webhookId ?? null, payload, signatureValid: true, processedAt: new Date() },
    });
    if (topic === "customers/data_request" || topic === "customers/redact") {
      await this.audit.log({
        organizationId: integration.organizationId, userId: "system",
        action: `shopify.gdpr.${topic.replace("/", "_")}`, entityType: "Integration", entityId: integration.id,
        metadata: { shopDomain },
      });
    }
    // CP6: customers/redact now actually erases — resolve the
    // local customer by Shopify externalId, else by email, and run
    // the shared deep erasure. Failure-isolated: the webhook ack
    // ({ received, recorded, topic }) is unchanged either way, and
    // the HMAC/dedupe behaviour above is untouched.
    if (topic === "customers/redact" && this.erasure) {
      try {
        const extId = payload?.customer?.id != null ? String(payload.customer.id) : null;
        const email = payload?.customer?.email ?? null;
        let customer: any = null;
        if (extId) {
          customer = await (this.prisma as any).customer.findFirst({
            where: { organizationId: integration.organizationId, externalId: extId },
          }).catch(() => null);
        }
        if (!customer && email) {
          customer = await (this.prisma as any).customer.findFirst({
            where: { organizationId: integration.organizationId, email },
          }).catch(() => null);
        }
        if (customer) {
          await this.erasure.eraseCustomer(integration.organizationId, "shopify_gdpr", customer.id);
        }
      } catch (e) {
        this.logger.warn(`GDPR customers/redact erasure failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
    if (topic === "shop/redact") {
      await (this.prisma as any).integration.update({ where: { id: integration.id }, data: { status: "DISCONNECTED" } });
      await this.audit.log({
        organizationId: integration.organizationId, userId: "system",
        action: "shopify.gdpr.shop_redact", entityType: "Integration", entityId: integration.id,
        metadata: { shopDomain },
      });
    }
    return { received: true, recorded: true, topic };
  }

  private async getIntegration(organizationId: string, integrationId: string) {
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId, provider: "shopify" }, include: { store: true, credential: true },
    });
    if (!integration) throw new NotFoundException("Shopify integration not found");
    return integration;
  }

  /** CC18: the sync-pause gate — same recorded-skip discipline
   * as IntegrationsService.pausedSkip (a COMPLETED SyncJob whose
   * error carries "sync_paused" + the AD5-style skip marker). */
  private async pausedSkip(integration: any, kind: string): Promise<any | null> {
    if (!integration || integration.syncPaused !== true) return null;
    const job = await (this.prisma as any).syncJob.create({
      data: {
        integrationId: integration.id, kind, status: "COMPLETED",
        fetched: 0, created: 0, updated: 0, skipped: 0,
        error: "sync_paused", completedAt: new Date(),
      },
    });
    return { skipped: true, reason: "sync_paused", jobId: job.id, job };
  }

  private async clientFor(integration: any): Promise<ShopifyClient> {
    if (!integration.credential) throw new BadRequestException("Shopify credentials are missing; reconnect");
    const secrets = await this.refreshTokenIfNeeded(integration);
    return new ShopifyClient(integration.store.url, secrets);
  }

  /** EC12: shared per-raw ingest for both the REST paginated path
   *  and the bulk path. Returns the newest updated_at seen. */
  private async ingestProductRaws(organizationId: string, integration: any, raws: any[], stats: { fetched: number; created: number; updated: number; skipped: number }): Promise<Date | null> {
    let maxModified: Date | null = null;
    for (const raw of raws) {
      stats.fetched++;
      const result = await this.integrations.upsertProduct(organizationId, normalizeShopifyProduct(raw, integration.store?.currency ?? "BDT"), "shopify", integration.storeId);
      stats[result]++;
      await this.upsertVariants(organizationId, raw);
      await this.integrations.wireProductListing(organizationId, integration.storeId, "shopify", String(raw.id), raw.updated_at ? new Date(raw.updated_at) : null);
      const modified = raw.updated_at ? new Date(raw.updated_at) : null;
      if (modified && (!maxModified || modified > maxModified)) maxModified = modified;
    }
    return maxModified;
  }

  /**
   * EC12: run a bulk product export and return REST-like raws.
   * Throws on FAILED/CANCELED/EXPIRED, on timeout, and on a
   * completed operation with results but no download URL — the
   * caller falls back to the REST paginated path on any throw.
   */
  private async fetchBulkProductRaws(integration: any): Promise<any[]> {
    const gql = await this.buildGraphQLClient(integration);
    await gql.runBulkOperation(BULK_PRODUCTS_QUERY);
    const maxPolls = Number(process.env.SHOPIFY_BULK_MAX_POLLS ?? 30);
    const delayMs = Number(process.env.SHOPIFY_BULK_POLL_MS ?? 2000);
    let completed: any = null;
    for (let poll = 0; poll < maxPolls; poll++) {
      const cur = await gql.currentBulkOperation();
      if (cur?.status === "COMPLETED") { completed = cur; break; }
      if (cur && ["FAILED", "CANCELED", "EXPIRED"].includes(cur.status)) {
        throw new Error(`Shopify bulk operation ${cur.status}${cur.errorCode ? `: ${cur.errorCode}` : ""}`);
      }
      if (delayMs > 0 && poll < maxPolls - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (!completed) throw new Error("Shopify bulk operation timed out");
    if (completed.url) {
      const text = await gql.downloadBulkResult(completed.url);
      return parseBulkProductsJsonl(text);
    }
    if (Number(completed.objectCount ?? 0) === 0) return [];
    throw new Error("Shopify bulk operation completed without a result URL");
  }

  async syncProducts(organizationId: string, actorId: string, integrationId: string, opts?: { bulk?: boolean; scheduled?: boolean }) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const paused = await this.pausedSkip(integration, "products");
    if (paused) return paused;
    if (opts?.scheduled) { const cadence = await cadenceSkip(this.prisma, integration, "products"); if (cadence) return cadence; }
    const job = await (this.prisma as any).syncJob.create({ data: { integrationId, kind: "products", status: "RUNNING" } });
    const stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
    let bulkUsed: string | undefined;
    let bulkFallback = false;
    let bulkError: string | undefined;
    try {
      const cursor = integration.productsCursor as Date | null;
      let maxModified: Date | null = null;
      if (opts?.bulk) {
        try {
          const raws = await this.fetchBulkProductRaws(integration);
          maxModified = await this.ingestProductRaws(organizationId, integration, raws, stats);
          bulkUsed = "bulk";
        } catch (bulkErr) {
          // EC12: bulk is an optimization, never a hard dependency —
          // any bulk failure falls back to the proven REST path and
          // is recorded honestly on the result + audit metadata.
          bulkError = bulkErr instanceof Error ? bulkErr.message : String(bulkErr);
          bulkFallback = true;
          const client = await this.clientFor(integration);
          const raws = await client.listProducts(cursor ? cursor.toISOString() : undefined);
          maxModified = await this.ingestProductRaws(organizationId, integration, raws, stats);
        }
      } else {
        const client = await this.clientFor(integration);
        const raws = await client.listProducts(cursor ? cursor.toISOString() : undefined);
        maxModified = await this.ingestProductRaws(organizationId, integration, raws, stats);
      }
      const finalCursor = maxModified && cursor ? (maxModified > cursor ? maxModified : cursor) : (maxModified ?? cursor);
      const done = await (this.prisma as any).syncJob.update({ where: { id: job.id }, data: { status: "COMPLETED", ...stats, completedAt: new Date() } });
      await (this.prisma as any).integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date(), productsCursor: finalCursor, status: "CONNECTED", lastError: null } });
      await this.audit.log({
        organizationId, userId: actorId, action: "sync.products", entityType: "SyncJob", entityId: job.id,
        metadata: {
          ...stats, provider: "shopify",
          ...(bulkUsed ? { syncMode: bulkUsed } : {}),
          ...(bulkFallback ? { bulkFallback: true, bulkError } : {}),
        },
      });
      if (bulkFallback) return { ...done, bulkFallback: true, bulkError };
      if (bulkUsed) return { ...done, bulkUsed };
      return done;
    } catch (e) {
      const base = e instanceof Error ? e.message : "Sync failed";
      const message = bulkError ? `${base} (bulk attempt failed first: ${bulkError})` : base;
      await (this.prisma as any).syncJob.update({ where: { id: job.id }, data: { status: "FAILED", ...stats, error: message, completedAt: new Date() } });
      await (this.prisma as any).integration.update({ where: { id: integrationId }, data: { status: "ERROR", lastError: message } });
      throw new BadRequestException(`Shopify product sync failed: ${message}`);
    }
  }

  private async upsertVariants(organizationId: string, rawProduct: any) {
    const product = await (this.prisma as any).product.findFirst({
      where: { organizationId, source: "shopify", externalId: String(rawProduct.id) },
    });
    if (!product) return;
    for (const rawVariant of rawProduct.variants ?? []) {
      const v = normalizeShopifyVariant(rawVariant);
      const existing = v.sku
        ? await (this.prisma as any).productVariant.findFirst({ where: { productId: product.id, sku: v.sku } })
        : await (this.prisma as any).productVariant.findFirst({ where: { productId: product.id, name: v.name } });
      if (existing) {
        // S1: ledger the stock jump before the overwrite.
        try {
          await this.inventory?.recordSyncedStock(organizationId, product.id, existing.id, existing.stockQuantity ?? null, v.stockQuantity ?? null);
        } catch (e) { this.logger.warn(`inventory sync_correction (shopify variant) failed: ${e instanceof Error ? e.message : "unknown"}`); }
        await (this.prisma as any).productVariant.update({ where: { id: existing.id }, data: { priceMinor: v.priceMinor ?? null, stockQuantity: v.stockQuantity } });
      } else {
        await (this.prisma as any).productVariant.create({
          data: { productId: product.id, name: v.name, sku: v.sku ?? null, priceMinor: v.priceMinor ?? null, stockQuantity: v.stockQuantity },
        });
      }
    }
  }

  async syncOrders(organizationId: string, actorId: string, integrationId: string, opts?: { scheduled?: boolean }) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const paused = await this.pausedSkip(integration, "orders");
    if (paused) return paused;
    if (opts?.scheduled) { const cadence = await cadenceSkip(this.prisma, integration, "orders"); if (cadence) return cadence; }
    const job = await (this.prisma as any).syncJob.create({ data: { integrationId, kind: "orders", status: "RUNNING" } });
    const stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
    try {
      const client = await this.clientFor(integration);
      const cursor = integration.ordersCursor as Date | null;
      const raws = await client.listOrders(cursor ? cursor.toISOString() : undefined);
      let maxModified: Date | null = cursor;
      for (const raw of raws) {
        stats.fetched++;
        // GC22: a plan/order-limit block skips THIS order; the
        // sync continues and the cursor does not advance past
        // the skipped order (retryable once the block lifts).
        let result: "created" | "updated";
        try {
          result = await this.integrations.upsertOrder(organizationId, integration.storeId, normalizeShopifyOrder(raw), "shopify");
        } catch (e) {
          if (isOrderLimitBlocked(e)) { stats.skipped++; continue; }
          throw e;
        }
        stats[result]++;
        const modified = raw.updated_at ? new Date(raw.updated_at) : null;
        if (modified && (!maxModified || modified > maxModified)) maxModified = modified;
      }
      const done = await (this.prisma as any).syncJob.update({ where: { id: job.id }, data: { status: "COMPLETED", ...stats, completedAt: new Date() } });
      await (this.prisma as any).integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date(), ordersCursor: maxModified ?? cursor, status: "CONNECTED", lastError: null } });
      await this.audit.log({ organizationId, userId: actorId, action: "sync.orders", entityType: "SyncJob", entityId: job.id, metadata: { ...stats, provider: "shopify" } });
      return done;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      await (this.prisma as any).syncJob.update({ where: { id: job.id }, data: { status: "FAILED", ...stats, error: message, completedAt: new Date() } });
      await (this.prisma as any).integration.update({ where: { id: integrationId }, data: { status: "ERROR", lastError: message } });
      throw new BadRequestException(`Shopify order sync failed: ${message}`);
    }
  }

  async syncCustomers(organizationId: string, actorId: string, integrationId: string, opts?: { scheduled?: boolean }) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const paused = await this.pausedSkip(integration, "customers");
    if (paused) return paused;
    if (opts?.scheduled) { const cadence = await cadenceSkip(this.prisma, integration, "customers"); if (cadence) return cadence; }
    const job = await (this.prisma as any).syncJob.create({ data: { integrationId, kind: "customers", status: "RUNNING" } });
    const stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
    const errors: string[] = [];
    try {
      if (!integration.storeId) throw new BadRequestException("Integration has no store");
      const client = await this.buildGraphQLClient(integration);
      let after: string | null = null;
      for (let page = 0; page < 20; page++) {
        const data: any = await client.request<any>(EC_CUSTOMERS_QUERY, { first: 100, after });
        const conn: any = (data as any)?.customers;
        const edges: any[] = conn?.edges ?? [];
        for (const edge of edges) {
          const node = edge?.node;
          if (!node) continue;
          stats.fetched++;
          try {
            const result = await upsertSyncedCustomer(this.prisma, {
              organizationId, storeId: integration.storeId, source: "shopify", customer: normalizeShopifyCustomerNode(node),
            });
            stats[result]++;
          } catch (e) {
            stats.skipped++;
            if (errors.length < 20) errors.push(e instanceof Error ? e.message : String(e));
          }
        }
        const pageInfo: any = conn?.pageInfo;
        if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
        after = pageInfo.endCursor;
      }
      const done = await (this.prisma as any).syncJob.update({
        where: { id: job.id }, data: { status: "COMPLETED", ...stats, error: errors[0] ?? null, completedAt: new Date() },
      });
      await (this.prisma as any).integration.update({
        where: { id: integrationId }, data: { lastSyncAt: new Date(), status: "CONNECTED", lastError: null },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "sync.customers", entityType: "SyncJob", entityId: job.id, metadata: { ...stats, provider: "shopify" } });
      return { ...done, errors, stats };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      await (this.prisma as any).syncJob.update({ where: { id: job.id }, data: { status: "FAILED", ...stats, error: message, completedAt: new Date() } });
      await (this.prisma as any).integration.update({ where: { id: integrationId }, data: { status: "ERROR", lastError: message } });
      throw new BadRequestException(`Shopify customer sync failed: ${message}`);
    }
  }

  async handleWebhook(integrationId: string, rawBody: string, hmac: string | undefined, topic: string | undefined, webhookId: string | undefined) {
    const integration = await (this.prisma as any).integration.findUnique({
      where: { id: integrationId }, include: { credential: true, store: true },
    });
    if (!integration || integration.provider !== "shopify" || !integration.credential) throw new NotFoundException("Integration not found");
    const secrets = decryptJson<ShopifySecrets>(integration.credential.encryptedData);
    if (!verifyShopifyHmac(rawBody, hmac, secrets.apiSecret)) {
      throw new BadRequestException("Invalid Shopify webhook signature");
    }
    // Dedupe on Shopify's webhook id (retries are expected).
    if (webhookId) {
      const seen = await (this.prisma as any).webhookEvent.findFirst({ where: { integrationId, deliveryId: webhookId } });
      if (seen) return { duplicate: true };
    }
    const payload = JSON.parse(rawBody);
    await (this.prisma as any).webhookEvent.create({
      data: { integrationId, provider: "shopify", topic: topic ?? null, deliveryId: webhookId ?? null, payload, signatureValid: true, processedAt: new Date() },
    });
    const orgId: string = integration.organizationId;
    if (topic === "products/create" || topic === "products/update") {
      await this.integrations.upsertProduct(orgId, normalizeShopifyProduct(payload, integration.store?.currency ?? "BDT"), "shopify", integration.storeId);
      await this.upsertVariants(orgId, payload);
      await this.integrations.wireProductListing(orgId, integration.storeId, "shopify", String(payload.id), payload.updated_at ? new Date(payload.updated_at) : null);
      return { processed: "product" };
    }
    if (topic === "orders/create" || topic === "orders/update" || topic === "orders/paid") {
      // GC22: a plan/order-limit block is NOT a webhook failure —
      // the event row above is the record; ack the delivery so
      // Shopify does not retry-storm a merchant-side limit.
      try {
        await this.integrations.upsertOrder(orgId, integration.storeId, normalizeShopifyOrder(payload), "shopify");
      } catch (e) {
        if (isOrderLimitBlocked(e)) return { processed: "order_skipped_plan_limit" };
        throw e;
      }
      return { processed: "order" };
    }
    if (topic === "checkouts/create" || topic === "checkouts/update") {
      // EC10: abandoned-checkout capture. Failure-isolated — a bad
      // checkout payload must never fail the webhook delivery (the
      // event row above is already recorded either way).
      if (integration.storeId) {
        try {
          await upsertAbandonedStoreCheckout(this.prisma, { organizationId: orgId, storeId: integration.storeId, payload });
        } catch (e) {
          this.logger.warn(`Shopify checkout webhook upsert failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { processed: "checkout" };
    }
    return { processed: "ignored", topic };
  }
}
