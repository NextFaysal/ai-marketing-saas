import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { InventoryService } from "../inventory/inventory.service";
import { CreateStoreDto, ConnectWooDto } from "./integrations.dto";
import { encryptJson, decryptJson } from "./crypto";
import { randomBytes, randomUUID } from "crypto";
import { WooClient, WooCredentials } from "./woocommerce/woo.client";
import { WOO_WEBHOOK_TOPICS, registerWooWebhooks } from "./woocommerce/woo-webhooks";
import { ListingsService } from "./commerce/listings.service";
import { LoyaltyService } from "../commerce/loyalty.service";
import { GiftCardsService } from "../commerce/gift-cards.service";
import { StoreCreditService } from "../membership/store-credit.service";
import { normalizeWooProduct, normalizeWooVariation, normalizeWooOrder, NormalizedOrder, NormalizedProduct } from "./woocommerce/normalize";
import { normalizeWooCustomer, upsertSyncedCustomer } from "./customer-sync";
import { ShopifyGraphQLClient } from "./shopify/shopify-graphql.client";
import { cadenceSkip } from "./sync-cadence";
import { checkOrderCreate, isOrderLimitBlocked } from "../common/plan-limit-checks";
import { refreshProductSearchVector } from "../products/search-vector";
import { badRequest, forbidden, notFound } from "../i18n/api-exception";

function stripReviewHtml(html: unknown): string | null {
  if (typeof html !== "string") return null;
  const out = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return out || null;
}

/** EC15 fixture shape for a Shopify reviews metafield value: a
 * JSON array of { id?, authorName?|author?|reviewer?, rating,
 * text?|review?|comment?, createdAt?|date? }. Anything else is
 * not parseable review data. */
export function parseShopifyReviewMetafield(value: unknown): any[] | null {
  let parsed: any = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(parsed)) return null;
  const out = parsed.filter((e: any) => e && Number.isInteger(Number(e.rating)) && Number(e.rating) >= 1 && Number(e.rating) <= 5);
  return out.length ? out : null;
}

const MAX_SYNC_PAGES = 10; // 10 pages x 100 = at most 1000 records per manual sync run
const PER_PAGE = 100;

export interface WooConnectionSecrets extends WooCredentials { webhookSecret?: string }

@Injectable()
export class IntegrationsService {
  // NOTE: the events dependency MUST be a real class import —
  // an inline import() type emits `Object` in design:paramtypes
  // and Nest silently injects undefined, which disabled every
  // order.created/order.delivered emission from store sync
  // until Milestone 65 caught it live.
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, @Optional() private readonly events?: EventsService, @Optional() private readonly inventory?: InventoryService, @Optional() private readonly listings?: ListingsService, @Optional() private readonly loyalty?: LoyaltyService, @Optional() private readonly giftCards?: GiftCardsService, @Optional() private readonly storeCredit?: StoreCreditService) {}

  // ---------- EC1/EC2: per-store listing wiring (failure-isolated) ----------
  /**
   * Record that a product seen inbound now has a listing on this
   * store. Never throws: listing bookkeeping must not break sync.
   */
  async wireProductListing(organizationId: string, storeId: string | null, source: string, externalId: string, remoteUpdatedAt?: Date | null): Promise<void> {
    if (!this.listings || !storeId || !externalId) return;
    try {
      const product = await (this.prisma as any).product.findFirst({
        where: { organizationId, source, externalId: String(externalId) },
      });
      if (!product) return;
      await this.listings.recordInboundProduct(
        organizationId,
        storeId,
        product.id,
        String(externalId),
        {
          name: product.name,
          priceMinor: String(product.priceMinor),
          status: product.status,
          stockQuantity: product.stockQuantity,
          imageUrl: product.imageUrl,
        },
        remoteUpdatedAt ?? undefined,
      );
    } catch (e) {
      this.logger.warn(`wireProductListing failed (${source}/${externalId}): ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

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
    if (!store) throw notFound("integrations.storeNotFoundInThisOrganization");

    // Test with the supplied credentials BEFORE persisting anything.
    // A failed test never stores secrets and never marks the store connected.
    const client = new WooClient(store.url, { consumerKey: dto.consumerKey, consumerSecret: dto.consumerSecret });
    try {
      await client.testConnection();
    } catch (e) {
      throw badRequest("integrations.woocommerceConnectionFailed", { p1: e instanceof Error ? e.message : "unknown error" });
    }

    const existing = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "woocommerce", storeId: store.id },
    });
    // EC2: final webhook secret = dto ?? previously stored ?? generated.
    let storedSecret: string | undefined;
    if (existing) {
      try {
        const cred = await (this.prisma as any).integrationCredential.findFirst({ where: { integrationId: existing.id } });
        if (cred?.encryptedData) storedSecret = decryptJson<WooConnectionSecrets>(cred.encryptedData).webhookSecret;
      } catch { storedSecret = undefined; }
    }
    const webhookSecret = dto.webhookSecret ?? storedSecret ?? randomBytes(24).toString("hex");
    const secrets: WooConnectionSecrets = {
      consumerKey: dto.consumerKey, consumerSecret: dto.consumerSecret, webhookSecret,
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
    // EC2: auto webhook registration — problems NEVER fail the connect.
    const registration = await this.attemptWooWebhookRegistration(integration, client, webhookSecret);
    integration = { ...integration, webhookStatus: registration.webhookStatus };
    await this.audit.log({ organizationId, userId: actorId, action: "integration.connect", entityType: "Integration", entityId: integration.id, metadata: { provider: "woocommerce" } });
    return { ...this.toPublicIntegration(integration), webhookRegistration: registration.status };
  }

  /**
   * EC2: attempt to register our Woo webhooks and record the
   * outcome verbatim on integration.webhookStatus. Never throws.
   */
  private async attemptWooWebhookRegistration(integration: any, client: WooClient, secret: string): Promise<{ status: string; webhookStatus: any }> {
    const base = process.env.API_PUBLIC_URL?.replace(/\/+$/, "");
    if (!base) {
      const webhookStatus = { provider: "woocommerce", status: "skipped_no_public_url", updatedAt: new Date().toISOString() };
      try {
        await (this.prisma as any).integration.update({ where: { id: integration.id }, data: { webhookStatus } });
      } catch (e) { this.logger.warn(`recording woo webhookStatus failed: ${e instanceof Error ? e.message : "unknown"}`); }
      return { status: "skipped_no_public_url", webhookStatus };
    }
    const deliveryUrl = `${base}/webhooks/woocommerce/${integration.id}`;
    let results: Array<{ topic: string; status: string; webhookId?: any; error?: string }>;
    try {
      results = await registerWooWebhooks(client, { deliveryUrl, secret, namePrefix: "Qosprey SaaS" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      results = WOO_WEBHOOK_TOPICS.map((topic) => ({ topic, status: "failed", error: message }));
    }
    const okCount = results.filter((r) => r.status === "created" || r.status === "exists").length;
    const status = okCount === results.length && results.length > 0 ? "registered" : okCount > 0 ? "partial" : "failed";
    const topics: Record<string, { status: string; error?: string }> = {};
    for (const r of results) topics[r.topic] = { status: r.status, ...(r.error ? { error: r.error } : {}) };
    const webhookStatus = { provider: "woocommerce", status, topics, deliveryUrl, updatedAt: new Date().toISOString() };
    try {
      await (this.prisma as any).integration.update({ where: { id: integration.id }, data: { webhookStatus } });
    } catch (e) { this.logger.warn(`recording woo webhookStatus failed: ${e instanceof Error ? e.message : "unknown"}`); }
    return { status, webhookStatus };
  }

  /** EC2: re-run Woo webhook registration for an existing connection. */
  async repairWooWebhooks(organizationId: string, actorId: string, integrationId: string) {
    const integration = await this.getIntegration(organizationId, integrationId);
    if (integration.provider !== "woocommerce") throw badRequest("integrations.webhookRepairIsOnlyAvailableFor2");
    let secrets: WooConnectionSecrets;
    try {
      secrets = this.getSecrets(integration);
    } catch {
      throw badRequest("integrations.integrationHasNoStoredCredentials");
    }
    if (!secrets.webhookSecret) {
      secrets = { ...secrets, webhookSecret: randomBytes(24).toString("hex") };
      await (this.prisma as any).integrationCredential.upsert({
        where: { integrationId: integration.id },
        update: { encryptedData: encryptJson(secrets) },
        create: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
      });
    }
    const client = await this.buildClient({ ...integration, credential: { encryptedData: encryptJson(secrets) } });
    const registration = await this.attemptWooWebhookRegistration(integration, client, secrets.webhookSecret as string);
    await this.audit.log({ organizationId, userId: actorId, action: "integration.repair_webhooks", entityType: "Integration", entityId: integration.id, metadata: { provider: "woocommerce", webhookRegistration: registration.status } });
    return { integrationId: integration.id, webhookRegistration: registration.status, webhookStatus: registration.webhookStatus };
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

  /**
   * EC12: rotate the Woo webhook secret. The stored credential is
   * re-sealed with a fresh secret, our previously registered
   * webhooks (matched by delivery URL) are deleted, and fresh ones
   * are registered with the new secret via the same attempt path
   * as connect/repair. The secret itself NEVER appears in the
   * return value, audit metadata, or logs.
   */
  async rotateWooWebhookSecret(organizationId: string, actorId: string, integrationId: string) {
    const integration = await this.getIntegration(organizationId, integrationId);
    if (integration.provider !== "woocommerce") {
      throw badRequest("integrations.webhookSecretRotationIsOnlyAvailable");
    }
    const secrets = this.getSecrets(integration);
    const newSecret = randomBytes(24).toString("hex");
    const next: WooConnectionSecrets = { ...secrets, webhookSecret: newSecret };
    await (this.prisma as any).integrationCredential.upsert({
      where: { integrationId: integration.id },
      update: { encryptedData: encryptJson(next) },
      create: { integrationId: integration.id, encryptedData: encryptJson(next) },
    });
    const rotatedAt = new Date().toISOString();
    let status: string;
    const base = process.env.API_PUBLIC_URL?.replace(/\/+$/, "");
    if (base) {
      const deliveryUrl = `${base}/webhooks/woocommerce/${integration.id}`;
      const client = new WooClient(integration.store.url, next);
      const existing = await client.listWebhooks(1, 100).catch(() => [] as any[]);
      for (const w of existing ?? []) {
        if (w?.delivery_url === deliveryUrl) {
          await client.deleteWebhook(w.id).catch(() => undefined);
        }
      }
      const registration = await this.attemptWooWebhookRegistration(integration, client, newSecret);
      status = registration.status;
    } else {
      const webhookStatus = { provider: "woocommerce", status: "skipped_no_public_url", rotatedAt };
      try {
        await (this.prisma as any).integration.update({ where: { id: integration.id }, data: { webhookStatus } });
      } catch (e) { this.logger.warn(`recording woo webhookStatus failed: ${e instanceof Error ? e.message : "unknown"}`); }
      status = "skipped_no_public_url";
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "integration.webhook_secret_rotated",
      entityType: "Integration", entityId: integration.id,
      metadata: { provider: "woocommerce", webhookRegistration: status },
    });
    return { rotated: true, integrationId: integration.id, webhookRegistration: status, rotatedAt };
  }

  private async deleteCount(table: string, where: any): Promise<number> {
    const res = await (this.prisma as any)[table].deleteMany({ where });
    return res?.count ?? 0;
  }

  /**
   * EC12: disconnect. By default this keeps EVERYTHING (business
   * data and store mappings) — the historical behavior. With
   * opts.purgeMappings (OWNER only) the per-store MAPPING rows for
   * this integration's store are deleted: listings, discount
   * syncs, pending outbox rows, and customer store identities.
   * Product/Order/Customer/StoreDiscount records and the Store row
   * itself are always kept.
   */
  async disconnect(organizationId: string, actorId: string, integrationId: string, opts?: { purgeMappings?: boolean; actorRole?: string }) {
    if (opts?.purgeMappings && opts?.actorRole !== undefined && opts.actorRole !== "OWNER") {
      throw forbidden("integrations.onlyTheOrganizationOwnerCanPurge");
    }
    const integration = await this.getIntegration(organizationId, integrationId);
    await (this.prisma as any).integrationCredential.deleteMany({ where: { integrationId: integration.id } });
    const updated = await (this.prisma as any).integration.update({
      where: { id: integration.id }, data: { status: "DISCONNECTED" },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "integration.disconnect", entityType: "Integration", entityId: integration.id });
    const purgeRequested = !!opts?.purgeMappings;
    if (!purgeRequested) {
      return { ...this.toPublicIntegration(updated), purge: { requested: false } };
    }
    const counts = { listings: 0, discountSyncs: 0, outbox: 0, customerIdentities: 0 };
    let note: string | undefined;
    if (integration.storeId) {
      counts.listings = await this.deleteCount("storeListing", { organizationId, storeId: integration.storeId });
      counts.discountSyncs = await this.deleteCount("storeDiscountSync", { storeId: integration.storeId });
      counts.outbox = await this.deleteCount("syncOutbox", { organizationId, storeId: integration.storeId });
      counts.customerIdentities = await this.deleteCount("customerStoreIdentity", { organizationId, storeId: integration.storeId });
    } else {
      note = "no_store_linked";
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "integration.disconnect_purge",
      entityType: "Integration", entityId: integration.id,
      metadata: { provider: integration.provider, deleted: counts, ...(note ? { note } : {}) },
    });
    return {
      ...this.toPublicIntegration(updated),
      purge: {
        requested: true,
        deleted: counts,
        kept: ["Product records", "Order records", "Customer records", "StoreDiscount records", "The Store row itself"],
        ...(note ? { note } : {}),
      },
    };
  }

  async getIntegration(organizationId: string, integrationId: string) {
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: integrationId, organizationId }, include: { store: true, credential: true },
    });
    if (!integration) throw notFound("integrations.integrationNotFoundInThisOrganization");
    return integration;
  }

  /**
   * Milestone 63: process a recorded WooCommerce webhook event
   * (the upsert half of the webhook controller). Shared by the
   * inline path and the queued path (worker callback) so both
   * behave identically. Payload-level failures are recorded on
   * the event and reported as processed:false — never retried
   * into a storm; infrastructure failures throw.
   */
  async processWooWebhookEvent(eventId: string): Promise<{ processed: boolean }> {
    const event = await (this.prisma as any).webhookEvent.findFirst({ where: { id: eventId } });
    if (!event) throw notFound("integrations.webhookEventNotFound");
    const integration = await this.getIntegrationById(event.integrationId);
    if (!integration) throw notFound("integrations.integrationNotFound");
    const payload = (event.payload ?? {}) as any;
    try {
      if (event.topic?.startsWith("order.") && payload?.id) {
        await this.upsertOrder(integration.organizationId, integration.storeId, normalizeWooOrder(payload));
      } else if (event.topic?.startsWith("product.") && payload?.id) {
        const currency = integration.store?.currency ?? "BDT";
        await this.upsertProduct(integration.organizationId, normalizeWooProduct(payload, currency), "woocommerce", integration.storeId);
        await this.wireProductListing(integration.organizationId, integration.storeId, "woocommerce", String(payload.id), payload.date_modified_gmt ? new Date(payload.date_modified_gmt + "Z") : null);
      }
      await (this.prisma as any).webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } });
      return { processed: true };
    } catch (e) {
      await (this.prisma as any).webhookEvent.update({
        where: { id: event.id }, data: { error: e instanceof Error ? e.message : "Processing failed" },
      }).catch(() => undefined);
      return { processed: false };
    }
  }

  async getIntegrationById(integrationId: string) {
    return (this.prisma as any).integration.findUnique({
      where: { id: integrationId }, include: { store: true, credential: true },
    });
  }

  getSecrets(integration: any): WooConnectionSecrets {
    if (!integration.credential) throw badRequest("integrations.integrationHasNoStoredCredentials");
    return decryptJson<WooConnectionSecrets>(integration.credential.encryptedData);
  }

  private async buildClient(integration: any): Promise<WooClient> {
    if (!integration.store) throw badRequest("integrations.integrationHasNoStore");
    const secrets = this.getSecrets(integration);
    return new WooClient(integration.store.url, secrets);
  }

  /**
   * CC18: the sync-pause gate shared by every sync entry point
   * in this service. A paused integration's sync does not run:
   * the skip is RECORDED as a completed SyncJob whose error
   * field carries the "sync_paused" reason (so the per-
   * connection sync history shows it), and the caller gets the
   * AD5-style skip marker as its result. The manual HTTP
   * triggers additionally refuse up-front in the controller
   * with a clear message; scheduled jobs land here and skip
   * quietly-but-logged. Returns null when not paused.
   */
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

  // ---------- Product sync ----------
  async syncProducts(organizationId: string, actorId: string, integrationId: string, opts?: { scheduled?: boolean }) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const paused = await this.pausedSkip(integration, "products");
    if (paused) return paused;
    if (opts?.scheduled) { const cadence = await cadenceSkip(this.prisma, integration, "products"); if (cadence) return cadence; }
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
          const result = await this.upsertProduct(organizationId, normalizeWooProduct(raw, integration.store?.currency ?? "BDT"), "woocommerce", integration.storeId);
          stats[result]++;
          await this.wireProductListing(organizationId, integration.storeId, "woocommerce", String(raw.id), raw.date_modified_gmt ? new Date(raw.date_modified_gmt + "Z") : null);
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
      throw badRequest("integrations.productSyncFailed", { message: message });
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
      // S1: explain the stock jump in the ledger BEFORE the synced
      // value overwrites it (sync_correction; caller stays the writer).
      try {
        await this.inventory?.recordSyncedStock(organizationId, product.id, existing.id, existing.stockQuantity ?? null, v.stockQuantity ?? null);
      } catch (e) { this.logger.warn(`inventory sync_correction (variant) failed: ${e instanceof Error ? e.message : "unknown"}`); }
      await (this.prisma as any).productVariant.update({ where: { id: existing.id }, data: { priceMinor: v.priceMinor ?? null, stockQuantity: v.stockQuantity } });
    } else {
      await (this.prisma as any).productVariant.create({
        data: { productId: product.id, name: v.name, sku: v.sku ?? null, priceMinor: v.priceMinor ?? null, stockQuantity: v.stockQuantity },
      });
    }
  }

  async upsertProduct(organizationId: string, p: NormalizedProduct, source = "woocommerce", storeId?: string | null): Promise<"created" | "updated" | "skipped"> {
    const existing = await (this.prisma as any).product.findFirst({
      where: { organizationId, source: source, externalId: p.externalId },
    });
    // EC3: conflict detection runs BEFORE any write, failure-isolated
    // — a detection problem must never block the inbound upsert.
    if (existing && storeId && this.listings && typeof (this.listings as any).detectInboundConflict === "function") {
      try {
        const localContent = {
          name: existing.name,
          priceMinor: String(existing.priceMinor),
          status: existing.status,
          stockQuantity: existing.stockQuantity,
          imageUrl: existing.imageUrl ?? null,
        };
        const remoteContent = {
          name: p.name,
          priceMinor: String(p.priceMinor),
          status: p.status,
          stockQuantity: p.stockQuantity,
          imageUrl: p.imageUrl ?? null,
        };
        await (this.listings as any).detectInboundConflict({
          organizationId, storeId, productId: existing.id, localContent, remoteContent, remoteUpdatedAt: undefined,
        });
      } catch (e) {
        this.logger.warn(`detectInboundConflict failed (${source}/${p.externalId}): ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
    const data = {
      name: p.name, slug: p.slug ?? null, description: p.description ?? null, category: p.category ?? null,
      status: p.status, priceMinor: p.priceMinor, compareAtMinor: p.compareAtMinor ?? null,
      currency: p.currency, stockQuantity: p.stockQuantity, imageUrl: p.imageUrl ?? null,
    };
    if (existing) {
      // S1: record the sync_correction BEFORE the overwrite.
      try {
        await this.inventory?.recordSyncedStock(organizationId, existing.id, null, existing.stockQuantity ?? null, p.stockQuantity ?? null);
      } catch (e) { this.logger.warn(`inventory sync_correction failed: ${e instanceof Error ? e.message : "unknown"}`); }
      await (this.prisma as any).product.update({ where: { id: existing.id }, data });
      // AB6 (AX11): refresh the synced product's FTS vector —
      // failure-isolated, never blocks the inbound upsert.
      try {
        await refreshProductSearchVector(this.prisma as any, existing.id);
      } catch (e) {
        this.logger.warn(`search vector refresh failed (${source}/${p.externalId}): ${e instanceof Error ? e.message : "unknown"}`);
      }
      return "updated";
    }
    // SKU collision with a different (e.g. manually created) product: create
    // without the SKU rather than failing the whole sync.
    let sku: string | null = p.sku ?? null;
    if (sku) {
      const skuTaken = await (this.prisma as any).product.findFirst({ where: { organizationId, sku } });
      if (skuTaken) sku = null;
    }
    const created = await (this.prisma as any).product.create({
      data: { organizationId, source: source, externalId: p.externalId, sku, ...data },
    });
    // AB6 (AX11): build the synced product's FTS vector —
    // failure-isolated, never blocks the inbound upsert.
    try {
      const createdId = (created as any)?.id;
      if (createdId) await refreshProductSearchVector(this.prisma as any, createdId);
    } catch (e) {
      this.logger.warn(`search vector refresh failed (${source}/${p.externalId}): ${e instanceof Error ? e.message : "unknown"}`);
    }
    return "created";
  }

  // ---------- Order sync ----------
  async syncOrders(organizationId: string, actorId: string, integrationId: string, opts?: { scheduled?: boolean }) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const paused = await this.pausedSkip(integration, "orders");
    if (paused) return paused;
    if (opts?.scheduled) { const cadence = await cadenceSkip(this.prisma, integration, "orders"); if (cadence) return cadence; }
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
          // GC22: a plan/order-limit block skips THIS order and
          // the sync continues (the audit + staff notification
          // already fired inside the check). The cursor does NOT
          // advance past a skipped order, so a later sync can
          // retry it once the block lifts. Any other error keeps
          // the existing fail-the-sync behaviour.
          let result: "created" | "updated";
          try {
            result = await this.upsertOrder(organizationId, integration.storeId, normalizeWooOrder(raw));
          } catch (e) {
            if (isOrderLimitBlocked(e)) { stats.skipped++; continue; }
            throw e;
          }
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
      throw badRequest("integrations.orderSyncFailed", { message: message });
    }
  }

  async upsertOrder(organizationId: string, storeId: string | null, o: NormalizedOrder, source = "woocommerce"): Promise<"created" | "updated"> {
    // Customer: match by store external id, then email, within this org only.
    let customerId: string | null = null;
    // EC24c: a pre-resolved customerId (verified in-org) wins.
    if ((o as any).customerId) {
      const pinned = await (this.prisma as any).customer.findFirst({
        where: { id: (o as any).customerId, organizationId },
      }).catch(() => null);
      if (pinned) customerId = pinned.id;
    }
    if (!customerId && (o.customer.externalId || o.customer.email)) {
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
      // EC24c: stamp the subscription link only when the caller
      // supplies one — store syncs never clear an existing link.
      ...((o as any).subscriptionId ? { subscriptionId: (o as any).subscriptionId } : {}),
    };
    const existing = await (this.prisma as any).order.findFirst({
      where: { organizationId, source: source, externalId: o.externalId },
    });
    // S1: the pre-update status is the transition-detection point
    // for store orders (this update branch overwrites status).
    const prevStatus: string | null = existing?.status ?? null;
    let orderId: string;
    let result: "created" | "updated";
    if (existing) {
      const updated = await (this.prisma as any).order.update({ where: { id: existing.id }, data });
      orderId = updated.id; result = "updated";
    } else {
      // GC22 (GB9): plan enforcement on the CREATE branch only —
      // updates to existing orders always pass. A block throws
      // OrderLimitBlockedError: shopper checkout callers convert
      // it to the generic shopper message, sync callers skip the
      // order and continue, staff callers see the Bengali reason.
      await checkOrderCreate(this.prisma as any, organizationId);
      const created = await (this.prisma as any).order.create({
        data: {
          organizationId, source: source, externalId: o.externalId, ...data,
          // AB7 (AX19): order-level attribution stamps —
          // CREATE branch ONLY (a re-upsert never rewrites the
          // placement-time record), and only the keys the
          // caller actually supplied: native checkouts pass the
          // normalized block, every other caller (POS / manual
          // / external sync) passes nothing and the columns
          // stay null = untracked. These stamps are the
          // order-level record; the attribution ENGINE
          // (src/attribution/) is a separate system and is not
          // touched by this.
          ...((o as any).utmSource ? { utmSource: (o as any).utmSource } : {}),
          ...((o as any).utmMedium ? { utmMedium: (o as any).utmMedium } : {}),
          ...((o as any).utmCampaign ? { utmCampaign: (o as any).utmCampaign } : {}),
          ...((o as any).utmContent ? { utmContent: (o as any).utmContent } : {}),
          ...((o as any).utmTerm ? { utmTerm: (o as any).utmTerm } : {}),
          ...((o as any).clickIdType ? { clickIdType: (o as any).clickIdType } : {}),
          ...((o as any).clickId ? { clickId: (o as any).clickId } : {}),
          // AB8 (AX27): device fingerprint stamp — CREATE
          // branch ONLY, same discipline as attribution above.
          ...((o as any).deviceHash ? { deviceHash: (o as any).deviceHash } : {}),
        },
      });
      orderId = created.id; result = "created";
    }

    // AB5 (AX7): net-terms SNAPSHOT — CREATE branch only, and
    // failure-isolated like every other placement hook here.
    // When the resolved customer carries creditTermsDays > 0
    // and the order has value and is not already dead, stamp
    // creditDueDate = (placedAt ?? now) + terms days. It is a
    // snapshot: later edits to the customer's terms NEVER
    // rewrite an existing order's due date, and the UPDATE
    // branch above never touches the field.
    if (result === "created" && customerId) {
      try {
        const status = String(o.status ?? "");
        const total = (() => { try { return BigInt(o.totalMinor as any); } catch { return 0n; } })();
        if (total > 0n && !["cancelled", "failed", "refunded"].includes(status)) {
          const cust = await (this.prisma as any).customer
            .findFirst({ where: { id: customerId, organizationId }, select: { creditTermsDays: true } })
            .catch(() => null);
          const terms = Number(cust?.creditTermsDays ?? 0);
          if (Number.isFinite(terms) && terms > 0) {
            const base = o.placedAt ? new Date(o.placedAt as any) : new Date();
            const creditDueDate = new Date(base.getTime() + terms * 24 * 3600 * 1000);
            await (this.prisma as any).order.update({
              where: { id: orderId },
              data: { creditDueDate },
            });
          }
        }
      } catch (e) {
        this.logger.warn(`credit due date stamp failed for order ${orderId}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    // Items are fully replaced from the source payload (source of truth).
    await (this.prisma as any).orderItem.deleteMany({ where: { orderId } });
    const resolvedItems: Array<{ productId: string; externalProductId: string; stockQuantity: number | null }> = [];
    for (const item of o.items) {
      let productId: string | null = null;
      let resolvedProduct: any = null;
      if ((item as any).productId) {
        // EC24: direct internal link — org-scoped, foreign id = no link.
        const prod = await (this.prisma as any).product.findFirst({
          where: { organizationId, id: (item as any).productId },
        });
        productId = prod?.id ?? null;
        resolvedProduct = prod ?? null;
      }
      if (!productId && item.externalProductId) {
        const prod = await (this.prisma as any).product.findFirst({
          where: { organizationId, source: source, externalId: item.externalProductId },
        });
        productId = prod?.id ?? null;
        resolvedProduct = prod ?? null;
      }
      if (!productId && item.sku) {
        const prod = await (this.prisma as any).product.findFirst({ where: { organizationId, sku: item.sku } });
        productId = prod?.id ?? null;
        resolvedProduct = prod ?? null;
      }
      await (this.prisma as any).orderItem.create({
        data: {
          orderId, productId,
          externalProductId: item.externalProductId ?? null,
          externalVariationId: item.externalVariationId ?? null,
          name: item.name, sku: item.sku ?? null, quantity: item.quantity,
          priceMinor: item.priceMinor, totalMinor: item.totalMinor,
          // EC24a: pre-order stamp (additive; default false).
          isPreorder: !!(item as any).isPreorder,
          // EC29: gift / bundle stamps (additive; defaults
          // false / null / null when the caller sets neither).
          isGift: !!(item as any).isGift,
          bundleId: (item as any).bundleId ?? null,
          bundleName: (item as any).bundleName ?? null,
        },
      });
      if (productId && item.externalProductId) {
        resolvedItems.push({ productId, externalProductId: item.externalProductId, stockQuantity: resolvedProduct?.stockQuantity ?? null });
      }
    }
    // EC1: per-store listing channel stock follows the product's
    // canonical stock after an order touches it — failure-isolated
    // per item so listing bookkeeping never breaks an order upsert.
    if (storeId && this.listings) {
      for (const resolved of resolvedItems) {
        try {
          await this.listings.touchForOrderItem(organizationId, storeId, resolved.productId, resolved.externalProductId, resolved.stockQuantity);
        } catch (e) {
          this.logger.warn(`touchForOrderItem failed (${resolved.externalProductId}): ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
    }
    // S1 inventory hooks — failure-isolated: inventory must never
    // break an order upsert. Placement is idempotent per
    // (order, product, variant); restore replays placed movements.
    if (this.inventory) {
      if (result === "created") {
        try {
          await this.inventory.applyOrderPlaced(organizationId, orderId, { status: o.status });
        } catch (e) { this.logger.warn(`inventory order_placed failed for order ${orderId}: ${e instanceof Error ? e.message : "unknown"}`); }
      } else if (prevStatus !== o.status) {
        try {
          if (o.status === "cancelled" || o.status === "failed") {
            await this.inventory.applyOrderRestore(organizationId, orderId, "order_cancelled");
          } else if (o.status === "returned") {
            await this.inventory.applyOrderRestore(organizationId, orderId, "order_returned");
          }
        } catch (e) { this.logger.warn(`inventory restore failed for order ${orderId}: ${e instanceof Error ? e.message : "unknown"}`); }
        // AB1: external status changes emit NO order.status_changed
        // bus event on this path (staff changes do), so the loyalty
        // reconciler is invoked directly — failure-isolated like
        // the inventory hook above. It re-derives everything from
        // current DB state and every posting is claim-guarded, so
        // this can never double-earn or double-claw.
        try { await this.loyalty?.onOrderTransition(organizationId, orderId); }
        catch (e) { this.logger.warn(`loyalty reconcile failed for order ${orderId}: ${e instanceof Error ? e.message : "unknown"}`); }
        // AB2: the identical direct hook for gift cards — external
        // status changes emit no bus event on this path, so the
        // gift-card reconciler (sold-gated issuance, redemption
        // restores, purchase voids) is invoked directly,
        // failure-isolated like the loyalty hook above. It
        // re-derives everything from current DB state and every
        // posting is claim-guarded, so this can never
        // double-issue or double-restore.
        try { await this.giftCards?.onOrderTransition(organizationId, orderId); }
        catch (e) { this.logger.warn(`gift card reconcile failed for order ${orderId}: ${e instanceof Error ? e.message : "unknown"}`); }
        // NF7: the identical direct hook for membership tiers +
        // store credit — tier recompute and the cancellation
        // spend reversal re-derive from current DB state and are
        // claim-guarded, so this can never double-reverse.
        try { await this.storeCredit?.onOrderTransition(organizationId, orderId); }
        catch (e) { this.logger.warn(`NF7 reconcile failed for order ${orderId}: ${e instanceof Error ? e.message : "unknown"}`); }
      }
    }
    if (result === "created") {
      // ON4: fraud assessment hook — emitted UNCONDITIONALLY on
      // creation (NOT inside the 24h order.created guard below:
      // a backfilled old order still deserves a risk stamp, and
      // FraudShieldService.assessOrder never throws).
      try { this.events?.emit("order.ingested", { organizationId, context: { orderId, source } }); } catch { /* isolated */ }
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

  // ---------- EC6: Customer sync ----------
  async syncCustomers(organizationId: string, actorId: string, integrationId: string, opts?: { scheduled?: boolean }) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const paused = await this.pausedSkip(integration, "customers");
    if (paused) return paused;
    if (opts?.scheduled) { const cadence = await cadenceSkip(this.prisma, integration, "customers"); if (cadence) return cadence; }
    const job = await (this.prisma as any).syncJob.create({ data: { integrationId, kind: "customers", status: "RUNNING" } });
    const stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
    const errors: string[] = [];
    try {
      if (!integration.storeId) throw badRequest("integrations.integrationHasNoStore");
      const client = await this.buildClient(integration);
      // No customer cursor column exists on Integration (only
      // productsCursor/ordersCursor) — fetch all pages each run;
      // upserts are idempotent so re-syncing is safe.
      for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
        const res = await client.listCustomers(page, PER_PAGE);
        for (const raw of res.items) {
          stats.fetched++;
          try {
            const result = await upsertSyncedCustomer(this.prisma, {
              organizationId, storeId: integration.storeId, source: "woocommerce", customer: normalizeWooCustomer(raw),
            });
            stats[result]++;
          } catch (e) {
            stats.skipped++;
            if (errors.length < 20) errors.push(e instanceof Error ? e.message : String(e));
          }
        }
        if (page >= res.totalPages) break;
      }
      const done = await (this.prisma as any).syncJob.update({
        where: { id: job.id }, data: { status: "COMPLETED", ...stats, error: errors[0] ?? null, completedAt: new Date() },
      });
      await (this.prisma as any).integration.update({
        where: { id: integrationId },
        data: { lastSyncAt: new Date(), status: "CONNECTED", lastError: null },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "sync.customers", entityType: "SyncJob", entityId: job.id, metadata: stats });
      return { ...done, errors, stats };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      await (this.prisma as any).syncJob.update({ where: { id: job.id }, data: { status: "FAILED", ...stats, error: message, completedAt: new Date() } });
      await (this.prisma as any).integration.update({ where: { id: integrationId }, data: { status: "ERROR", lastError: message } });
      throw badRequest("integrations.customerSyncFailed", { message: message });
    }
  }

  // ---------- EC15: Review sync ----------
  /** Build the Shopify GraphQL client for the reviews probe.
   * Separated so specs can stub it; returns null when the stored
   * credential carries no usable access token. */
  async buildShopifyGraphqlClientForReviews(integration: any): Promise<any | null> {
    try {
      if (!integration?.store?.url || !integration?.credential?.encryptedData) return null;
      const secrets: any = decryptJson<any>(integration.credential.encryptedData);
      if (!secrets?.accessToken) return null;
      return new ShopifyGraphQLClient(integration.store.url, secrets.accessToken);
    } catch { return null; }
  }

  private async upsertExternalReview(data: any): Promise<"created" | "updated"> {
    const existing = await (this.prisma as any).externalReview?.findFirst({
      where: { storeId: data.storeId, externalId: data.externalId },
    }).catch(() => null);
    if (existing) {
      await (this.prisma as any).externalReview.update({ where: { id: existing.id }, data });
      return "updated";
    }
    await (this.prisma as any).externalReview.create({ data });
    return "created";
  }

  async syncReviews(organizationId: string, actorId: string, integrationId: string, opts?: { scheduled?: boolean }) {
    const integration = await this.getIntegration(organizationId, integrationId);
    const paused = await this.pausedSkip(integration, "reviews");
    if (paused) return paused;
    if (opts?.scheduled) { const cadence = await cadenceSkip(this.prisma, integration, "reviews"); if (cadence) return cadence; }
    if (integration.provider === "shopify") return this.syncShopifyReviews(organizationId, actorId, integration);
    if (integration.provider !== "woocommerce") {
      throw badRequest("integrations.reviewSyncIsOnlyAvailableFor");
    }
    const job = await (this.prisma as any).syncJob.create({ data: { integrationId, kind: "reviews", status: "RUNNING" } });
    const stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
    try {
      if (!integration.storeId) throw badRequest("integrations.integrationHasNoStore");
      const client = await this.buildClient(integration);
      for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
        const res = await client.listProductReviews(page, PER_PAGE);
        for (const review of res.items) {
          stats.fetched++;
          const rating = Number(review?.rating);
          if (!review?.id || !review?.product_id || !Number.isInteger(rating) || rating < 1 || rating > 5) { stats.skipped++; continue; }
          const listing = await (this.prisma as any).storeListing?.findFirst({
            where: { storeId: integration.storeId, externalId: String(review.product_id) },
          }).catch(() => null);
          if (!listing?.productId) { stats.skipped++; continue; }
          const result = await this.upsertExternalReview({
            organizationId, storeId: integration.storeId, productId: listing.productId,
            externalId: String(review.id),
            authorName: review.reviewer ?? null,
            rating,
            text: stripReviewHtml(review.review),
            // Woo core reviews carry no review photos — reviewer_avatar_urls
            // are avatars and must NOT be presented as review images.
            imageUrls: [],
            status: review.status && review.status !== "approved" ? "hidden" : "visible",
            createdAtRemote: review.date_created_gmt ? new Date(review.date_created_gmt + "Z") : review.date_created ? new Date(review.date_created) : null,
          });
          stats[result]++;
        }
        if (page >= res.totalPages) break;
      }
      const done = await (this.prisma as any).syncJob.update({
        where: { id: job.id }, data: { status: "COMPLETED", ...stats, completedAt: new Date() },
      });
      await (this.prisma as any).integration.update({
        where: { id: integrationId }, data: { lastSyncAt: new Date(), status: "CONNECTED", lastError: null },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "sync.reviews", entityType: "SyncJob", entityId: job.id, metadata: { ...stats, platform: "woocommerce" } });
      return { ...done, total: stats.fetched, platform: "woocommerce" };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      await (this.prisma as any).syncJob.update({ where: { id: job.id }, data: { status: "FAILED", ...stats, error: message, completedAt: new Date() } }).catch(() => undefined);
      await (this.prisma as any).integration.update({ where: { id: integrationId }, data: { status: "ERROR", lastError: message } }).catch(() => undefined);
      throw badRequest("integrations.reviewSyncFailed", { message: message });
    }
  }

  /**
   * EC15 Shopify probe: Shopify core has no product-reviews API.
   * The only in-store place reviews can live without a reviews
   * app is a product metafield, so we probe listed products'
   * metafields (global/reviews namespaces). No parseable data —
   * or an unusable client — is a NORMAL unsupported result,
   * never a fake success and never an exception.
   */
  private async syncShopifyReviews(organizationId: string, actorId: string, integration: any) {
    const integrationId = integration.id;
    const job = await (this.prisma as any).syncJob.create({ data: { integrationId, kind: "reviews", status: "RUNNING" } });
    const stats = { fetched: 0, created: 0, updated: 0, skipped: 0 };
    const unsupported = async () => {
      const marker = "unsupported_no_reviews_source";
      const done = await (this.prisma as any).syncJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", ...stats, error: `shopify:${marker}`, completedAt: new Date() },
      }).catch(() => ({ id: job.id, status: "COMPLETED", ...stats }));
      await this.audit.log({ organizationId, userId: actorId, action: "sync.reviews", entityType: "SyncJob", entityId: job.id, metadata: { platform: "shopify", reviews: marker, ...stats } }).catch(() => undefined);
      return { ...done, platform: "shopify", reviews: marker, total: stats.fetched };
    };
    try {
      if (!integration.storeId) return unsupported();
      const client = await this.buildShopifyGraphqlClientForReviews(integration);
      if (!client || typeof client.request !== "function") return unsupported();
      const query = `query { products(first: 20) { edges { node { id legacyResourceId metafields(first: 50) { edges { node { namespace key value } } } } } } }`;
      let data: any;
      try { data = await client.request(query); } catch { return unsupported(); }
      const edges = data?.products?.edges ?? [];
      let foundAny = false;
      for (const edge of edges) {
        const node = edge?.node;
        if (!node) continue;
        const externalProductId = node.legacyResourceId != null ? String(node.legacyResourceId) : null;
        const mfEdges = node.metafields?.edges ?? [];
        for (const mf of mfEdges) {
          const field = mf?.node;
          if (!field) continue;
          const ns = String(field.namespace ?? "");
          const key = String(field.key ?? "");
          if (!(ns === "reviews" || (ns === "global" && key.toLowerCase().includes("review")))) continue;
          const entries = parseShopifyReviewMetafield(field.value);
          if (!entries) continue;
          foundAny = true;
          if (!externalProductId) { stats.skipped += entries.length; continue; }
          const listing = await (this.prisma as any).storeListing?.findFirst({
            where: { storeId: integration.storeId, externalId: externalProductId },
          }).catch(() => null);
          if (!listing?.productId) { stats.skipped += entries.length; continue; }
          for (const entry of entries) {
            stats.fetched++;
            const externalId = String(entry.id ?? entry.externalId ?? `${externalProductId}:${stats.fetched}:${entry.authorName ?? entry.author ?? ""}:${entry.rating}`);
            const result = await this.upsertExternalReview({
              organizationId, storeId: integration.storeId, productId: listing.productId,
              externalId,
              authorName: entry.authorName ?? entry.author ?? entry.reviewer ?? null,
              rating: Number(entry.rating),
              text: stripReviewHtml(entry.text ?? entry.review ?? entry.comment ?? null),
              imageUrls: Array.isArray(entry.imageUrls) ? entry.imageUrls.filter((x: any) => typeof x === "string") : [],
              status: "visible",
              createdAtRemote: entry.createdAt || entry.date ? new Date(entry.createdAt ?? entry.date) : null,
            });
            stats[result]++;
          }
        }
      }
      if (!foundAny) return unsupported();
      const done = await (this.prisma as any).syncJob.update({
        where: { id: job.id }, data: { status: "COMPLETED", ...stats, completedAt: new Date() },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "sync.reviews", entityType: "SyncJob", entityId: job.id, metadata: { ...stats, platform: "shopify" } });
      return { ...done, total: stats.fetched, platform: "shopify" };
    } catch (e) {
      // Probe failures degrade to the honest unsupported result —
      // Shopify simply may have no reviews source configured.
      this.logger.warn(`shopify reviews probe failed: ${e instanceof Error ? e.message : "unknown"}`);
      return unsupported();
    }
  }

  async listSyncJobs(organizationId: string, integrationId: string) {
    await this.getIntegration(organizationId, integrationId);
    return (this.prisma as any).syncJob.findMany({
      where: { integrationId }, orderBy: { startedAt: "desc" }, take: 20,
    });
  }
}
