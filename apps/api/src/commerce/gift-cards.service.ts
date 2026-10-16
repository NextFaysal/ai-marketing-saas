import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { SmsProvider } from "../messaging/sms.provider";
import { EmailProvider } from "../messaging/email.provider";
import { tenantSmsFromRow } from "../messaging/sender-config";
import { normalizeBdPhone } from "../orders/phone-utils";
import { encryptJson, decryptJson } from "../integrations/crypto";
import { isSoldOrderShape } from "./loyalty.service";
import {
  effectiveGiftCardStatus,
  generateGiftCardCode,
  giftCardEffectiveBalanceMinor,
  hashGiftCardCode,
  normalizeGiftCardCode,
} from "./gift-cards";

/**
 * AB2 (AX3 Gift Cards) — GiftCardsService, the core.
 *
 * THE one writer of GiftCardLedger rows and of
 * GiftCard.balanceCache: every movement goes through the
 * private postEntryTx inside a DB transaction that moves the
 * cache and writes the ledger row with the re-read balanceAfter.
 * No other code in this service writes either (card CREATION
 * sets the initial cache, and the issue entry is then posted
 * with balanceAlreadyApplied — see postEntryTx).
 *
 * Program rules (see the AB2 plan / acceptance):
 *  - Codes are bearer instruments: the full code is NEVER
 *    stored in plaintext and NEVER logged. codeHash (SHA-256 of
 *    the canonical code) is the lookup key; codeSealed
 *    (AES-256-GCM via integrations/crypto encryptJson({ code }))
 *    is the only recoverable copy, unsealed ONLY by
 *    buyerRevealForOrder for the entitled buyer's surface.
 *    Staff surfaces see codePrefix + codeLast4 only.
 *  - Issuance is SOLD-gated: purchase intents are recorded at
 *    placement (recordIntents), but cards are minted only when
 *    the reconciler sees the order in the sold set — an unpaid
 *    or abandoned order never mints value.
 *  - Redemption posts at placement (postPlacementRedeem, the
 *    AB1 mirror): exactly-once per (card, order) via the
 *    in-transaction existence check + the partial unique index
 *    backstop; the conditional updateMany claim means a
 *    concurrent spend that wins the race leaves the placed order
 *    standing with its priced discount, the card NOT charged,
 *    and staff reconcile via adjustBalance (documented AB1
 *    posture, kept deliberately).
 *  - Reversals ride ONE reconciler, onOrderTransition, which
 *    re-reads the order and re-derives everything from current
 *    DB state: redemption restores converge proportionally to
 *    the cumulative refunded share; a purchase order that dies
 *    or is fully refunded VOIDS its still-unspent cards (a
 *    partial refund never voids — the AB1 referral-coupon
 *    refinement), and a staff-voided card never resurrects via
 *    a restore.
 *  - Expiry is lazy for readers (the gift-cards.ts effective
 *    helpers) and persisted by runExpirySweep.
 *  - Everything here is failure-isolated from order flows: the
 *    event handlers, the placement hook and the reconciler
 *    catch and warn-log, they never throw into a checkout or a
 *    status change. NO log line ever contains a full code.
 */

const DEAD_STATUSES = new Set(["cancelled", "failed"]);
const DELIVERED_SHIPMENT_STATUSES = new Set(["delivered", "partial_delivered"]);
const CARD_STATUSES = new Set(["active", "depleted", "expired", "void"]);
const MAX_MANUAL_AMOUNT_MINOR = 10_000_000_000n; // 100_000_000_00 minor

export const GIFT_CARD_NOTE_RESTORE = "redeem_restore";
export const GIFT_CARD_NOTE_PURCHASE_VOID = "purchase_refund_void";
export const GIFT_CARD_NOTE_EXPIRED = "card_expired";

function toBig(v: unknown): bigint {
  try {
    return BigInt(v as any);
  } catch {
    return 0n;
  }
}

function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /unique|P2002/i.test(msg);
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

@Injectable()
export class GiftCardsService {
  private readonly logger = new Logger(GiftCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly events?: EventsService,
    @Optional() private readonly sms?: SmsProvider,
    @Optional() private readonly email?: EmailProvider,
  ) {
    // The LoyaltyService pattern: subscribe in the constructor,
    // revalidate everything from the DB inside the handler.
    // Every handler funnels into the ONE reconciler.
    if (this.events) {
      const reconcile = (p: any) => {
        void this.onOrderTransition(p?.organizationId, p?.context?.orderId);
      };
      this.events.on("order.delivered", reconcile);
      this.events.on("order.ingested", reconcile);
      this.events.on("order.created", reconcile);
      this.events.on("order.status_changed", reconcile);
      this.events.on("order.refunded", reconcile);
      this.events.on("shipment.status_changed", (p) => {
        const s = String(p?.context?.shipmentStatus ?? "");
        if (DELIVERED_SHIPMENT_STATUSES.has(s)) reconcile(p);
      });
    }
  }

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async safeAudit(input: Parameters<AuditService["log"]>[0]): Promise<void> {
    try {
      await this.audit?.log(input);
    } catch {
      /* audit is best-effort, like the neighbouring services */
    }
  }

  // ================= settings =================

  private defaultSetting(orgId: string): any {
    return {
      organizationId: orgId,
      redemptionEnabled: true,
      defaultExpiryDays: null,
    };
  }

  private async loadSetting(orgId: string): Promise<any | null> {
    return this.t("giftCardSetting")
      .findFirst({ where: { organizationId: orgId } })
      .catch(() => null);
  }

  async getSetting(orgId: string): Promise<any> {
    const row = await this.loadSetting(orgId);
    return { setting: row ?? this.defaultSetting(orgId) };
  }

  async updateSetting(orgId: string, actorId: string, dto: any): Promise<any> {
    const current = (await this.loadSetting(orgId)) ?? this.defaultSetting(orgId);
    const data: Record<string, any> = {};
    // GB4 lesson (the LoyaltyService.updateLoyaltySetting
    // discipline): the ValidationPipe materialises absent
    // fields as undefined own-properties — "provided" means
    // !== undefined.
    if (dto?.redemptionEnabled !== undefined) data.redemptionEnabled = dto.redemptionEnabled === true;
    if (dto?.defaultExpiryDays !== undefined) {
      const v = dto.defaultExpiryDays;
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 3650)) {
        throw new BadRequestException("গিফট কার্ডের মেয়াদ ১–৩৬৫০ দিন হতে হবে");
      }
      data.defaultExpiryDays = v;
    }
    const merged = { ...current, ...data };
    const table = this.t("giftCardSetting");
    const saved = table.upsert
      ? await table.upsert({
          where: { organizationId: orgId },
          create: { organizationId: orgId, ...this.defaultSetting(orgId), ...data },
          update: data,
        })
      : await table
          .update({ where: { id: (await this.loadSetting(orgId))?.id }, data })
          .catch(() => table.create({ data: { organizationId: orgId, ...merged } }));
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "gift_card.settings_updated",
      entityType: "GiftCardSetting", entityId: saved?.id ?? orgId,
      metadata: { redemptionEnabled: merged.redemptionEnabled },
    });
    return { setting: saved ?? merged };
  }

  // ================= ledger core (the ONE writer) =================

  /**
   * Write ONE ledger row and move the card's cached balance
   * inside the caller's open transaction.
   *
   * Default path: the delta is applied here (balanceCache
   * increment) and balanceAfter is the re-read balance.
   *
   * `balanceAlreadyApplied`: the caller has ALREADY moved the
   * balance inside this same transaction — either the card row
   * was just created with its face value as the cache (issue),
   * or a conditional updateMany claim decremented it (redeem).
   * postEntryTx then only writes the ledger row (with the
   * re-read balance as balanceAfter) and applies `nextStatus`.
   *
   * Status decisions live in the flows and arrive via
   * `nextStatus`; postEntryTx itself never invents a status.
   * void / expired are sticky: no flow passes a nextStatus that
   * revives them, and the flows guard that explicitly.
   */
  private async postEntryTx(
    tx: any,
    card: any,
    opts: {
      kind: string;
      deltaMinor: bigint;
      orderId?: string | null;
      createdById?: string | null;
      note?: string | null;
      nextStatus?: string | null;
      balanceAlreadyApplied?: boolean;
    },
  ): Promise<any> {
    const cardId = String(card?.id ?? "");
    const fresh = await tx.giftCard.findFirst({ where: { id: cardId } });
    if (!fresh) throw new Error("gift_card_missing_in_tx");
    const delta = toBig(opts.deltaMinor);
    let newBalance: bigint;
    if (opts.balanceAlreadyApplied) {
      newBalance = toBig(fresh.balanceCache);
      if (opts.nextStatus) {
        await tx.giftCard.update({ where: { id: cardId }, data: { status: opts.nextStatus } });
      }
    } else {
      newBalance = toBig(fresh.balanceCache) + delta;
      const data: Record<string, any> = { balanceCache: { increment: delta } };
      if (opts.nextStatus) data.status = opts.nextStatus;
      await tx.giftCard.update({ where: { id: cardId }, data });
      const after = await tx.giftCard.findFirst({ where: { id: cardId } }).catch(() => null);
      if (after) newBalance = toBig(after.balanceCache);
    }
    return tx.giftCardLedger.create({
      data: {
        organizationId: fresh.organizationId ?? card.organizationId,
        giftCardId: cardId,
        kind: opts.kind,
        deltaMinor: delta,
        balanceAfter: newBalance,
        orderId: opts.orderId ?? null,
        createdById: opts.createdById ?? null,
        note: opts.note ?? null,
      },
    });
  }

  // ================= checkout =================

  /**
   * Resolve a customer-entered code to the snapshot a checkout
   * caller hands to PromotionsService.evaluateCheckout. Every
   * refusal is a Bengali BadRequest; an unknown code and a code
   * from another shop answer IDENTICALLY (a card's existence in
   * another org is not leaked).
   */
  async resolveForCheckout(
    orgId: string,
    rawCode: unknown,
    opts?: { cartHasGiftCardProduct?: boolean },
  ): Promise<any> {
    const canonical = normalizeGiftCardCode(rawCode);
    if (!canonical) throw new BadRequestException("গিফট কার্ডের কোডটি সঠিক নয়");
    if (opts?.cartHasGiftCardProduct) {
      // A gift card is stored value, not a mint: buying gift
      // cards WITH a gift card would let value duplicate itself.
      throw new BadRequestException("গিফট কার্ড দিয়ে গিফট কার্ড কেনা যাবে না");
    }
    const setting = await this.loadSetting(orgId);
    if (setting && setting.redemptionEnabled === false) {
      throw new BadRequestException("এই দোকানে এখন গিফট কার্ডে কেনাকাটা বন্ধ আছে");
    }
    const card = await this.t("giftCard")
      .findFirst({ where: { organizationId: orgId, codeHash: hashGiftCardCode(canonical) } })
      .catch(() => null);
    if (!card) throw new BadRequestException("গিফট কার্ডের কোডটি সঠিক নয়");
    const status = effectiveGiftCardStatus(card);
    if (status === "void") throw new BadRequestException("কার্ডটি বাতিল করা হয়েছে");
    if (status === "expired") throw new BadRequestException("কার্ডটির মেয়াদ শেষ হয়ে গেছে");
    const balanceMinor = giftCardEffectiveBalanceMinor(card);
    if (balanceMinor <= 0n) throw new BadRequestException("কার্ডে কোনো ব্যালেন্স অবশিষ্ট নেই");
    return {
      giftCardId: String(card.id),
      codeLast4: String(card.codeLast4 ?? canonical.slice(-4)),
      balanceMinor,
      status,
      expiresAt: card.expiresAt ? new Date(card.expiresAt) : null,
    };
  }

  /**
   * Spend the amount an evaluation applied, AFTER the order
   * exists (placement-time posting — a failed placement posts
   * nothing). The AB1 postPlacementRedeem mirror: failure-
   * isolated by contract, exactly-once per (card, order).
   *
   * Race posture (documented, AB1's): the conditional claim
   * decrements ONLY an active card whose balance still covers
   * the amount. When the claim loses (a concurrent spend won,
   * or the card was voided/expired meanwhile) this returns null
   * and writes NOTHING — the placed order keeps its priced
   * discount, the card is NOT charged, and staff reconcile the
   * difference via adjustBalance. Loud warn-log, never a throw
   * into a completed checkout.
   */
  async postPlacementRedeem(
    orgId: string,
    input: { orderId?: string | null; giftCardId?: string | null; amountMinor?: unknown },
  ): Promise<any | null> {
    try {
      const amount = toBig(input?.amountMinor);
      if (!input?.orderId || !input?.giftCardId || amount <= 0n) return null;
      return await (this.prisma as any).$transaction(async (tx: any) => {
        const existing = await tx.giftCardLedger.findFirst({
          where: {
            organizationId: orgId, giftCardId: input.giftCardId,
            orderId: input.orderId, kind: "redeem",
          },
        });
        if (existing) return existing;
        const claim = await tx.giftCard.updateMany({
          where: {
            id: input.giftCardId, organizationId: orgId,
            status: "active", balanceCache: { gte: amount },
          },
          data: { balanceCache: { decrement: amount } },
        });
        if (!claim || Number(claim.count ?? 0) === 0) {
          throw new Error("insufficient_gift_card_balance");
        }
        const fresh = await tx.giftCard.findFirst({ where: { id: input.giftCardId } });
        const nextStatus = fresh && toBig(fresh.balanceCache) === 0n ? "depleted" : null;
        return this.postEntryTx(tx, fresh ?? { id: input.giftCardId, organizationId: orgId }, {
          kind: "redeem",
          deltaMinor: -amount,
          orderId: input.orderId,
          balanceAlreadyApplied: true,
          nextStatus,
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) return null;
      this.logger.warn(
        `gift card redeem posting failed for order ${input?.orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  // ================= purchase intents =================

  private hintFor(hints: any, orderItemId: string): any | null {
    if (!hints) return null;
    if (typeof hints.get === "function") return hints.get(orderItemId) ?? null;
    if (typeof hints === "object") return hints[orderItemId] ?? null;
    return null;
  }

  /**
   * Record one purchase intent per gift-card ORDER LINE of an
   * order (orderItemId is the exactly-once claim). Called at
   * placement with the checkout's recipient hints, and again by
   * the reconciler as a no-hint fallback — first writer wins:
   * an existing intent is NEVER mutated, so a later hint can
   * never rewrite a recipient after the fact (documented).
   * Failure-isolated as a whole and per item.
   */
  async recordIntents(
    orgId: string,
    orderId: string,
    hints?: Map<string, any> | Record<string, any> | null,
  ): Promise<void> {
    try {
      if (!orgId || !orderId) return;
      const items: any[] =
        (await this.t("orderItem").findMany({ where: { orderId } }).catch(() => [])) ?? [];
      // Bounded: an order's lines are a handful; cap defensively.
      for (const item of items.slice(0, 200)) {
        try {
          if (!item?.productId) continue;
          const product = await this.t("product")
            .findFirst({ where: { id: item.productId, organizationId: orgId } })
            .catch(() => null);
          if (!product?.isGiftCard) continue;
          const existing = await this.t("giftCardIssuance")
            .findFirst({ where: { orderItemId: item.id } })
            .catch(() => null);
          if (existing) continue; // first writer wins — never mutate
          const hint = this.hintFor(hints, String(item.id));
          await this.t("giftCardIssuance").create({
            data: {
              organizationId: orgId,
              orderId,
              orderItemId: item.id,
              amountMinor: toBig(item.priceMinor),
              quantity: Math.max(1, Math.floor(Number(item.quantity ?? 1)) || 1),
              recipientName: hint?.recipientName ?? null,
              recipientEmail: hint?.recipientEmail ?? null,
              recipientPhone: hint?.recipientPhone ?? null,
              recipientMessage: hint?.recipientMessage ?? hint?.message ?? null,
            },
          });
        } catch (e) {
          if (!isUniqueViolation(e)) {
            this.logger.warn(
              `gift card intent recording failed for an item of order ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          // unique violation ⇒ a concurrent writer won the claim; skip
        }
      }
    } catch (e) {
      this.logger.warn(
        `gift card intent recording failed for order ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ================= recipient delivery =================

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
   * Send gift-card code(s) to the RECIPIENT — the only customer
   * channel that ever carries a full code besides the buyer's
   * reveal surface. Email wins when a recipient email exists
   * (platform EmailProvider, isConfigured-gated); otherwise SMS
   * via the LoyaltyService plumbing (tenant sender config
   * first, platform fallback when configured). Returns
   * "email" | "sms" ONLY when a send actually happened; any
   * failure ⇒ "none" (a send is never claimed that did not
   * happen). The code is never written to any log line.
   */
  private async sendGiftCardDelivery(
    orgId: string,
    input: {
      recipientEmail?: string | null;
      recipientPhone?: string | null;
      recipientName?: string | null;
      codes: string[];
      amountMinor: bigint;
      reference: string;
    },
  ): Promise<"email" | "sms" | "none"> {
    try {
      if (!input.codes.length) return "none";
      const shop = await this.shopName(orgId);
      const amountText = formatMinor(input.amountMinor);
      const codeText = input.codes.join(", ");
      const greeting = input.recipientName ? `${input.recipientName}, ` : "";
      if (input.recipientEmail) {
        if (!this.email || (typeof this.email.isConfigured === "function" && !this.email.isConfigured())) {
          return "none";
        }
        const text =
          `${greeting}আপনার জন্য একটি গিফট কার্ড এসেছে (${shop})।\n` +
          `কার্ডের কোড: ${codeText}\nমূল্য: ৳${amountText}\n` +
          `কেনাকাটার সময় চেকআউটে কোডটি ব্যবহার করুন।`;
        await this.email.send({ to: String(input.recipientEmail), subject: "আপনার গিফট কার্ড", text });
        return "email";
      }
      if (input.recipientPhone) {
        if (!this.sms) return "none";
        const text =
          `${shop}: আপনার গিফট কার্ডের কোড ${codeText} — মূল্য ৳${amountText}। চেকআউটে কোডটি ব্যবহার করুন।`;
        const phone = String(input.recipientPhone);
        const to = normalizeBdPhone(phone) ?? phone.replace(/\D/g, "");
        if (!to) return "none";
        const tenantCfg = await this.resolveTenantSms(orgId);
        if (tenantCfg) {
          await this.sms.sendWithGateway(tenantCfg.gateway, tenantCfg, {
            to, text, reference: input.reference,
          });
          return "sms";
        }
        if (this.sms.isConfigured()) {
          await this.sms.send({ to, text, reference: input.reference });
          return "sms";
        }
        return "none";
      }
      return "none";
    } catch (e) {
      this.logger.warn(
        `gift card recipient delivery failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return "none";
    }
  }

  // ================= the reconciler =================

  /**
   * Re-derive an order's gift-card state from the CURRENT DB
   * rows and post whatever is missing: record intents, mint
   * cards when the order is sold, restore redemptions in
   * proportion to refunds, and void purchased cards when the
   * purchase order dies / is fully refunded. Called by the
   * event handlers, by IntegrationsService on external status
   * changes, and directly by specs. Idempotent by construction
   * (every posting is claim-guarded) and failure-isolated by
   * contract.
   */
  async onOrderTransition(orgId: string | null | undefined, orderId: string | null | undefined): Promise<void> {
    try {
      if (!orgId || !orderId) return;
      const order = await this.t("order")
        .findFirst({ where: { id: orderId, organizationId: orgId } })
        .catch(() => null);
      if (!order || order.isPractice) return;

      const shipments: any[] =
        (await this.t("courierShipment")
          .findMany({ where: { organizationId: orgId, orderId: order.id } })
          .catch(() => [])) ?? [];
      const sold = isSoldOrderShape(
        String(order.status ?? ""),
        shipments.map((s) => String(s.status ?? "")),
      );

      // (a) Intents first — issuance below consumes them, and a
      // placement-time hint (first writer) is never overwritten.
      await this.recordIntents(orgId, String(order.id));

      // (b) Mint purchased cards once the order is sold.
      if (sold) await this.issuePurchasedCards(orgId, order);

      const status = String(order.status ?? "");
      const total = toBig(order.totalMinor);
      const recorded = toBig(order.refundedMinor);
      // A "refunded" status from an external system means a FULL
      // refund even when the synced refundedMinor lags (the AB1
      // rule, kept identical here).
      const effectiveRefunded =
        status === "refunded" && recorded < total ? total : recorded;

      // (c) Give spent value back in proportion to the refund.
      await this.restoreRedemptions(orgId, order, effectiveRefunded);

      // (d) A dead / fully-refunded purchase order voids the
      // cards it minted (their UNSPENT remainder only — value
      // already spent on other orders is spent). Partial refunds
      // NEVER void (documented refinement, the AB1
      // referral-coupon rule).
      if (DEAD_STATUSES.has(status) || status === "refunded" || (total > 0n && effectiveRefunded >= total)) {
        await this.voidPurchasedCards(orgId, order);
      }
    } catch (e) {
      this.logger.warn(
        `gift card reconcile failed for order ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** (b) Mint the missing units of every intent of a sold
   * order. (issuedOrderItemId, unitIndex) is the exactly-once
   * claim — checked first inside the minting transaction, the
   * DB unique index backstops. One transaction per card. */
  private async issuePurchasedCards(orgId: string, order: any): Promise<void> {
    const intents: any[] =
      (await this.t("giftCardIssuance")
        .findMany({ where: { organizationId: orgId, orderId: order.id } })
        .catch(() => [])) ?? [];
    if (!intents.length) return;
    const setting = await this.loadSetting(orgId);
    const expiresAt =
      setting?.defaultExpiryDays != null
        ? new Date(Date.now() + Number(setting.defaultExpiryDays) * 86400_000)
        : null;

    for (const intent of intents) {
      try {
        const quantity = Math.max(1, Math.floor(Number(intent.quantity ?? 1)) || 1);
        const existingCards: any[] =
          (await this.t("giftCard")
            .findMany({ where: { organizationId: orgId, issuedOrderItemId: intent.orderItemId } })
            .catch(() => [])) ?? [];
        const haveUnits = new Set(existingCards.map((c) => Number(c.unitIndex ?? 0)));
        const createdCodes: string[] = [];

        for (let unitIndex = 0; unitIndex < quantity; unitIndex++) {
          if (haveUnits.has(unitIndex)) continue;
          const code = await this.mintOneCard(orgId, {
            amountMinor: toBig(intent.amountMinor),
            buyerCustomerId: order.customerId ?? null,
            recipientName: intent.recipientName ?? null,
            recipientEmail: intent.recipientEmail ?? null,
            recipientPhone: intent.recipientPhone ?? null,
            recipientMessage: intent.recipientMessage ?? null,
            issuedOrderId: String(order.id),
            issuedOrderItemId: String(intent.orderItemId),
            unitIndex,
            source: "purchase",
            expiresAt,
            createdById: null,
            note: null,
          });
          if (code) createdCodes.push(code);
        }

        // Delivery + the issuedAt stamp happen only once EVERY
        // unit exists, and only on the pass that first completes
        // the intent (issuedAt was null) — that guard is what
        // makes the recipient send exactly-once per intent.
        const after: any[] =
          (await this.t("giftCard")
            .findMany({ where: { organizationId: orgId, issuedOrderItemId: intent.orderItemId } })
            .catch(() => [])) ?? [];
        if (after.length < quantity) continue;
        if (intent.issuedAt != null) continue;

        let codes = createdCodes;
        if (!codes.length) {
          // Completed by an earlier pass that died before
          // stamping: recover the codes from the sealed copies
          // (this service's own unseal path, never logged).
          codes = this.unsealCards(after);
        }
        await this.t("giftCardIssuance").update({
          where: { id: intent.id },
          data: { issuedAt: new Date() },
        });
        const sentVia = await this.sendGiftCardDelivery(orgId, {
          recipientEmail: intent.recipientEmail ?? null,
          recipientPhone: intent.recipientPhone ?? null,
          recipientName: intent.recipientName ?? null,
          codes,
          amountMinor: toBig(intent.amountMinor),
          reference: `gift-card-intent-${intent.id}`,
        });
        await this.t("giftCardIssuance")
          .update({ where: { id: intent.id }, data: { sentVia } })
          .catch(() => undefined);
      } catch (e) {
        if (!isUniqueViolation(e)) {
          this.logger.warn(
            `gift card issuance failed for an intent of order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
  }

  /** Mint ONE card + its issue entry in one transaction.
   * Returns the plaintext code (for the caller's recipient
   * delivery only — never logged), or null when the unit was
   * already claimed by a concurrent pass. */
  private async mintOneCard(
    orgId: string,
    fields: {
      amountMinor: bigint;
      buyerCustomerId?: string | null;
      recipientName?: string | null;
      recipientEmail?: string | null;
      recipientPhone?: string | null;
      recipientMessage?: string | null;
      issuedOrderId?: string | null;
      issuedOrderItemId?: string | null;
      unitIndex: number;
      source: string;
      expiresAt: Date | null;
      createdById?: string | null;
      note?: string | null;
    },
  ): Promise<string | null> {
    try {
      let mintedCode: string | null = null;
      await (this.prisma as any).$transaction(async (tx: any) => {
        if (fields.issuedOrderItemId) {
          const claimed = await tx.giftCard.findFirst({
            where: { issuedOrderItemId: fields.issuedOrderItemId, unitIndex: fields.unitIndex },
          });
          if (claimed) return;
        }
        // Generate a code whose hash is unused (≤5 attempts on
        // the astronomically unlikely collision).
        let code: string | null = null;
        let codeHash = "";
        for (let attempt = 0; attempt < 5 && !code; attempt++) {
          const candidate = generateGiftCardCode();
          const candidateHash = hashGiftCardCode(candidate);
          const clash = await tx.giftCard
            .findFirst({ where: { codeHash: candidateHash } })
            .catch(() => null);
          if (!clash) {
            code = candidate;
            codeHash = candidateHash;
          }
        }
        if (!code) throw new Error("gift_card_code_generation_failed");
        const card = await tx.giftCard.create({
          data: {
            organizationId: orgId,
            codeHash,
            codeSealed: encryptJson({ code }),
            codePrefix: "QG",
            codeLast4: code.slice(-4),
            initialAmountMinor: fields.amountMinor,
            balanceCache: fields.amountMinor,
            currency: "BDT",
            status: "active",
            buyerCustomerId: fields.buyerCustomerId ?? null,
            recipientName: fields.recipientName ?? null,
            recipientEmail: fields.recipientEmail ?? null,
            recipientPhone: fields.recipientPhone ?? null,
            recipientMessage: fields.recipientMessage ?? null,
            issuedOrderId: fields.issuedOrderId ?? null,
            issuedOrderItemId: fields.issuedOrderItemId ?? null,
            unitIndex: fields.unitIndex,
            source: fields.source,
            expiresAt: fields.expiresAt,
            createdById: fields.createdById ?? null,
            note: fields.note ?? null,
          },
        });
        await this.postEntryTx(tx, card, {
          kind: "issue",
          deltaMinor: fields.amountMinor,
          orderId: fields.issuedOrderId ?? null,
          createdById: fields.createdById ?? null,
          balanceAlreadyApplied: true,
        });
        mintedCode = code;
      });
      return mintedCode;
    } catch (e) {
      if (isUniqueViolation(e)) return null; // the unit claim was won concurrently
      throw e;
    }
  }

  /** Unseal cards for an entitled surface; a failed unseal skips
   * that card with a warn-log that NEVER contains a code. */
  private unsealCards(cards: any[]): string[] {
    const codes: string[] = [];
    for (const card of cards) {
      try {
        const unsealed = decryptJson<{ code?: string }>(String(card.codeSealed ?? ""));
        if (unsealed?.code) codes.push(String(unsealed.code));
      } catch {
        this.logger.warn(`gift card unseal failed for card ${card?.id} — skipped`);
      }
    }
    return codes;
  }

  /** (c) Restore redemptions charged to THIS order, in
   * proportion to its cumulative refunded share. Prior restores
   * are summed from the ledger, so repeated reconciles converge
   * instead of double-posting (the AB1 clawback discipline). */
  private async restoreRedemptions(orgId: string, order: any, effectiveRefunded: bigint): Promise<void> {
    const redeems: any[] =
      (await this.t("giftCardLedger")
        .findMany({ where: { organizationId: orgId, orderId: order.id, kind: "redeem" } })
        .catch(() => [])) ?? [];
    if (!redeems.length) return;
    const status = String(order.status ?? "");
    const dead = DEAD_STATUSES.has(status) || status === "refunded" && toBig(order.refundedMinor) <= 0n;
    const total = toBig(order.totalMinor);

    for (const redeem of redeems) {
      try {
        const redeemed = -toBig(redeem.deltaMinor);
        if (redeemed <= 0n) continue;
        let target: bigint;
        if (DEAD_STATUSES.has(status)) {
          target = redeemed; // a dead order's spend is returned in full
        } else if (status === "refunded" && toBig(order.refundedMinor) <= 0n) {
          target = redeemed; // refunded with no recorded amount ⇒ full
        } else if (total <= 0n) {
          target = 0n;
        } else {
          target = (redeemed * effectiveRefunded) / total;
        }
        if (target <= 0n) continue;
        await (this.prisma as any).$transaction(async (tx: any) => {
          const priors: any[] =
            (await tx.giftCardLedger
              .findMany({
                where: {
                  organizationId: orgId, giftCardId: redeem.giftCardId,
                  orderId: order.id, kind: "restore",
                },
              })
              .catch(() => [])) ?? [];
          const already = priors.reduce((s: bigint, r: any) => s + toBig(r.deltaMinor), 0n);
          const delta = target - already;
          if (delta <= 0n) return;
          const card = await tx.giftCard.findFirst({ where: { id: redeem.giftCardId } });
          if (!card) return;
          if (String(card.status) === "void") {
            // Documented: a staff-voided card does NOT
            // resurrect — the restore is skipped loudly so a
            // human can reconcile via adjust on a live card.
            this.logger.warn(
              `gift card restore skipped for order ${order.id}: card ${card.id} is void`,
            );
            return;
          }
          const newBalance = toBig(card.balanceCache) + delta;
          const nextStatus =
            String(card.status) === "depleted" && newBalance > 0n ? "active" : null;
          await this.postEntryTx(tx, card, {
            kind: "restore",
            deltaMinor: delta,
            orderId: order.id,
            note: GIFT_CARD_NOTE_RESTORE,
            nextStatus,
          });
        });
      } catch (e) {
        this.logger.warn(
          `gift card restore failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    void dead;
  }

  /** (d) Void every still-live card this order minted. The
   * claim flips the status first; the void entry then zeroes
   * whatever balance remains. Cards already void are untouched
   * (no second entry). */
  private async voidPurchasedCards(orgId: string, order: any): Promise<void> {
    const cards: any[] =
      (await this.t("giftCard")
        .findMany({
          where: {
            organizationId: orgId, issuedOrderId: order.id,
            status: { in: ["active", "depleted"] },
          },
        })
        .catch(() => [])) ?? [];
    for (const card of cards) {
      try {
        await (this.prisma as any).$transaction(async (tx: any) => {
          const claim = await tx.giftCard.updateMany({
            where: {
              id: card.id, organizationId: orgId,
              status: { in: ["active", "depleted"] },
            },
            data: { status: "void" },
          });
          if (!claim || Number(claim.count ?? 0) === 0) return;
          const fresh = await tx.giftCard.findFirst({ where: { id: card.id } });
          const balance = toBig(fresh?.balanceCache ?? card.balanceCache);
          if (balance > 0n) {
            await this.postEntryTx(tx, fresh ?? card, {
              kind: "void",
              deltaMinor: -balance,
              orderId: order.id,
              note: GIFT_CARD_NOTE_PURCHASE_VOID,
              nextStatus: "void",
            });
          }
        });
      } catch (e) {
        this.logger.warn(
          `gift card purchase-void failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // ================= expiry sweep =================

  /**
   * gift_card_expiry_sweep job body (per-org enablement, the
   * AutomationService pattern): persist the lazy expiry —
   * every active OR depleted card whose expiresAt has passed
   * flips to expired (depleted cards flip too, so the stored
   * status tells the truth; an entry is written only when a
   * balance is actually released). Exactly-once: the claim
   * selects only live statuses, so a swept card never re-enters.
   */
  async runExpirySweep(orgId: string): Promise<{ expired: number; releasedMinor: string }> {
    const now = new Date();
    const cards: any[] =
      (await this.t("giftCard")
        .findMany({
          where: {
            organizationId: orgId,
            status: { in: ["active", "depleted"] },
            expiresAt: { not: null, lt: now },
          },
          orderBy: [{ createdAt: "asc" }],
          take: 500,
        })
        .catch(() => [])) ?? [];
    let expired = 0;
    let released = 0n;
    for (const card of cards) {
      try {
        const releasedForCard = await (this.prisma as any).$transaction(async (tx: any) => {
          const fresh = await tx.giftCard.findFirst({ where: { id: card.id } });
          if (!fresh) return null;
          if (fresh.status !== "active" && fresh.status !== "depleted") return null;
          if (!fresh.expiresAt || new Date(fresh.expiresAt).getTime() >= now.getTime()) return null;
          const claim = await tx.giftCard.updateMany({
            where: {
              id: card.id, organizationId: orgId,
              status: { in: ["active", "depleted"] },
              expiresAt: { lt: now },
            },
            data: { status: "expired" },
          });
          if (!claim || Number(claim.count ?? 0) === 0) return null;
          const balance = toBig(fresh.balanceCache);
          if (balance > 0n) {
            await this.postEntryTx(tx, fresh, {
              kind: "expire",
              deltaMinor: -balance,
              note: GIFT_CARD_NOTE_EXPIRED,
              nextStatus: "expired",
            });
            return balance;
          }
          return 0n;
        });
        if (releasedForCard !== null && releasedForCard !== undefined) {
          expired += 1;
          released += toBig(releasedForCard);
        }
      } catch (e) {
        this.logger.warn(
          `gift card expiry failed for card ${card.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return { expired, releasedMinor: String(released) };
  }

  // ================= staff surfaces =================

  private serializeCard(card: any): any {
    return {
      id: String(card.id),
      codePrefix: card.codePrefix ?? "QG",
      codeLast4: card.codeLast4 ?? null,
      initialAmountMinor: String(toBig(card.initialAmountMinor)),
      balanceMinor: String(giftCardEffectiveBalanceMinor(card)),
      status: effectiveGiftCardStatus(card),
      source: card.source ?? null,
      issuedOrderId: card.issuedOrderId ?? null,
      recipientName: card.recipientName ?? null,
      expiresAt: card.expiresAt ? new Date(card.expiresAt).toISOString() : null,
      createdAt: card.createdAt ? new Date(card.createdAt).toISOString() : null,
    };
  }

  private serializeLedgerEntry(e: any): any {
    return {
      id: String(e.id),
      kind: e.kind,
      deltaMinor: String(toBig(e.deltaMinor)),
      balanceAfter: String(toBig(e.balanceAfter)),
      orderId: e.orderId ?? null,
      createdById: e.createdById ?? null,
      note: e.note ?? null,
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
    };
  }

  /**
   * Staff card list. Search semantics (documented): the search
   * text is normalized (non-alphanumerics stripped, uppercased)
   * and its last 4 characters are matched EXACTLY against
   * codeLast4 — staff search by the visible suffix, never by a
   * full code. The status filter applies to the EFFECTIVE
   * status (lazily-expired cards list as expired before the
   * sweep runs), so filtering + pagination happen after the
   * effective projection over a bounded row set.
   */
  async listCards(orgId: string, q?: { search?: string; status?: string; page?: number; pageSize?: number }): Promise<any> {
    const page = Math.max(1, Math.floor(Number(q?.page ?? 1)) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(q?.pageSize ?? 20)) || 20));
    const where: Record<string, any> = { organizationId: orgId };
    const cleaned = String(q?.search ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (cleaned) where.codeLast4 = cleaned.slice(-4);
    const statusFilter = q?.status && CARD_STATUSES.has(String(q.status)) ? String(q.status) : null;
    const rows: any[] =
      (await this.t("giftCard")
        .findMany({ where, orderBy: [{ createdAt: "desc" }], take: 5000 })
        .catch(() => [])) ?? [];
    const projected = rows.map((r) => this.serializeCard(r));
    const filtered = statusFilter ? projected.filter((r) => r.status === statusFilter) : projected;
    const total = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);
    return { items, total, page, pageSize };
  }

  async getCard(orgId: string, id: string): Promise<any> {
    const card = await this.t("giftCard")
      .findFirst({ where: { id, organizationId: orgId } })
      .catch(() => null);
    if (!card) throw new NotFoundException("গিফট কার্ড পাওয়া যায়নি");
    const ledger: any[] =
      (await this.t("giftCardLedger")
        .findMany({
          where: { organizationId: orgId, giftCardId: id },
          orderBy: [{ createdAt: "desc" }],
          take: 100,
        })
        .catch(() => [])) ?? [];
    return {
      ...this.serializeCard(card),
      buyerCustomerId: card.buyerCustomerId ?? null,
      recipientEmail: card.recipientEmail ?? null,
      recipientPhone: card.recipientPhone ?? null,
      recipientMessage: card.recipientMessage ?? null,
      issuedOrderItemId: card.issuedOrderItemId ?? null,
      note: card.note ?? null,
      createdById: card.createdById ?? null,
      currency: card.currency ?? "BDT",
      ledger: ledger.map((e) => this.serializeLedgerEntry(e)),
    };
  }

  /**
   * Staff manual issue. A recipient contact is REQUIRED — the
   * code is sent only to the recipient and is shown NOWHERE in
   * the staff UI / this response (prefix + last4 only), so a
   * card without a reachable recipient would be value created
   * that nobody can ever spend. A note is likewise mandatory:
   * every manual mint explains itself in the ledger + audit.
   */
  async manualIssue(orgId: string, actorId: string, dto: any): Promise<any> {
    let amount: bigint;
    try {
      amount = BigInt(dto?.amountMinor);
    } catch {
      throw new BadRequestException("গিফট কার্ডের পরিমাণ সঠিক সংখ্যায় পাঠান (পয়সায়)");
    }
    if (amount <= 0n || amount > MAX_MANUAL_AMOUNT_MINOR) {
      throw new BadRequestException("গিফট কার্ডের পরিমাণ সঠিক নয়");
    }
    const note = String(dto?.note ?? "").trim();
    if (!note) throw new BadRequestException("নোট দেওয়া বাধ্যতামূলক");
    const recipientEmail = String(dto?.recipientEmail ?? "").trim() || null;
    const recipientPhone = String(dto?.recipientPhone ?? "").trim() || null;
    const emailOk = recipientEmail !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail);
    if (!emailOk && !recipientPhone) {
      throw new BadRequestException(
        "প্রাপকের ইমেইল বা ফোন নম্বর দিন — গিফট কার্ডের কোড শুধুমাত্র প্রাপকের কাছেই পাঠানো হয়, এখানে দেখা যায় না",
      );
    }
    const setting = await this.loadSetting(orgId);
    const expiresAt =
      setting?.defaultExpiryDays != null
        ? new Date(Date.now() + Number(setting.defaultExpiryDays) * 86400_000)
        : null;
    // Mint outside the generic purchase path so the plaintext
    // code is in hand for the recipient send (never logged,
    // never returned).
    let createdCard: any = null;
    let mintedCode: string | null = null;
    await (this.prisma as any).$transaction(async (tx: any) => {
      let code: string | null = null;
      let codeHash = "";
      for (let attempt = 0; attempt < 5 && !code; attempt++) {
        const candidate = generateGiftCardCode();
        const candidateHash = hashGiftCardCode(candidate);
        const clash = await tx.giftCard
          .findFirst({ where: { codeHash: candidateHash } })
          .catch(() => null);
        if (!clash) {
          code = candidate;
          codeHash = candidateHash;
        }
      }
      if (!code) throw new Error("gift_card_code_generation_failed");
      const card = await tx.giftCard.create({
        data: {
          organizationId: orgId,
          codeHash,
          codeSealed: encryptJson({ code }),
          codePrefix: "QG",
          codeLast4: code.slice(-4),
          initialAmountMinor: amount,
          balanceCache: amount,
          currency: "BDT",
          status: "active",
          buyerCustomerId: null,
          recipientName: dto?.recipientName ? String(dto.recipientName) : null,
          recipientEmail,
          recipientPhone,
          recipientMessage: null,
          issuedOrderId: null,
          issuedOrderItemId: null,
          unitIndex: 0,
          source: "manual",
          expiresAt,
          createdById: actorId,
          note,
        },
      });
      await this.postEntryTx(tx, card, {
        kind: "issue",
        deltaMinor: amount,
        createdById: actorId,
        note,
        balanceAlreadyApplied: true,
      });
      createdCard = card;
      mintedCode = code;
    });
    const sentVia = await this.sendGiftCardDelivery(orgId, {
      recipientEmail,
      recipientPhone,
      recipientName: dto?.recipientName ? String(dto.recipientName) : null,
      codes: mintedCode ? [mintedCode] : [],
      amountMinor: amount,
      reference: `gift-card-manual-${createdCard?.id ?? "unknown"}`,
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "gift_card.manual_issued",
      entityType: "GiftCard", entityId: createdCard?.id ?? "",
      metadata: {
        amountMinor: String(amount),
        codeLast4: createdCard?.codeLast4 ?? null,
        sentVia,
      },
    });
    return { card: this.serializeCard(createdCard), sentVia };
  }

  /** Staff void. Note mandatory; the status flip always
   * happens, a ledger entry is written only when a balance is
   * actually zeroed (a 0-delta row is noise). An
   * effective-expired-but-not-yet-swept card is voidable. */
  async voidCard(orgId: string, actorId: string, id: string, dto: { note?: string }): Promise<any> {
    const note = String(dto?.note ?? "").trim();
    if (!note) throw new BadRequestException("নোট দেওয়া বাধ্যতামূলক");
    let voidedMinor = 0n;
    let cardAfter: any = null;
    await (this.prisma as any).$transaction(async (tx: any) => {
      const card = await tx.giftCard.findFirst({ where: { id, organizationId: orgId } });
      if (!card) throw new NotFoundException("গিফট কার্ড পাওয়া যায়নি");
      if (String(card.status) === "void") {
        throw new BadRequestException("কার্ডটি ইতিমধ্যে বাতিল");
      }
      const claim = await tx.giftCard.updateMany({
        where: { id, organizationId: orgId, status: { in: ["active", "depleted", "expired"] } },
        data: { status: "void" },
      });
      if (!claim || Number(claim.count ?? 0) === 0) {
        throw new BadRequestException("কার্ডটি ইতিমধ্যে বাতিল");
      }
      const balance = toBig(card.balanceCache);
      voidedMinor = balance;
      if (balance > 0n) {
        await this.postEntryTx(tx, card, {
          kind: "void",
          deltaMinor: -balance,
          createdById: actorId,
          note,
          nextStatus: "void",
        });
      }
      cardAfter = await tx.giftCard.findFirst({ where: { id } });
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "gift_card.voided",
      entityType: "GiftCard", entityId: id,
      metadata: { codeLast4: cardAfter?.codeLast4 ?? null, voidedMinor: String(voidedMinor) },
    });
    return { card: this.serializeCard(cardAfter) };
  }

  /** Staff balance correction. Note mandatory; the corrected
   * balance may reach zero (→ depleted) but never go negative
   * — removing wrongly-issued value beyond the balance is a
   * void's job, not an adjust's. */
  async adjustBalance(orgId: string, actorId: string, id: string, dto: { deltaMinor?: unknown; note?: string }): Promise<any> {
    const note = String(dto?.note ?? "").trim();
    if (!note) throw new BadRequestException("নোট দেওয়া বাধ্যতামূলক");
    let delta: bigint;
    try {
      delta = BigInt(dto?.deltaMinor as any);
    } catch {
      throw new BadRequestException("সংশোধনের পরিমাণ সঠিক সংখ্যায় পাঠান (পয়সায়)");
    }
    if (delta === 0n) throw new BadRequestException("সংশোধনের পরিমাণ শূন্য হতে পারবে না");
    let cardAfter: any = null;
    await (this.prisma as any).$transaction(async (tx: any) => {
      const card = await tx.giftCard.findFirst({ where: { id, organizationId: orgId } });
      if (!card) throw new NotFoundException("গিফট কার্ড পাওয়া যায়নি");
      const effective = effectiveGiftCardStatus(card);
      if (effective === "void" || effective === "expired") {
        throw new BadRequestException("বাতিল/মেয়াদোত্তীর্ণ কার্ডে সংশোধন করা যাবে না");
      }
      const newBalance = toBig(card.balanceCache) + delta;
      if (newBalance < 0n) {
        throw new BadRequestException("সংশোধনের পর ব্যালেন্স ঋণাত্মক হতে পারবে না");
      }
      const nextStatus =
        newBalance === 0n
          ? "depleted"
          : String(card.status) === "depleted" && newBalance > 0n
            ? "active"
            : null;
      await this.postEntryTx(tx, card, {
        kind: "adjust",
        deltaMinor: delta,
        createdById: actorId,
        note,
        nextStatus,
      });
      cardAfter = await tx.giftCard.findFirst({ where: { id } });
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "gift_card.adjusted",
      entityType: "GiftCard", entityId: id,
      metadata: { deltaMinor: String(delta), codeLast4: cardAfter?.codeLast4 ?? null },
    });
    return { card: this.serializeCard(cardAfter) };
  }

  // ================= public + buyer surfaces =================

  /**
   * Public balance check: code + org are the whole credential.
   * An unknown code and another shop's code answer with the
   * SAME error. Never returns recipient / issuance data.
   */
  async publicBalance(orgId: string, rawCode: unknown): Promise<any> {
    const canonical = normalizeGiftCardCode(rawCode);
    if (!canonical) {
      throw new BadRequestException("গিফট কার্ডের কোডটি সঠিক নয় বা এই দোকানের কার্ড নয়");
    }
    const card = await this.t("giftCard")
      .findFirst({ where: { organizationId: orgId, codeHash: hashGiftCardCode(canonical) } })
      .catch(() => null);
    if (!card) {
      throw new BadRequestException("গিফট কার্ডের কোডটি সঠিক নয় বা এই দোকানের কার্ড নয়");
    }
    return {
      balanceMinor: String(giftCardEffectiveBalanceMinor(card)),
      status: effectiveGiftCardStatus(card),
      expiresAt: card.expiresAt ? new Date(card.expiresAt).toISOString() : null,
    };
  }

  /**
   * The ONLY method that unseals codes — it exists solely for
   * the entitled buyer's delivery surface (their own order's
   * cards). A card whose seal fails to open is skipped with a
   * warn-log (never carrying a code).
   */
  async buyerRevealForOrder(orgId: string, orderId: string): Promise<any[]> {
    const cards: any[] =
      (await this.t("giftCard")
        .findMany({
          where: { organizationId: orgId, issuedOrderId: orderId },
          orderBy: [{ unitIndex: "asc" }, { createdAt: "asc" }],
        })
        .catch(() => [])) ?? [];
    const out: any[] = [];
    for (const card of cards) {
      let code: string | null = null;
      try {
        const unsealed = decryptJson<{ code?: string }>(String(card.codeSealed ?? ""));
        code = unsealed?.code ? String(unsealed.code) : null;
      } catch {
        this.logger.warn(`gift card unseal failed for card ${card.id} — skipped from buyer reveal`);
      }
      if (!code) continue;
      out.push({
        code,
        codeLast4: card.codeLast4 ?? code.slice(-4),
        initialAmountMinor: String(toBig(card.initialAmountMinor)),
        balanceMinor: String(giftCardEffectiveBalanceMinor(card)),
        status: effectiveGiftCardStatus(card),
        expiresAt: card.expiresAt ? new Date(card.expiresAt).toISOString() : null,
      });
    }
    return out;
  }

  // ================= liability report =================

  /**
   * Gift-card liability + period movement report. Outstanding
   * is the sum of EFFECTIVE balances over stored-active cards
   * (lazily-expired rows contribute 0 through the effective
   * helper), bounded at 5000 rows with a truncation flag (the
   * GB7 report discipline). Period sums come from the ledger —
   * the truth — in the requested window (default: last 30
   * days, the PromotionsService.promotionsReport style).
   */
  async liabilityReport(orgId: string, fromRaw?: string, toRaw?: string): Promise<any> {
    const now = new Date();
    let to = now;
    let from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    if (fromRaw) {
      const d = new Date(fromRaw);
      if (Number.isNaN(d.getTime())) throw new BadRequestException("শুরুর তারিখটি সঠিক নয়");
      from = d;
    }
    if (toRaw) {
      const d = new Date(toRaw);
      if (Number.isNaN(d.getTime())) throw new BadRequestException("শেষের তারিখটি সঠিক নয়");
      to = d;
    }

    const fetched: any[] =
      (await this.t("giftCard")
        .findMany({ where: { organizationId: orgId, status: "active" }, take: 5001 })
        .catch(() => [])) ?? [];
    const truncated = fetched.length > 5000;
    const activeRows = fetched.slice(0, 5000);
    const liveRows = activeRows.filter((c) => effectiveGiftCardStatus(c) === "active");
    const outstanding = liveRows.reduce((s: bigint, c: any) => s + giftCardEffectiveBalanceMinor(c), 0n);

    const entries: any[] =
      (await this.t("giftCardLedger")
        .findMany({
          where: { organizationId: orgId, createdAt: { gte: from, lte: to } },
          take: 10000,
        })
        .catch(() => [])) ?? [];
    const sumKind = (kind: string, sign: 1n | -1n) =>
      entries
        .filter((e) => e.kind === kind)
        .reduce((s: bigint, e: any) => s + sign * toBig(e.deltaMinor), 0n);
    // issue deltas are positive, redeem/restore positive-signed
    // by kind semantics: redeem/expire/void deltas are negative,
    // so their period totals are reported as positive magnitudes.
    const issued = entries
      .filter((e) => e.kind === "issue" && toBig(e.deltaMinor) > 0n)
      .reduce((s: bigint, e: any) => s + toBig(e.deltaMinor), 0n);
    const adjustedNet = entries
      .filter((e) => e.kind === "adjust")
      .reduce((s: bigint, e: any) => s + toBig(e.deltaMinor), 0n);

    return {
      outstandingMinor: String(outstanding),
      outstandingCount: liveRows.length,
      issuedMinor: String(issued),
      redeemedMinor: String(sumKind("redeem", -1n)),
      restoredMinor: String(sumKind("restore", 1n)),
      expiredMinor: String(sumKind("expire", -1n)),
      voidedMinor: String(sumKind("void", -1n)),
      adjustedNetMinor: String(adjustedNet),
      from: from.toISOString(),
      to: to.toISOString(),
      truncated,
    };
  }
}
