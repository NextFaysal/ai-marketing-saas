import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EmailProvider } from "../messaging/email.provider";
import { minorToMajor } from "../imports/csv";
import { AbandonedCartRow, deriveAbandonedCarts } from "./abandoned-carts";
import { badRequest } from "../i18n/api-exception";

export interface AbandonedCartView extends AbandonedCartRow {
  storeName: string | null;
  storeUrl: string | null;
  contact: { email: string | null; phone: string | null };
  recoverySentAt: string | null;
}

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — mirrors the derivation default
const MAX_ROWS = 200;
export const CART_RECOVERY_ACTION = "tracking.cart_recovery_sent";

/**
 * Sales & Data S4 — abandoned carts for tenant stores.
 *
 * The list is derived live from TrackingEvent rows (see
 * abandoned-carts.ts for the exact definition). A recovery email can
 * be sent at most once per cart: the send writes an AuditLog marker
 * (action "tracking.cart_recovery_sent", metadata.lastCartActivity =
 * the cart's lastActivityAt), and a cart whose marker exists is shown
 * as already-recovered and refuses a second send. A failed SMTP send
 * writes NO marker — the cart stays recoverable and the error is
 * surfaced honestly.
 */
@Injectable()
export class AbandonedCartsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly email?: EmailProvider,
  ) {}

  private async buildCarts(organizationId: string): Promise<{ generatedAt: string; carts: AbandonedCartView[] }> {
    const now = new Date();
    const events = await (this.prisma as any).trackingEvent.findMany({
      where: {
        organizationId,
        type: { in: ["add_to_cart", "checkout_started", "purchase"] },
        occurredAt: { gte: new Date(now.getTime() - LOOKBACK_MS) },
      },
      orderBy: { occurredAt: "asc" },
      take: 20000,
    });

    const rows = deriveAbandonedCarts(events, now).slice(0, MAX_ROWS);
    if (rows.length === 0) return { generatedAt: now.toISOString(), carts: [] };

    const visitorIds = [...new Set(rows.map((r) => r.visitorId))];
    const storeIds = [...new Set(rows.map((r) => r.storeId).filter(Boolean))];

    const [visitors, stores, markers] = await Promise.all([
      (this.prisma as any).visitor.findMany({ where: { organizationId, id: { in: visitorIds } } }),
      storeIds.length
        ? (this.prisma as any).store.findMany({ where: { organizationId, id: { in: storeIds } } })
        : Promise.resolve([]),
      (this.prisma as any).auditLog.findMany({
        where: { organizationId, action: CART_RECOVERY_ACTION, entityId: { in: visitorIds } },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    ]);

    const visitorById = new Map<string, any>(visitors.map((v: any) => [v.id, v]));
    const storeById = new Map<string, any>(stores.map((s: any) => [s.id, s]));

    const carts: AbandonedCartView[] = rows.map((row) => {
      const visitor = visitorById.get(row.visitorId);
      const store = storeById.get(row.storeId);
      // Markers arrive newest-first; the first one whose metadata pins
      // THIS cart (same lastCartActivity) marks this cart recovered.
      const marker = (markers as any[]).find(
        (m) => m.entityId === row.visitorId && m.metadata?.lastCartActivity === row.lastActivityAt,
      );
      return {
        ...row,
        storeName: store?.name ?? null,
        storeUrl: store?.url ?? null,
        contact: { email: visitor?.email ?? null, phone: visitor?.phone ?? null },
        recoverySentAt: marker ? new Date(marker.createdAt).toISOString() : null,
      };
    });

    return { generatedAt: now.toISOString(), carts };
  }

  async list(organizationId: string) {
    const { generatedAt, carts } = await this.buildCarts(organizationId);
    return { generatedAt, minAgeHours: 1, lookbackDays: 7, carts };
  }

  async sendRecovery(organizationId: string, actorId: string, visitorId: string) {
    const { carts } = await this.buildCarts(organizationId);
    const cart = carts.find((c) => c.visitorId === visitorId);
    if (!cart) throw badRequest("tracking.noAbandonedCartWasFoundFor");

    const to = cart.contact.email;
    if (!to) {
      throw badRequest("tracking.thisVisitorHasNoEmailAddress");
    }
    if (cart.recoverySentAt) {
      throw badRequest("tracking.aRecoveryEmailHasAlreadyBeen");
    }
    if (!this.email) {
      throw badRequest("tracking.theEmailSendingFacilityIsNot");
    }

    const storeName = cart.storeName ?? "আমাদের দোকান";
    const subject = `${storeName}: আপনার কার্টটি এখনও অপেক্ষা করছে`;
    const lines: string[] = [
      "আসসালামু আলাইকুম,",
      "",
      `${storeName}-এ আপনি কিছু পণ্য কার্টে যোগ করেছিলেন, কিন্তু অর্ডারটি সম্পূর্ণ করেননি।`,
    ];
    if (cart.items.length > 0) {
      lines.push("", "আপনার কার্টে যা আছে:");
      for (const item of cart.items) {
        lines.push(`- ${item.name ?? item.productId}${item.quantity ? ` ×${item.quantity}` : ""}`);
      }
    }
    if (cart.valueMinor != null) {
      lines.push("", `কার্টের মোট মূল্য: ৳${minorToMajor(BigInt(cart.valueMinor))}`);
    }
    lines.push(
      "",
      `আপনার অর্ডারটি সম্পূর্ণ করতে দোকানে ফিরে যান: ${cart.storeUrl ?? ""}`,
      "",
      `ধন্যবাদান্তে,`,
      storeName,
    );
    const text = lines.join("\n");

    let providerMessageId: string;
    try {
      const result = await this.email.send({ to, subject, text });
      providerMessageId = result.providerMessageId;
    } catch (err) {
      // No audit marker on failure — the cart remains recoverable.
      throw badRequest("tracking.theEmailCouldNotBeSent", { p1: err instanceof Error ? err.message : String(err) });
    }

    if (this.audit) {
      await this.audit
        .log({
          organizationId,
          userId: actorId,
          action: CART_RECOVERY_ACTION,
          entityType: "Visitor",
          entityId: visitorId,
          metadata: {
            storeId: cart.storeId,
            sessionKey: cart.sessionKey,
            lastCartActivity: cart.lastActivityAt,
            to,
            providerMessageId,
          },
        })
        .catch(() => undefined);
    }

    return { sent: true, to, providerMessageId };
  }
}
