import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SmsProvider } from "../messaging/sms.provider";
import { EmailProvider } from "../messaging/email.provider";
import { tenantSmsFromRow } from "../messaging/sender-config";
import { normalizeBdPhone } from "../orders/phone-utils";
import { webBaseUrl } from "../courier/tracking-token";
import type { QuoteDto, UpdateQuoteDto } from "./commerce.dto";

/**
 * AB5 (AX7) — staff-issued price QUOTES.
 *
 * A quote is an OFFER document, not an order. Lines are
 * SNAPSHOTS (product/variant name + sku + the offered unit
 * price, frozen at create/update time). Quote totals carry NO
 * tax/promotion evaluation — totalMinor is exactly
 * Σ qty × unitPriceMinor + deliveryChargeMinor, everywhere.
 *
 * The public page is reached only via an unguessable token:
 * the raw token lives ONLY in the link handed to the customer
 * (and returned to staff, who already have org access); the DB
 * stores its SHA-256 hex in Quote.publicTokenHash. Re-sending
 * ROTATES the token (the old link dies).
 *
 * Conversion is deliberately NOT here: converting creates a
 * real order through OrdersService.createManual, and
 * OrdersModule imports CommerceModule (never the reverse), so
 * the conversion entry point lives on the ORDERS side —
 * OrdersService.convertQuote composes buildConversionInput +
 * createManual + markConverted from this service. No cycle,
 * no forwardRef (the codebase uses none).
 */

function toBig(v: unknown): bigint {
  try {
    return BigInt(v as any);
  } catch {
    return 0n;
  }
}

function parseMoney(raw: unknown, fieldLabel: string): bigint {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!/^\d+$/.test(s)) {
    throw new BadRequestException(`${fieldLabel} সঠিক নয় — অবশ্যই শূন্য বা তার বেশি একটি পূর্ণসংখ্যা (পয়সায়) হতে হবে`);
  }
  return BigInt(s);
}

/** Minor units → a plain taka string for customer-facing text. */
function formatMinor(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const taka = abs / 100n;
  const paisa = abs % 100n;
  const body = paisa === 0n ? String(taka) : `${taka}.${String(paisa).padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}

export function hashQuoteToken(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function quoteLinkFor(token: string): string {
  return `${webBaseUrl()}/quote/${token}`;
}

/** The ONE quote-total rule: Σ lines + delivery. No tax, no
 * promotions — a quote is an offer at snapshot prices. */
export function quoteTotalMinor(lines: any[], deliveryChargeMinor: unknown): bigint {
  let total = toBig(deliveryChargeMinor ?? 0);
  for (const l of Array.isArray(lines) ? lines : []) {
    total += toBig(l?.unitPriceMinor ?? 0) * BigInt(Math.max(0, Math.floor(Number(l?.qty ?? 0)) || 0));
  }
  return total;
}

const CUSTOMER_NAME = (c: any) =>
  [c?.firstName, c?.lastName].filter(Boolean).join(" ").trim() || null;

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly sms?: SmsProvider,
    @Optional() private readonly email?: EmailProvider,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async safeAudit(input: Parameters<AuditService["log"]>[0]): Promise<void> {
    try {
      await this.audit?.log(input);
    } catch {
      /* audit never breaks the write it describes */
    }
  }

  // ---------- validation / snapshots ----------

  /** Validate raw lines against CURRENT rows and freeze the
   * name/sku snapshots the quote will forever carry. */
  private async validateLines(orgId: string, raw: unknown): Promise<any[]> {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException("কোটে কমপক্ষে একটি পণ্যের লাইন দিতে হবে");
    }
    if (raw.length > 100) {
      throw new BadRequestException("কোটে সর্বোচ্চ ১০০টি লাইন দেওয়া যাবে");
    }
    const out: any[] = [];
    for (const entry of raw as any[]) {
      const productId = String(entry?.productId ?? "").trim();
      if (!productId) throw new BadRequestException("কোটের প্রতিটি লাইনে পণ্যের আইডি দিতে হবে");
      const qty = Number(entry?.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
        throw new BadRequestException("কোটের প্রতিটি লাইনের পরিমাণ ১–৯৯৯ হতে হবে");
      }
      const unitPriceMinor = parseMoney(entry?.unitPriceMinor, "লাইনের দাম");
      const product = await this.t("product").findFirst({
        where: { id: productId, organizationId: orgId },
      });
      if (!product) {
        throw new BadRequestException(`পণ্য পাওয়া যায়নি (এই সংস্থার নয়): ${productId}`);
      }
      let variant: any = null;
      let variantId: string | null = null;
      if (entry?.variantId !== undefined && entry?.variantId !== null && entry?.variantId !== "") {
        variantId = String(entry.variantId);
        variant = await this.t("productVariant").findFirst({
          where: { id: variantId, productId },
        });
        if (!variant) throw new BadRequestException("ভ্যারিয়েন্টটি এই পণ্যের নয়");
      }
      out.push({
        productId,
        variantId,
        name: String(product.name ?? ""),
        variantName: variant?.name ?? null,
        sku: variant?.sku ?? product.sku ?? null,
        qty,
        unitPriceMinor: unitPriceMinor.toString(),
      });
    }
    return out;
  }

  /** customerId (org-scoped, must exist) OR walk-in details. */
  private async resolveIdentity(
    orgId: string,
    dto: { customerId?: string | null; walkinName?: string | null; walkinPhone?: string | null },
  ): Promise<{ customerId: string | null; walkinName: string | null; walkinPhone: string | null }> {
    if (dto.customerId) {
      const customer = await this.t("customer").findFirst({
        where: { id: String(dto.customerId), organizationId: orgId },
      });
      if (!customer) throw new BadRequestException("কাস্টমার পাওয়া যায়নি (এই সংস্থার নয়)");
      return { customerId: String(dto.customerId), walkinName: null, walkinPhone: null };
    }
    const walkinName = dto.walkinName?.trim() ? dto.walkinName.trim() : null;
    const walkinPhone = dto.walkinPhone?.trim() ? dto.walkinPhone.trim() : null;
    if (!walkinName && !walkinPhone) {
      throw new BadRequestException("কোটের জন্য কাস্টমার বেছে নিন অথবা ওয়াক-ইন ক্রেতার নাম/ফোন দিন");
    }
    return { customerId: null, walkinName, walkinPhone };
  }

  private parseExpires(raw: unknown): Date | null {
    if (raw === undefined || raw === null || raw === "") return null;
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) throw new BadRequestException("মেয়াদের তারিখটি সঠিক নয়");
    if (d.getTime() <= Date.now()) throw new BadRequestException("কোটের মেয়াদ ভবিষ্যতের তারিখ হতে হবে");
    return d;
  }

  // ---------- numbering ----------

  /** QT-<seq padded 5>, org-scoped — the QuoteCounter upsert +
   * increment inside ONE transaction (the InvoicesService
   * ensureInvoiceNumber pattern: the unique counter row IS the
   * lock, so concurrent issuers never draw the same seq). */
  private async createWithNumber(orgId: string, data: Record<string, any>): Promise<any> {
    const run = async (tx: any): Promise<any> => {
      const counterTable = tx.quoteCounter;
      await counterTable.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, lastSeq: 0 },
        update: {},
      });
      const updated = await counterTable.update({
        where: { organizationId: orgId },
        data: { lastSeq: { increment: 1 } },
      });
      const seq = Number(updated.lastSeq);
      const number = `QT-${String(seq).padStart(5, "0")}`;
      return tx.quote.create({ data: { ...data, organizationId: orgId, number } });
    };
    const prismaAny = this.prisma as any;
    return typeof prismaAny.$transaction === "function" ? prismaAny.$transaction(run) : run(prismaAny);
  }

  // ---------- serialization / expiry ----------

  private serialize(row: any) {
    const lines = (Array.isArray(row.lines) ? row.lines : []).map((l: any) => ({
      ...l,
      unitPriceMinor: String(l?.unitPriceMinor ?? "0"),
      lineTotalMinor: (toBig(l?.unitPriceMinor ?? 0) * BigInt(Math.max(0, Math.floor(Number(l?.qty ?? 0)) || 0))).toString(),
    }));
    return {
      ...row,
      lines,
      deliveryChargeMinor: toBig(row.deliveryChargeMinor ?? 0).toString(),
      totalMinor: quoteTotalMinor(lines, row.deliveryChargeMinor).toString(),
      publicTokenHash: undefined,
    };
  }

  /** Lazy expiry, shared by staff reads, the public page and
   * respond: a SENT quote past its expiresAt becomes "expired"
   * on first touch after the deadline. */
  private async applyLazyExpiry(row: any): Promise<any> {
    if (
      row?.status === "sent" &&
      row?.expiresAt &&
      new Date(row.expiresAt).getTime() < Date.now()
    ) {
      try {
        const updated = await this.t("quote").update({
          where: { id: row.id },
          data: { status: "expired" },
        });
        return updated ?? { ...row, status: "expired" };
      } catch {
        return { ...row, status: "expired" };
      }
    }
    return row;
  }

  private async loadOr404(orgId: string, id: string): Promise<any> {
    const row = await this.t("quote").findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException("কোটটি পাওয়া যায়নি");
    return this.applyLazyExpiry(row);
  }

  // ---------- staff CRUD ----------

  async createQuote(orgId: string, actorId: string, dto: QuoteDto) {
    const lines = await this.validateLines(orgId, dto?.lines);
    const identity = await this.resolveIdentity(orgId, dto ?? {});
    const deliveryChargeMinor =
      dto?.deliveryChargeMinor !== undefined && dto?.deliveryChargeMinor !== null && dto?.deliveryChargeMinor !== ""
        ? parseMoney(dto.deliveryChargeMinor, "ডেলিভারি চার্জ")
        : 0n;
    const expiresAt = this.parseExpires(dto?.expiresAt);
    const row = await this.createWithNumber(orgId, {
      customerId: identity.customerId,
      walkinName: identity.walkinName,
      walkinPhone: identity.walkinPhone,
      status: "draft",
      expiresAt,
      lines,
      deliveryChargeMinor,
      note: dto?.note?.trim() ? dto.note.trim() : null,
      createdById: actorId,
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "quote.created",
      entityType: "Quote", entityId: row.id,
      metadata: { number: row.number, totalMinor: quoteTotalMinor(lines, deliveryChargeMinor).toString() },
    });
    return { quote: this.serialize(row) };
  }

  async listQuotes(orgId: string, filters?: { status?: string; customerId?: string }) {
    const where: Record<string, any> = { organizationId: orgId };
    if (filters?.status) where.status = filters.status;
    if (filters?.customerId) where.customerId = filters.customerId;
    const rows =
      (await this.t("quote")
        .findMany({ where, orderBy: { createdAt: "desc" }, take: 100 })
        .catch(() => [])) ?? [];
    const items: any[] = [];
    for (const r of rows) items.push(this.serialize(await this.applyLazyExpiry(r)));
    return { items };
  }

  async getQuote(orgId: string, id: string) {
    return { quote: this.serialize(await this.loadOr404(orgId, id)) };
  }

  async updateQuote(orgId: string, actorId: string, id: string, dto: UpdateQuoteDto) {
    const existing = await this.loadOr404(orgId, id);
    if (existing.status !== "draft") {
      throw new BadRequestException("শুধু খসড়া (draft) অবস্থার কোট সম্পাদনা করা যাবে");
    }
    const data: Record<string, any> = {};
    if (dto?.lines !== undefined) data.lines = await this.validateLines(orgId, dto.lines);
    if (dto?.deliveryChargeMinor !== undefined) {
      data.deliveryChargeMinor =
        dto.deliveryChargeMinor === null || dto.deliveryChargeMinor === ""
          ? 0n
          : parseMoney(dto.deliveryChargeMinor, "ডেলিভারি চার্জ");
    }
    if (dto?.note !== undefined) data.note = dto.note?.trim() ? dto.note.trim() : null;
    if (dto?.expiresAt !== undefined) data.expiresAt = this.parseExpires(dto.expiresAt);
    if (dto?.customerId !== undefined || dto?.walkinName !== undefined || dto?.walkinPhone !== undefined) {
      const identity = await this.resolveIdentity(orgId, {
        customerId: dto?.customerId !== undefined ? dto.customerId : existing.customerId,
        walkinName: dto?.walkinName !== undefined ? dto.walkinName : existing.walkinName,
        walkinPhone: dto?.walkinPhone !== undefined ? dto.walkinPhone : existing.walkinPhone,
      });
      data.customerId = identity.customerId;
      data.walkinName = identity.walkinName;
      data.walkinPhone = identity.walkinPhone;
    }
    if (!Object.keys(data).length) return { quote: this.serialize(existing) };
    const updated = await this.t("quote").update({ where: { id }, data });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "quote.updated",
      entityType: "Quote", entityId: id, metadata: { fields: Object.keys(data) },
    });
    return { quote: this.serialize(updated) };
  }

  async cancelQuote(orgId: string, actorId: string, id: string) {
    const existing = await this.loadOr404(orgId, id);
    if (existing.status !== "draft" && existing.status !== "sent") {
      throw new BadRequestException("শুধু খসড়া বা পাঠানো অবস্থার কোট বাতিল করা যাবে");
    }
    const updated = await this.t("quote").update({
      where: { id },
      data: { status: "cancelled" },
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "quote.cancelled",
      entityType: "Quote", entityId: id,
    });
    return { quote: this.serialize(updated) };
  }

  // ---------- sending (mirrors GiftCardsService delivery) ----------

  private async resolveTenantSms(orgId: string): Promise<any | null> {
    try {
      const row =
        (await (this.prisma as any).messagingSenderConfig?.findUnique({
          where: { organizationId: orgId },
        })) ?? null;
      return tenantSmsFromRow(row);
    } catch {
      return null;
    }
  }

  private async shopName(orgId: string): Promise<string> {
    const org = await this.t("organization")
      .findFirst({ where: { id: orgId } })
      .catch(() => null);
    return org?.brandName || org?.name || "দোকান";
  }

  /**
   * Send the quote link — structured EXACTLY like
   * GiftCardsService.sendGiftCardDelivery: EmailProvider wins
   * when a recipient email exists AND it is configured; else
   * SMS via the tenant sender config first, platform fallback
   * when configured. Returns "email" | "sms" ONLY when a send
   * actually happened; any failure ⇒ "none" (a send is never
   * claimed that did not happen).
   */
  private async sendQuoteLink(
    orgId: string,
    input: { email?: string | null; phone?: string | null; name?: string | null; link: string; number: string; totalMinor: bigint },
  ): Promise<"email" | "sms" | "none"> {
    try {
      const shop = await this.shopName(orgId);
      const totalText = formatMinor(input.totalMinor);
      const greeting = input.name ? `${input.name}, ` : "";
      if (input.email && this.email && !(typeof this.email.isConfigured === "function" && !this.email.isConfigured())) {
        const text =
          `${greeting}আপনার জন্য একটি কোট পাঠানো হয়েছে (${shop})।\n` +
          `কোট নম্বর: ${input.number}\nমোট: ৳${totalText}\n` +
          `কোটটি দেখতে ও উত্তর দিতে: ${input.link}`;
        await this.email.send({ to: String(input.email), subject: `কোট ${input.number} — ${shop}`, text });
        return "email";
      }
      if (input.phone) {
        if (!this.sms) return "none";
        const text =
          `${shop}: আপনার কোট ${input.number} (মোট ৳${totalText}) দেখুন: ${input.link}`;
        const phone = String(input.phone);
        const to = normalizeBdPhone(phone) ?? phone.replace(/\D/g, "");
        if (!to) return "none";
        const tenantCfg = await this.resolveTenantSms(orgId);
        if (tenantCfg) {
          await this.sms.sendWithGateway(tenantCfg.gateway, tenantCfg, {
            to, text, reference: input.number,
          });
          return "sms";
        }
        if (this.sms.isConfigured()) {
          await this.sms.send({ to, text, reference: input.number });
          return "sms";
        }
        return "none";
      }
      return "none";
    } catch (e) {
      this.logger.warn(
        `quote link delivery failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return "none";
    }
  }

  async sendQuote(orgId: string, actorId: string, id: string) {
    const quote = await this.loadOr404(orgId, id);
    if (quote.status !== "draft" && quote.status !== "sent") {
      throw new BadRequestException("শুধু খসড়া বা পাঠানো অবস্থার কোট পাঠানো যাবে");
    }
    // A fresh token per send — re-sending ROTATES it and the
    // old link dies. Only the SHA-256 hash is stored.
    const token = randomBytes(32).toString("hex");
    const link = quoteLinkFor(token);
    let recipient: { email?: string | null; phone?: string | null; name?: string | null } = {
      email: null,
      phone: quote.walkinPhone ?? null,
      name: quote.walkinName ?? null,
    };
    if (quote.customerId) {
      const customer = await this.t("customer")
        .findFirst({ where: { id: quote.customerId, organizationId: orgId } })
        .catch(() => null);
      if (customer) {
        recipient = {
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          name: CUSTOMER_NAME(customer),
        };
      }
    }
    const totalMinor = quoteTotalMinor(quote.lines, quote.deliveryChargeMinor);
    const sentVia = await this.sendQuoteLink(orgId, {
      ...recipient,
      link,
      number: String(quote.number),
      totalMinor,
    });
    const updated = await this.t("quote").update({
      where: { id },
      data: {
        publicTokenHash: hashQuoteToken(token),
        status: "sent",
        sentAt: new Date(),
        sentVia,
      },
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "quote.sent",
      entityType: "Quote", entityId: id, metadata: { via: sentVia },
    });
    // Staff see the link regardless of the channel outcome so
    // they can share it manually — staff are trusted (they
    // already have org access); the token IS the secret.
    return { quote: this.serialize(updated), sentVia, link };
  }

  // ---------- public page ----------

  private async findByToken(token: string): Promise<any> {
    const t = String(token ?? "").trim();
    if (!t) throw new NotFoundException("কোটটি পাওয়া যায়নি");
    const row = await this.t("quote").findFirst({
      where: { publicTokenHash: hashQuoteToken(t) },
    });
    if (!row) throw new NotFoundException("কোটটি পাওয়া যায়নি");
    return this.applyLazyExpiry(row);
  }

  /** Shop-branded minimal public payload — never internal ids
   * beyond the quote number, never customerId / createdById. */
  private async publicPayload(row: any) {
    const org = await this.t("organization")
      .findFirst({ where: { id: row.organizationId } })
      .catch(() => null);
    const lines = (Array.isArray(row.lines) ? row.lines : []).map((l: any) => ({
      name: l?.name ?? "",
      variantName: l?.variantName ?? null,
      sku: l?.sku ?? null,
      qty: Number(l?.qty ?? 0),
      unitPriceMinor: String(l?.unitPriceMinor ?? "0"),
      lineTotalMinor: (toBig(l?.unitPriceMinor ?? 0) * BigInt(Math.max(0, Math.floor(Number(l?.qty ?? 0)) || 0))).toString(),
    }));
    return {
      shop: {
        name: org?.name ?? null,
        brandName: org?.brandName ?? null,
        logoUrl: org?.logoUrl ?? null,
      },
      number: String(row.number),
      status: String(row.status),
      lines,
      deliveryChargeMinor: toBig(row.deliveryChargeMinor ?? 0).toString(),
      totalMinor: quoteTotalMinor(row.lines, row.deliveryChargeMinor).toString(),
      expiresAt: row.expiresAt ?? null,
      note: row.note ?? null,
      respondedAt: row.respondedAt ?? null,
    };
  }

  async getByToken(token: string) {
    const row = await this.findByToken(token);
    return this.publicPayload(row);
  }

  async publicRespond(token: string, dto: { accept?: boolean }) {
    const row = await this.findByToken(token);
    // Idempotent-safe: an already-answered quote returns its
    // current state without error.
    if (row.status === "accepted" || row.status === "declined") {
      return this.publicPayload(row);
    }
    if (row.status !== "sent") {
      throw new BadRequestException("এই কোটটিতে এখন উত্তর দেওয়া যাবে না");
    }
    const updated = await this.t("quote").update({
      where: { id: row.id },
      data: {
        status: dto?.accept === true ? "accepted" : "declined",
        respondedAt: new Date(),
      },
    });
    return this.publicPayload(updated);
  }

  // ---------- conversion (composed by OrdersService) ----------

  /**
   * The manual-order math preview: quote lines map to manual
   * items { name, sku, quantity, unitPriceMinor } and the
   * delivery charge becomes shippingMinor with discount 0, so
   * the manual path's own math is subtotal + shipping − 0,
   * floored at 0. NOTHING is created here.
   */
  async previewConversion(orgId: string, id: string) {
    const quote = await this.loadOr404(orgId, id);
    const lines = Array.isArray(quote.lines) ? quote.lines : [];
    let orderSubtotal = 0n;
    for (const l of lines) {
      orderSubtotal += toBig(l?.unitPriceMinor ?? 0) * BigInt(Math.max(0, Math.floor(Number(l?.qty ?? 0)) || 0));
    }
    const orderShipping = toBig(quote.deliveryChargeMinor ?? 0);
    const rawTotal = orderSubtotal + orderShipping - 0n;
    const orderTotal = rawTotal > 0n ? rawTotal : 0n;
    const quoteTotal = quoteTotalMinor(lines, quote.deliveryChargeMinor);
    return {
      quoteTotalMinor: quoteTotal.toString(),
      orderSubtotalMinor: orderSubtotal.toString(),
      orderShippingMinor: orderShipping.toString(),
      orderTotalMinor: orderTotal.toString(),
      matchesQuoteTotal: orderTotal === quoteTotal,
    };
  }

  /**
   * Everything OrdersService.convertQuote needs, validated:
   * the quote must be ACCEPTED and not already converted, and
   * the buyer must resolve to a phone (createManual keys the
   * customer by phone). Refusals are Bengali staff errors.
   */
  async buildConversionInput(orgId: string, id: string) {
    const quote = await this.loadOr404(orgId, id);
    if (quote.convertedOrderId) {
      throw new BadRequestException("এই কোটটি ইতিমধ্যে অর্ডারে রূপান্তরিত হয়েছে");
    }
    if (quote.status !== "accepted") {
      throw new BadRequestException("শুধু গৃহীত (accepted) কোটই অর্ডারে রূপান্তর করা যাবে");
    }
    let phone: string | null = null;
    let name: string | null = null;
    if (quote.customerId) {
      const customer = await this.t("customer")
        .findFirst({ where: { id: quote.customerId, organizationId: orgId } })
        .catch(() => null);
      phone = customer?.phone?.trim() ? String(customer.phone).trim() : null;
      name = customer ? CUSTOMER_NAME(customer) : null;
      if (!phone) {
        throw new BadRequestException(
          "কোটের কাস্টমারের ফোন নম্বর নেই — আগে কাস্টমারের প্রোফাইলে ফোন যোগ করুন, অথবা ওয়াক-ইন তথ্য দিয়ে কোটটি তৈরি করুন",
        );
      }
    } else if (quote.walkinPhone?.trim()) {
      phone = String(quote.walkinPhone).trim();
      name = quote.walkinName?.trim() ? String(quote.walkinName).trim() : null;
    }
    if (!phone) {
      throw new BadRequestException(
        "কোটে কোনো ফোন নম্বর নেই — অর্ডার তৈরি করতে ক্রেতার ফোন নম্বর আবশ্যক",
      );
    }
    const lines = Array.isArray(quote.lines) ? quote.lines : [];
    const items = lines.map((l: any) => ({
      name: l?.variantName ? `${l.name} — ${l.variantName}` : String(l?.name ?? ""),
      sku: l?.sku ?? undefined,
      quantity: Number(l?.qty ?? 0),
      unitPriceMinor: Number(toBig(l?.unitPriceMinor ?? 0)),
    }));
    return {
      quote: this.serialize(quote),
      manualDto: {
        customerPhone: phone,
        customerName: name ?? phone,
        items,
        shippingMinor: Number(toBig(quote.deliveryChargeMinor ?? 0)),
        discountMinor: 0,
        quoteId: String(quote.id),
      },
    };
  }

  /** Stamp the conversion outcome (called by OrdersService
   * AFTER the manual order exists). */
  async markConverted(orgId: string, actorId: string, id: string, orderId: string) {
    const updated = await this.t("quote").update({
      where: { id },
      data: { status: "converted", convertedOrderId: orderId },
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "quote.converted",
      entityType: "Quote", entityId: id, metadata: { orderId },
    });
    return { quote: this.serialize(updated) };
  }
}
