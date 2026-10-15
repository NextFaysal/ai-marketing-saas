import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { TenantPaymentsService } from "./tenant-payments.service";

/**
 * CC26 (Connect Center Next) — shareable payment links.
 *
 * A tenant creates a link for ONE unpaid order and shares it
 * (chat, SMS, anywhere). The buyer opens /pay/<token>, sees
 * the shop name, order number and amount due, and pays through
 * the link's gateway path.
 *
 * Security + money discipline:
 * - The bearer token is 32 random bytes; the row stores ONLY
 *   its SHA-256 hash. The plaintext exists in the creation
 *   response (and the buyer's URL) and nowhere else — list
 *   views can never re-display it.
 * - Links are LIVE-only (environment pinned "live"): a link
 *   always resolves production credentials, so sandbox links
 *   are refused at creation — a test link that could mark a
 *   real order paid must never exist.
 * - Paying through a link rides the EXISTING public initiation
 *   machinery (TenantPaymentsService.initiatePublicPayment —
 *   the same code path as the storefront's own pay button), so
 *   the IPN/callback verification discipline is literally
 *   identical: initiation alone pays nothing and spends
 *   nothing; the link becomes "used" only inside the
 *   verified-paid transition (TenantPaymentsService's
 *   markLinkUsed hook).
 * - Creation refuses a link that could never work: the order
 *   must exist, be unpaid, and the chosen (provider, source)
 *   path must be a REAL currently-offered option for the shop
 *   (the public payment-options answer decides — an enabled
 *   own live gateway, or a tenant-enabled platform provider
 *   the platform actually offers).
 * - The public read exposes NO internal ids and no secrets:
 *   shop name, order number, amount due, provider, expiry.
 */

export function hashPaymentLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type LinkStatus = "active" | "used" | "expired" | "revoked";

@Injectable()
export class PaymentLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenantPayments: TenantPaymentsService,
  ) {}

  private webBase(): string {
    return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }

  private effectiveStatus(link: any, now = new Date()): LinkStatus {
    if (link.status === "used" || link.status === "revoked") return link.status;
    if (link.status === "expired") return "expired";
    return new Date(link.expiresAt).getTime() <= now.getTime() ? "expired" : "active";
  }

  private linkView(link: any) {
    return {
      id: link.id, orderId: link.orderId, provider: link.provider,
      source: link.source === "platform" ? "platform" : "own",
      environment: "live",
      status: this.effectiveStatus(link),
      expiresAt: link.expiresAt, usedAt: link.usedAt ?? null,
      createdById: link.createdById, createdAt: link.createdAt,
    };
  }

  private async hasVerifiedPayment(organizationId: string, orderId: string): Promise<boolean> {
    try {
      const rows = await (this.prisma as any).tenantPaymentTransaction.findMany({
        where: { organizationId, orderId, status: "verified_paid" }, take: 1,
      });
      return Array.isArray(rows) && rows.length > 0;
    } catch { return false; }
  }

  async createLink(organizationId: string, actorId: string, dto: { orderId?: string; provider?: string; source?: string; expiresInHours?: number }) {
    const provider = String(dto?.provider ?? "").trim().toLowerCase();
    if (provider !== "sslcommerz" && provider !== "bkash") {
      throw new BadRequestException("Payment link শুধু sslcommerz ও bkash-এর জন্য তৈরি করা যায় (Nagad-এর কোনো API চেকআউট সংযুক্ত নয়)।");
    }
    const source = dto?.source === "platform" ? "platform" : "own";
    const hours = dto?.expiresInHours === undefined || dto?.expiresInHours === null ? 72 : Number(dto.expiresInHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) {
      throw new BadRequestException("লিংকের মেয়াদ ১ ঘণ্টা থেকে ৩০ দিনের মধ্যে হতে হবে।");
    }
    const p: any = this.prisma as any;
    const order = await p.order.findFirst({
      where: { id: String(dto?.orderId ?? ""), organizationId },
    }).catch(() => null);
    if (!order) throw new NotFoundException("Order not found");
    if (order.isPractice) throw new BadRequestException("Practice অর্ডারের জন্য payment link তৈরি করা যায় না।");
    if (BigInt(order.totalMinor ?? 0) <= 0n) throw new BadRequestException("অর্ডারের মোট পরিমাণ শূন্য বা তার কম — payment link তৈরি করা যাবে না।");
    if (await this.hasVerifiedPayment(organizationId, order.id)) {
      throw new BadRequestException("এই অর্ডারের পেমেন্ট ইতিমধ্যে যাচাইকৃতভাবে সম্পন্ন হয়েছে — নতুন লিংক লাগবে না।");
    }
    const org = await p.organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    if (!org?.slug) throw new NotFoundException("Organization not found");
    // The path must be a REAL option for this shop right now —
    // the same answer the buyer's pay button trusts.
    const options = await this.tenantPayments.publicPaymentOptions(String(org.slug));
    const offered = (options.options ?? []).some((o: any) => o.provider === provider && o.source === source);
    if (!offered) {
      throw new BadRequestException(source === "platform"
        ? "এই প্রোভাইডারে প্ল্যাটফর্ম পেমেন্ট এখন নেওয়া যাচ্ছে না — আগে Connect Center-এ প্ল্যাটফর্ম গেটওয়ে চালু করুন এবং প্ল্যাটফর্মে গেটওয়েটি কনফিগার থাকতে হবে।"
        : "এই প্রোভাইডারে আপনার নিজের লাইভ গেটওয়ে চালু নেই — আগে Connect Center-এ গেটওয়ে যোগ করে চালু করুন।");
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000);
    const row = await p.paymentLink.create({
      data: {
        organizationId, orderId: order.id, tokenHash: hashPaymentLinkToken(token),
        provider, source, environment: "live", expiresAt, status: "active", createdById: actorId,
      },
    });
    await this.audit.log({
      organizationId, userId: actorId, action: "payment_link.created",
      entityType: "PaymentLink", entityId: row.id,
      metadata: { orderId: order.id, provider, source, expiresAt: expiresAt.toISOString() },
    });
    // The plaintext token is returned EXACTLY here — the one
    // and only time it leaves the server.
    return { ...this.linkView(row), token, payUrl: `${this.webBase()}/pay/${token}` };
  }

  async listLinks(organizationId: string, query: { orderId?: string; limit?: number } = {}) {
    const where: Record<string, unknown> = { organizationId };
    if (query.orderId) where.orderId = String(query.orderId);
    const take = Math.min(200, Math.max(1, Math.round(Number(query.limit) || 50)));
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).paymentLink.findMany({
        where, orderBy: { createdAt: "desc" }, take,
      });
    } catch { rows = []; }
    return { links: (rows ?? []).map((r: any) => this.linkView(r)) };
  }

  async revokeLink(organizationId: string, actorId: string, linkId: string) {
    const p: any = this.prisma as any;
    const row = await p.paymentLink.findFirst({ where: { id: linkId, organizationId } }).catch(() => null);
    if (!row) throw new NotFoundException("Payment link not found");
    const status = this.effectiveStatus(row);
    if (status === "used") throw new BadRequestException("ব্যবহৃত হয়ে যাওয়া লিংক বাতিল করা যায় না।");
    if (status === "expired") throw new BadRequestException("এই লিংকটির মেয়াদ ইতিমধ্যে শেষ — বাতিল করার কিছু নেই।");
    if (status === "revoked") return this.linkView(row);
    const updated = await p.paymentLink.update({ where: { id: row.id }, data: { status: "revoked" } });
    await this.audit.log({
      organizationId, userId: actorId, action: "payment_link.revoked",
      entityType: "PaymentLink", entityId: row.id, metadata: { orderId: row.orderId },
    });
    return this.linkView(updated);
  }

  // ---------- public (buyer) surface ----------

  private async findByToken(token: string): Promise<any | null> {
    const clean = String(token ?? "").trim();
    if (!clean || clean.length > 200) return null;
    try {
      return await (this.prisma as any).paymentLink.findFirst({
        where: { tokenHash: hashPaymentLinkToken(clean) },
      });
    } catch { return null; }
  }

  /** Persist the computed expiry so stored state and shown
   * state agree (a lazily-expired link is expired everywhere). */
  private async settleExpiry(link: any): Promise<any> {
    if (link.status === "active" && this.effectiveStatus(link) === "expired") {
      const updated = await (this.prisma as any).paymentLink.update({
        where: { id: link.id }, data: { status: "expired" },
      }).catch(() => null);
      return updated ?? { ...link, status: "expired" };
    }
    return link;
  }

  async getPublicLink(token: string) {
    const found = await this.findByToken(token);
    if (!found) throw new NotFoundException("Payment link not found");
    const link = await this.settleExpiry(found);
    const p: any = this.prisma as any;
    const org = await p.organization.findUnique({ where: { id: link.organizationId } }).catch(() => null);
    const order = await p.order.findFirst({
      where: { id: link.orderId, organizationId: link.organizationId },
    }).catch(() => null);
    let status = this.effectiveStatus(link);
    // Defence in depth: if the order is in fact paid (the
    // verified-paid hook normally marks the link used at that
    // moment), the buyer is told the truth either way.
    if (status === "active" && order && (await this.hasVerifiedPayment(link.organizationId, order.id))) {
      status = "used";
    }
    return {
      status,
      shopName: org?.name ?? org?.slug ?? "",
      orderNumber: order?.externalNumber ?? null,
      amountDueMinor: order ? String(order.totalMinor ?? 0) : null,
      currency: order?.currency ?? "BDT",
      provider: link.provider,
      source: link.source === "platform" ? "platform" : "own",
      expiresAt: link.expiresAt,
    };
  }

  /**
   * Start the payment for a link. The link gates (exists,
   * active, unexpired) are checked here; EVERYTHING after that
   * is the existing public initiation path — same gateway
   * start, same IPN verification chain, same exactly-once
   * verified-paid transition (which is also what spends the
   * link). Initiation itself returns the gateway redirect and
   * changes nothing about the order or the link.
   */
  async initiatePublicLink(token: string) {
    const found = await this.findByToken(token);
    if (!found) throw new NotFoundException("Payment link not found");
    const link = await this.settleExpiry(found);
    const status = this.effectiveStatus(link);
    if (status === "used") throw new BadRequestException("এই লিংকটি দিয়ে ইতিমধ্যে পেমেন্ট সম্পন্ন হয়েছে — আবার পেমেন্ট করা যাবে না।");
    if (status === "revoked") throw new BadRequestException("এই লিংকটি বাতিল করা হয়েছে — এটি দিয়ে আর পেমেন্ট করা যাবে না।");
    if (status === "expired") throw new BadRequestException("এই লিংকটির মেয়াদ শেষ হয়ে গেছে — দোকান থেকে নতুন লিংক চেয়ে নিন।");
    const p: any = this.prisma as any;
    const org = await p.organization.findUnique({ where: { id: link.organizationId } }).catch(() => null);
    const order = await p.order.findFirst({
      where: { id: link.orderId, organizationId: link.organizationId },
    }).catch(() => null);
    if (!org?.slug || !order) throw new NotFoundException("Payment link not found");
    return this.tenantPayments.initiatePublicPayment(
      String(org.slug), order.id, String(order.externalNumber ?? ""), link.provider, link.source,
    );
  }
}
