import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { encryptJson, decryptJson } from "../crypto";
import { IntegrationsService } from "../integrations.service";
import { InventoryService } from "../../inventory/inventory.service";
import { ShopifyClient, ShopifySecrets } from "./shopify.client";
import { normalizeShopifyProduct, normalizeShopifyOrder, normalizeShopifyVariant } from "./normalize";

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
    return {
      id: integration.id, provider: "shopify", status: integration.status, storeId: store.id,
      externalAccountId: integration.externalAccountId, shopName: shop.name, currency: shop.currency,
    };
  }

  private async getIntegration(organizationId: string, integrationId: string) {
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId, provider: "shopify" }, include: { store: true, credential: true },
    });
    if (!integration) throw new NotFoundException("Shopify integration not found");
    return integration;
  }

  private clientFor(integration: any): ShopifyClient {
    if (!integration.credential) throw new BadRequestException("Shopify credentials are missing; reconnect");
    const secrets = decryptJson<ShopifySecrets>(integration.credential.encryptedData);
    return new ShopifyClient(integration.store.url, secrets);
  }

  async syncProducts(organizationId: string, actorId: string, integrationId: string) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const job = await (this.prisma as any).syncJob.create({ data: { integrationId, kind: "products", status: "RUNNING" } });
    const stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
    try {
      const client = this.clientFor(integration);
      const cursor = integration.productsCursor as Date | null;
      const raws = await client.listProducts(cursor ? cursor.toISOString() : undefined);
      let maxModified: Date | null = cursor;
      for (const raw of raws) {
        stats.fetched++;
        const result = await this.integrations.upsertProduct(organizationId, normalizeShopifyProduct(raw, integration.store?.currency ?? "BDT"), "shopify");
        stats[result]++;
        await this.upsertVariants(organizationId, raw);
        const modified = raw.updated_at ? new Date(raw.updated_at) : null;
        if (modified && (!maxModified || modified > maxModified)) maxModified = modified;
      }
      const done = await (this.prisma as any).syncJob.update({ where: { id: job.id }, data: { status: "COMPLETED", ...stats, completedAt: new Date() } });
      await (this.prisma as any).integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date(), productsCursor: maxModified ?? cursor, status: "CONNECTED", lastError: null } });
      await this.audit.log({ organizationId, userId: actorId, action: "sync.products", entityType: "SyncJob", entityId: job.id, metadata: { ...stats, provider: "shopify" } });
      return done;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
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

  async syncOrders(organizationId: string, actorId: string, integrationId: string) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const job = await (this.prisma as any).syncJob.create({ data: { integrationId, kind: "orders", status: "RUNNING" } });
    const stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
    try {
      const client = this.clientFor(integration);
      const cursor = integration.ordersCursor as Date | null;
      const raws = await client.listOrders(cursor ? cursor.toISOString() : undefined);
      let maxModified: Date | null = cursor;
      for (const raw of raws) {
        stats.fetched++;
        const result = await this.integrations.upsertOrder(organizationId, integration.storeId, normalizeShopifyOrder(raw), "shopify");
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
      await this.integrations.upsertProduct(orgId, normalizeShopifyProduct(payload, integration.store?.currency ?? "BDT"), "shopify");
      await this.upsertVariants(orgId, payload);
      return { processed: "product" };
    }
    if (topic === "orders/create" || topic === "orders/update" || topic === "orders/paid") {
      await this.integrations.upsertOrder(orgId, integration.storeId, normalizeShopifyOrder(payload), "shopify");
      return { processed: "order" };
    }
    return { processed: "ignored", topic };
  }
}
