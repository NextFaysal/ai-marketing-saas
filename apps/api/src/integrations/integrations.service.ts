import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateStoreDto, ConnectWooDto } from "./integrations.dto";
import { encryptJson, decryptJson } from "./crypto";
import { randomUUID } from "crypto";
import { WooClient, WooCredentials } from "./woocommerce/woo.client";
import { normalizeWooProduct, normalizeWooVariation, normalizeWooOrder, NormalizedOrder, NormalizedProduct } from "./woocommerce/normalize";

const MAX_SYNC_PAGES = 10; // 10 pages x 100 = at most 1000 records per manual sync run
const PER_PAGE = 100;

export interface WooConnectionSecrets extends WooCredentials { webhookSecret?: string }

@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, @Optional() private readonly events?: import("../common/events.service").EventsService) {}

  // ---------- Stores ----------
  async createStore(organizationId: string, actorId: string, dto: CreateStoreDto) {
    const store = await (this.prisma as any).store.create({
      data: {
        organizationId, name: dto.name.trim(), url: dto.url.replace(/\/+$/, ""),
        currency: dto.currency ?? "BDT", timezone: dto.timezone ?? "Asia/Dhaka", platform: (["WOOCOMMERCE", "SHOPIFY", "CUSTOM"] as const).includes(dto.platform as any) ? dto.platform : "WOOCOMMERCE", trackingKey: randomUUID(),
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "store.create", entityType: "Store", entityId: store.id });
    return store;
  }

  async listStores(organizationId: string) {
    return (this.prisma as any).store.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  }

  // ---------- Connect ----------
  async connectWooCommerce(organizationId: string, actorId: string, dto: ConnectWooDto) {
    const store = await (this.prisma as any).store.findFirst({ where: { id: dto.storeId, organizationId } });
    if (!store) throw new NotFoundException("Store not found in this organization");

    // Test with the supplied credentials BEFORE persisting anything.
    // A failed test never stores secrets and never marks the store connected.
    const client = new WooClient(store.url, { consumerKey: dto.consumerKey, consumerSecret: dto.consumerSecret });
    try {
      await client.testConnection();
    } catch (e) {
      throw new BadRequestException(`WooCommerce connection failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }

    const existing = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "woocommerce", storeId: store.id },
    });
    const secrets: WooConnectionSecrets = {
      consumerKey: dto.consumerKey, consumerSecret: dto.consumerSecret, webhookSecret: dto.webhookSecret,
    };
    let integration = existing;
    if (!integration) {
      integration = await (this.prisma as any).integration.create({
        data: { organizationId, storeId: store.id, provider: "woocommerce", status: "CONNECTED" },
      });
    } else {
      integration = await (this.prisma as any).integration.update({
        where: { id: integration.id }, data: { status: "CONNECTED", lastError: null },
      });
    }
    await (this.prisma as any).integrationCredential.upsert({
      where: { integrationId: integration.id },
      update: { encryptedData: encryptJson(secrets) },
      create: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "integration.connect", entityType: "Integration", entityId: integration.id, metadata: { provider: "woocommerce" } });
    return this.toPublicIntegration(integration);
  }

  async listIntegrations(organizationId: string) {
    const items = await (this.prisma as any).integration.findMany({
      where: { organizationId }, include: { store: true }, orderBy: { createdAt: "asc" },
    });
    return items.map((i: any) => this.toPublicIntegration(i));
  }

  // API responses must never include credential material, encrypted or not.
  toPublicIntegration(i: any) {
    const { credential, ...rest } = i ?? {};
    return { ...rest, hasCredentials: !!credential || undefined, credential: undefined };
  }

  async disconnect(organizationId: string, actorId: string, integrationId: string) {
    const integration = await this.getIntegration(organizationId, integrationId);
    await (this.prisma as any).integrationCredential.deleteMany({ where: { integrationId: integration.id } });
    const updated = await (this.prisma as any).integration.update({
      where: { id: integration.id }, data: { status: "DISCONNECTED" },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "integration.disconnect", entityType: "Integration", entityId: integration.id });
    return this.toPublicIntegration(updated);
  }

  async getIntegration(organizationId: string, integrationId: string) {
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId }, include: { store: true, credential: true },
    });
    if (!integration) throw new NotFoundException("Integration not found in this organization");
    return integration;
  }

  async getIntegrationById(integrationId: string) {
    return (this.prisma as any).integration.findUnique({
      where: { id: integrationId }, include: { store: true, credential: true },
    });
  }

  getSecrets(integration: any): WooConnectionSecrets {
    if (!integration.credential) throw new BadRequestException("Integration has no stored credentials");
    return decryptJson<WooConnectionSecrets>(integration.credential.encryptedData);
  }

  private async buildClient(integration: any): Promise<WooClient> {
    if (!integration.store) throw new BadRequestException("Integration has no store");
    const secrets = this.getSecrets(integration);
    return new WooClient(integration.store.url, secrets);
  }

  // ---------- Product sync ----------
  async syncProducts(organizationId: string, actorId: string, integrationId: string) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const job = await (this.prisma as any).syncJob.create({ data: { integrationId, kind: "products", status: "RUNNING" } });
    const stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
    try {
      const client = await this.buildClient(integration);
      const cursor = integration.productsCursor as Date | null;
      let maxModified: Date | null = cursor;
      for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
        const res = await client.listProducts(page, PER_PAGE, cursor ? cursor.toISOString() : undefined);
        for (const raw of res.items) {
          stats.fetched++;
          const result = await this.upsertProduct(organizationId, normalizeWooProduct(raw, integration.store?.currency ?? "BDT"));
          stats[result]++;
          if (raw.type === "variable") {
            const variations = await client.listVariations(raw.id).catch(() => []);
            for (const v of variations) await this.upsertVariant(organizationId, raw, v);
          }
          const modified = raw.date_modified_gmt ? new Date(raw.date_modified_gmt + "Z") : null;
          if (modified && (!maxModified || modified > maxModified)) maxModified = modified;
        }
        if (page >= res.totalPages) break;
      }
      const done = await (this.prisma as any).syncJob.update({
        where: { id: job.id }, data: { status: "COMPLETED", ...stats, completedAt: new Date() },
      });
      await (this.prisma as any).integration.update({
        where: { id: integrationId },
        data: { lastSyncAt: new Date(), productsCursor: maxModified ?? cursor, status: "CONNECTED", lastError: null },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "sync.products", entityType: "SyncJob", entityId: job.id, metadata: stats });
      return done;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      await (this.prisma as any).syncJob.update({ where: { id: job.id }, data: { status: "FAILED", ...stats, error: message, completedAt: new Date() } });
      await (this.prisma as any).integration.update({ where: { id: integrationId }, data: { status: "ERROR", lastError: message } });
      throw new BadRequestException(`Product sync failed: ${message}`);
    }
  }

  private async upsertVariant(organizationId: string, rawProduct: any, rawVariation: any) {
    const product = await (this.prisma as any).product.findFirst({
      where: { organizationId, source: "woocommerce", externalId: String(rawProduct.id) },
    });
    if (!product) return;
    const v = normalizeWooVariation(rawVariation);
    const existing = v.sku
      ? await (this.prisma as any).productVariant.findFirst({ where: { productId: product.id, sku: v.sku } })
      : await (this.prisma as any).productVariant.findFirst({ where: { productId: product.id, name: v.name } });
    if (existing) {
      await (this.prisma as any).productVariant.update({ where: { id: existing.id }, data: { priceMinor: v.priceMinor ?? null, stockQuantity: v.stockQuantity } });
    } else {
      await (this.prisma as any).productVariant.create({
        data: { productId: product.id, name: v.name, sku: v.sku ?? null, priceMinor: v.priceMinor ?? null, stockQuantity: v.stockQuantity },
      });
    }
  }

  async upsertProduct(organizationId: string, p: NormalizedProduct, source = "woocommerce"): Promise<"created" | "updated" | "skipped"> {
    const existing = await (this.prisma as any).product.findFirst({
      where: { organizationId, source: source, externalId: p.externalId },
    });
    const data = {
      name: p.name, slug: p.slug ?? null, description: p.description ?? null, category: p.category ?? null,
      status: p.status, priceMinor: p.priceMinor, compareAtMinor: p.compareAtMinor ?? null,
      currency: p.currency, stockQuantity: p.stockQuantity, imageUrl: p.imageUrl ?? null,
    };
    if (existing) {
      await (this.prisma as any).product.update({ where: { id: existing.id }, data });
      return "updated";
    }
    // SKU collision with a different (e.g. manually created) product: create
    // without the SKU rather than failing the whole sync.
    let sku: string | null = p.sku ?? null;
    if (sku) {
      const skuTaken = await (this.prisma as any).product.findFirst({ where: { organizationId, sku } });
      if (skuTaken) sku = null;
    }
    await (this.prisma as any).product.create({
      data: { organizationId, source: source, externalId: p.externalId, sku, ...data },
    });
    return "created";
  }

  // ---------- Order sync ----------
  async syncOrders(organizationId: string, actorId: string, integrationId: string) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const job = await (this.prisma as any).syncJob.create({ data: { integrationId, kind: "orders", status: "RUNNING" } });
    const stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
    try {
      const client = await this.buildClient(integration);
      const cursor = integration.ordersCursor as Date | null;
      let maxModified: Date | null = cursor;
      for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
        const res = await client.listOrders(page, PER_PAGE, cursor ? cursor.toISOString() : undefined);
        for (const raw of res.items) {
          stats.fetched++;
          const result = await this.upsertOrder(organizationId, integration.storeId, normalizeWooOrder(raw));
          stats[result]++;
          const modified = raw.date_modified_gmt ? new Date(raw.date_modified_gmt + "Z") : null;
          if (modified && (!maxModified || modified > maxModified)) maxModified = modified;
        }
        if (page >= res.totalPages) break;
      }
      const done = await (this.prisma as any).syncJob.update({
        where: { id: job.id }, data: { status: "COMPLETED", ...stats, completedAt: new Date() },
      });
      await (this.prisma as any).integration.update({
        where: { id: integrationId },
        data: { lastSyncAt: new Date(), ordersCursor: maxModified ?? cursor, status: "CONNECTED", lastError: null },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "sync.orders", entityType: "SyncJob", entityId: job.id, metadata: stats });
      return done;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      await (this.prisma as any).syncJob.update({ where: { id: job.id }, data: { status: "FAILED", ...stats, error: message, completedAt: new Date() } });
      await (this.prisma as any).integration.update({ where: { id: integrationId }, data: { status: "ERROR", lastError: message } });
      throw new BadRequestException(`Order sync failed: ${message}`);
    }
  }

  async upsertOrder(organizationId: string, storeId: string | null, o: NormalizedOrder, source = "woocommerce"): Promise<"created" | "updated"> {
    // Customer: match by store external id, then email, within this org only.
    let customerId: string | null = null;
    if (o.customer.externalId || o.customer.email) {
      let customer = null;
      if (o.customer.externalId) {
        customer = await (this.prisma as any).customer.findFirst({ where: { organizationId, source: source, externalId: o.customer.externalId } });
      }
      if (!customer && o.customer.email) {
        customer = await (this.prisma as any).customer.findFirst({ where: { organizationId, email: o.customer.email } });
      }
      if (customer) {
        customerId = customer.id;
      } else if (o.customer.email || o.customer.firstName) {
        const created = await (this.prisma as any).customer.create({
          data: {
            organizationId, source: source, externalId: o.customer.externalId ?? null,
            firstName: o.customer.firstName ?? null, lastName: o.customer.lastName ?? null,
            email: o.customer.email ?? null, phone: o.customer.phone ?? null,
            address: o.customer.address ?? undefined,
          },
        });
        customerId = created.id;
      }
    }

    const data = {
      storeId, customerId, externalNumber: o.externalNumber ?? null, status: o.status,
      paymentMethod: o.paymentMethod ?? null, isCod: o.isCod, currency: o.currency,
      subtotalMinor: o.subtotalMinor, shippingMinor: o.shippingMinor, discountMinor: o.discountMinor,
      taxMinor: o.taxMinor, totalMinor: o.totalMinor, refundedMinor: o.refundedMinor,
      placedAt: o.placedAt ?? null,
    };
    const existing = await (this.prisma as any).order.findFirst({
      where: { organizationId, source: source, externalId: o.externalId },
    });
    let orderId: string;
    let result: "created" | "updated";
    if (existing) {
      const updated = await (this.prisma as any).order.update({ where: { id: existing.id }, data });
      orderId = updated.id; result = "updated";
    } else {
      const created = await (this.prisma as any).order.create({
        data: { organizationId, source: source, externalId: o.externalId, ...data },
      });
      orderId = created.id; result = "created";
    }

    // Items are fully replaced from the source payload (source of truth).
    await (this.prisma as any).orderItem.deleteMany({ where: { orderId } });
    for (const item of o.items) {
      let productId: string | null = null;
      if (item.externalProductId) {
        const prod = await (this.prisma as any).product.findFirst({
          where: { organizationId, source: source, externalId: item.externalProductId },
        });
        productId = prod?.id ?? null;
      }
      if (!productId && item.sku) {
        const prod = await (this.prisma as any).product.findFirst({ where: { organizationId, sku: item.sku } });
        productId = prod?.id ?? null;
      }
      await (this.prisma as any).orderItem.create({
        data: {
          orderId, productId,
          externalProductId: item.externalProductId ?? null,
          externalVariationId: item.externalVariationId ?? null,
          name: item.name, sku: item.sku ?? null, quantity: item.quantity,
          priceMinor: item.priceMinor, totalMinor: item.totalMinor,
        },
      });
    }
    if (o.status === "completed" && this.events) {
      this.events.emit("order.delivered", { organizationId, context: { orderId } });
    }
    if (result === "created" && this.events) {
      // Only recent orders fire workflows: a first sync backfilling years
      // of history must not trigger a storm of welcome emails/SMS.
      const placedAt = o.placedAt ? new Date(o.placedAt).getTime() : Date.now();
      if (Date.now() - placedAt < 24 * 3600 * 1000) {
        this.events.emit("order.created", {
          organizationId,
          context: {
            orderId, orderNumber: o.externalNumber ?? o.externalId, customerId,
            total: Number(o.totalMinor) / 100, currency: o.currency, status: o.status, source,
          },
        });
      }
    }
    return result;
  }

  async listSyncJobs(organizationId: string, integrationId: string) {
    await this.getIntegration(organizationId, integrationId);
    return (this.prisma as any).syncJob.findMany({
      where: { integrationId }, orderBy: { startedAt: "desc" }, take: 20,
    });
  }
}
