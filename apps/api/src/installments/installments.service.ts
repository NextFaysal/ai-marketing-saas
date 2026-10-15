import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ShopAccountService } from "../storefront/shop-account.service";
import type { CollectInstallmentDto, CreateInstallmentPlanDto } from "./installments.dto";

/**
 * EC31 — installment (কিস্তি) plans over an order's outstanding
 * due.
 *
 * The plan's totalMinor is a SNAPSHOT of the order's due at
 * creation (approved-verification math, EC19) — it schedules
 * what is owed, never the full order total when an advance was
 * already paid. Collections are recorded as PaymentVerification
 * rows in EXACTLY the EC19 approved shape (verdict "matched",
 * status "approved", modelProvider "manual_staff", source
 * "installment", installmentItemId set), so the EC19 due math
 * reduces the order's amountDueMinor by construction — there is
 * no second ledger to drift.
 *
 * v1 limits, by design:
 *  - ONE plan per order LIFETIME: InstallmentPlan.orderId is
 *    UNIQUE, so a cancelled/completed plan still occupies the
 *    order — a second plan for the same order is refused with
 *    a clear message rather than silently replacing history.
 *  - Items may be collected in ANY order (no sequence gate):
 *    real BD practice collects whichever installment the
 *    customer actually pays; the plan completes when every
 *    item is fully paid, in whatever order that happens.
 *
 * All due-date logic works on Asia/Dhaka DAY STRINGS
 * ("YYYY-MM-DD"), never raw timestamps: an item's dueDate is
 * stored as UTC midnight of its intended Dhaka day, and Dhaka
 * formatting of that instant returns the same day.
 */
@Injectable()
export class InstallmentsService {
  private readonly logger = new Logger(InstallmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly shopAccounts?: ShopAccountService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  // ---------- Dhaka day helpers ----------

  /** "YYYY-MM-DD" of an instant in Asia/Dhaka. */
  dhakaDayString(date: Date | string): string {
    const d = date instanceof Date ? date : new Date(date);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  /** Day-string arithmetic via UTC (a day string has no DST). */
  addDaysToDayString(day: string, n: number): string {
    const [y, m, d] = day.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + n * 24 * 3600 * 1000);
    const pad = (x: number) => String(x).padStart(2, "0");
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }

  /** The stored dueDate instant for a Dhaka day string. */
  private dayStringToDate(day: string): Date {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  /** Whole days from `fromDay` to `toDay` (both day strings). */
  private dayDiff(fromDay: string, toDay: string): number {
    const a = this.dayStringToDate(fromDay).getTime();
    const b = this.dayStringToDate(toDay).getTime();
    return Math.round((b - a) / (24 * 3600 * 1000));
  }

  private dueDayOf(item: any): string {
    return this.dhakaDayString(item.dueDate);
  }

  private todayDhaka(): string {
    return this.dhakaDayString(new Date());
  }

  /** Minor → major for SMS text: no trailing ".00" when whole. */
  private formatMajor(minor: bigint): string {
    const neg = minor < 0n;
    const abs = neg ? -minor : minor;
    const whole = abs / 100n;
    const rem = abs % 100n;
    if (rem === 0n) return `${neg ? "-" : ""}${whole.toString()}`;
    return `${neg ? "-" : ""}${whole.toString()}.${String(rem).padStart(2, "0")}`;
  }

  // ---------- EC19 due math (same helpers, same meaning) ----------

  /** Sum of APPROVED verification amounts (null amounts count 0).
   * Copy of the EC19 OrdersService helper — kept identical so
   * installment collections (approved rows) reduce the due the
   * same way staff advances do. */
  private approvedAdvanceSum(rows: any[]): bigint {
    let sum = 0n;
    for (const row of rows) {
      if (row.status !== "approved") continue;
      if (row.amountMinor === null || row.amountMinor === undefined) continue;
      try { sum += BigInt(row.amountMinor as any); } catch { /* unparseable stored amount counts 0 */ }
    }
    return sum;
  }

  private async verificationRowsForOrder(organizationId: string, orderId: string): Promise<any[]> {
    const table = this.t("paymentVerification");
    if (!table?.findMany) return [];
    return (await table.findMany({ where: { organizationId, orderId } }).catch(() => [])) ?? [];
  }

  /** What is still owed on the order: total − approved, floored at 0. */
  private async orderDue(organizationId: string, order: any): Promise<bigint> {
    const rows = await this.verificationRowsForOrder(organizationId, order.id);
    const paid = this.approvedAdvanceSum(rows);
    const total = BigInt(order.totalMinor ?? 0);
    return total > paid ? total - paid : 0n;
  }

  private async orderDueMinor(organizationId: string, orderId: string): Promise<string> {
    const order = await this.t("order")
      .findFirst({ where: { id: orderId, organizationId } })
      .catch(() => null);
    if (!order) return "0";
    return (await this.orderDue(organizationId, order)).toString();
  }

  // ---------- Serialization ----------

  private async itemsForPlan(plan: any): Promise<any[]> {
    if (Array.isArray(plan?.items)) {
      return [...plan.items].sort((a: any, b: any) => Number(a.seq) - Number(b.seq));
    }
    const table = this.t("installmentItem");
    if (!table?.findMany) return [];
    const rows =
      (await table
        .findMany({ where: { planId: plan.id }, orderBy: { seq: "asc" } })
        .catch(() => [])) ?? [];
    return [...rows].sort((a: any, b: any) => Number(a.seq) - Number(b.seq));
  }

  private serializePlan(plan: any, items: any[]) {
    const today = this.todayDhaka();
    const paidMinor = items.reduce((s: bigint, i: any) => s + BigInt(i.paidMinor ?? 0), 0n);
    const amountTotal = items.reduce((s: bigint, i: any) => s + BigInt(i.amountMinor ?? 0), 0n);
    return {
      id: plan.id,
      organizationId: plan.organizationId,
      orderId: plan.orderId,
      totalMinor: String(plan.totalMinor),
      installmentCount: plan.installmentCount,
      intervalDays: plan.intervalDays,
      startDate: plan.startDate ? new Date(plan.startDate).toISOString() : null,
      status: plan.status,
      note: plan.note ?? null,
      createdAt: plan.createdAt ? new Date(plan.createdAt).toISOString() : null,
      paidMinor: paidMinor.toString(),
      remainingMinor: (amountTotal - paidMinor).toString(),
      items: items.map((i: any) => {
        const amount = BigInt(i.amountMinor ?? 0);
        const paid = BigInt(i.paidMinor ?? 0);
        const remaining = amount - paid;
        const dueDay = this.dueDayOf(i);
        return {
          id: i.id,
          seq: i.seq,
          dueDate: i.dueDate ? new Date(i.dueDate).toISOString() : null,
          dueDay,
          amountMinor: amount.toString(),
          paidMinor: paid.toString(),
          remainingMinor: remaining.toString(),
          paidAt: i.paidAt ? new Date(i.paidAt).toISOString() : null,
          fullyPaid: remaining <= 0n,
          overdue: dueDay < today && remaining > 0n,
          dueSoonRemindStatus: i.dueSoonRemindStatus ?? null,
          overdueRemindStatus: i.overdueRemindStatus ?? null,
        };
      }),
    };
  }

  /** Failure-isolated order/customer join for list surfaces. */
  private async orderCustomerSummary(organizationId: string, orderId: string) {
    const out: { order: any; orderNumber: string | null; customerName: string | null; customerPhone: string | null } = {
      order: null, orderNumber: null, customerName: null, customerPhone: null,
    };
    try {
      const order = await this.t("order")
        .findFirst({ where: { id: orderId, organizationId } })
        .catch(() => null);
      if (!order) return out;
      out.order = order;
      out.orderNumber = order.externalNumber ?? null;
      if (order.customerId) {
        const customer = await this.t("customer")
          .findFirst({ where: { id: order.customerId, organizationId } })
          .catch(() => null);
        if (customer) {
          out.customerName =
            [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.name || null;
          out.customerPhone = customer.phone ?? null;
        }
      }
    } catch { /* joins are advisory — the row ships without them */ }
    return out;
  }

  private async safeAudit(input: Parameters<AuditService["log"]>[0]) {
    try { await this.audit?.log(input); } catch { /* audit never breaks the flow */ }
  }

  // ---------- Plan creation ----------

  async createPlan(organizationId: string, actorId: string, orderId: string, dto: CreateInstallmentPlanDto) {
    const order = await this.t("order").findFirst({
      where: { id: orderId, organizationId },
    });
    if (!order) throw new NotFoundException("Order not found in this organization");

    const count = Number(dto.installmentCount);
    if (!Number.isInteger(count) || count < 2 || count > 24) {
      throw new BadRequestException("কিস্তির সংখ্যা ২ থেকে ২৪-এর মধ্যে হতে হবে");
    }
    const intervalDays = Number(dto.intervalDays);
    if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 90) {
      throw new BadRequestException("কিস্তির ব্যবধান ১ থেকে ৯০ দিনের মধ্যে হতে হবে");
    }
    const start = dto.startDate ? new Date(dto.startDate as any) : new Date(NaN);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException("শুরুর তারিখ সঠিক নয়");
    }

    // Existing-plan check BEFORE the due check: a completed
    // plan implies due 0 (its collections ARE the payments),
    // so checking due first would make the completed/cancelled
    // refusals below unreachable.
    const existing = await this.t("installmentPlan")
      .findFirst({ where: { orderId, organizationId } })
      .catch(() => null);
    if (existing) {
      // orderId is UNIQUE — one plan per order lifetime (see the
      // class comment); the message names the actual state.
      if (existing.status === "active") {
        throw new BadRequestException("এই অর্ডারে ইতিমধ্যে একটি সক্রিয় কিস্তি প্ল্যান আছে");
      }
      if (existing.status === "completed") {
        throw new BadRequestException("এই অর্ডারের কিস্তি প্ল্যান ইতিমধ্যে সম্পূর্ণ হয়েছে");
      }
      throw new BadRequestException("এই অর্ডারে আগে একটি বাতিল কিস্তি প্ল্যান ছিল — নতুন প্ল্যান তৈরি করা যাচ্ছে না");
    }

    const due = await this.orderDue(organizationId, order);
    if (due === 0n) {
      throw new BadRequestException("এই অর্ডারে বকেয়া নেই — কিস্তি প্ল্যান দরকার নেই");
    }

    // Split: floor division; the remainder rides on item 1 so
    // Σ items == due exactly, by construction.
    const base = due / BigInt(count);
    if (base === 0n) {
      throw new BadRequestException("বকেয়া পরিমাণ কিস্তির সংখ্যার তুলনায় খুব কম");
    }
    const remainder = due - base * BigInt(count);
    const startDay = this.dhakaDayString(start);
    const itemsCreate = Array.from({ length: count }, (_, idx) => {
      const seq = idx + 1;
      return {
        seq,
        dueDate: this.dayStringToDate(this.addDaysToDayString(startDay, (seq - 1) * intervalDays)),
        amountMinor: seq === 1 ? base + remainder : base,
        paidMinor: 0n,
      };
    });

    const plan = await this.t("installmentPlan").create({
      data: {
        organizationId,
        orderId,
        totalMinor: due,
        installmentCount: count,
        intervalDays,
        startDate: this.dayStringToDate(startDay),
        status: "active",
        createdById: actorId,
        note: dto.note ?? null,
        items: { create: itemsCreate },
      },
      include: { items: true },
    });

    await this.safeAudit({
      organizationId, userId: actorId, action: "installments.plan_created",
      entityType: "InstallmentPlan", entityId: plan.id,
      metadata: { orderId, totalMinor: due.toString(), installmentCount: count, intervalDays },
    });

    const items = await this.itemsForPlan(plan);
    return { ...this.serializePlan(plan, items), orderAmountDueMinor: due.toString() };
  }

  async getPlanByOrder(organizationId: string, orderId: string) {
    const plan = await this.t("installmentPlan")
      .findFirst({ where: { orderId, organizationId }, include: { items: true } })
      .catch(() => null);
    if (!plan) throw new NotFoundException("কিস্তি প্ল্যান পাওয়া যায়নি");
    const items = await this.itemsForPlan(plan);
    // Live due recomputed from verifications — the coherence
    // surface: collections show up here immediately because
    // they ARE approved verification rows.
    const orderAmountDueMinor = await this.orderDueMinor(organizationId, orderId);
    return { ...this.serializePlan(plan, items), orderAmountDueMinor };
  }

  async listPlans(organizationId: string, q: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where: any = {
      organizationId,
      ...(q.status ? { status: q.status } : {}),
    };
    const table = this.t("installmentPlan");
    const total = table.count
      ? await table.count({ where }).catch(() => 0)
      : 0;
    const plans: any[] =
      (await table
        .findMany({
          where, orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize, take: pageSize,
          include: { items: true },
        })
        .catch(() => [])) ?? [];
    const items: any[] = [];
    for (const plan of plans) {
      const planItems = await this.itemsForPlan(plan);
      const summary = await this.orderCustomerSummary(organizationId, plan.orderId);
      items.push({
        ...this.serializePlan(plan, planItems),
        orderNumber: summary.orderNumber,
        customerName: summary.customerName,
        customerPhone: summary.customerPhone,
      });
    }
    return { total, page, pageSize, items };
  }

  // ---------- Collection ----------

  async collect(organizationId: string, actorId: string, itemId: string, dto: CollectInstallmentDto) {
    const item = await this.t("installmentItem")
      .findFirst({ where: { id: itemId } })
      .catch(() => null);
    if (!item) throw new NotFoundException("কিস্তির আইটেম পাওয়া যায়নি");
    const plan = await this.t("installmentPlan")
      .findFirst({ where: { id: item.planId, organizationId } })
      .catch(() => null);
    if (!plan) throw new NotFoundException("কিস্তির আইটেম পাওয়া যায়নি");
    if (plan.status !== "active") {
      throw new BadRequestException("প্ল্যানটি সক্রিয় নয় — সংগ্রহ করা যাচ্ছে না");
    }

    let amount: bigint;
    try { amount = BigInt(dto.amountMinor as any); } catch { amount = 0n; }
    if (amount <= 0n) {
      throw new BadRequestException("সংগ্রহের পরিমাণ শূন্যের বেশি হতে হবে");
    }
    const remaining = BigInt(item.amountMinor ?? 0) - BigInt(item.paidMinor ?? 0);
    if (remaining === 0n) {
      throw new BadRequestException("এই কিস্তিটি ইতিমধ্যে সম্পূর্ণ পরিশোধ হয়েছে");
    }
    if (amount > remaining) {
      throw new BadRequestException(
        `সংগ্রহের পরিমাণ (${amount.toString()}) এই কিস্তির বাকি (${remaining.toString()})-এর বেশি হতে পারবে না`,
      );
    }

    const order = await this.t("order")
      .findFirst({ where: { id: plan.orderId, organizationId } })
      .catch(() => null);
    if (!order) throw new NotFoundException("Order not found in this organization");

    // Duplicate reference guard — identical to EC19: an approved
    // verification anywhere in the org with the same trxId means
    // this money was already recorded.
    const table = this.t("paymentVerification");
    if (dto.reference) {
      let duplicate: any = null;
      if (table?.findFirst) {
        duplicate = await table.findFirst({
          where: { organizationId, trxId: dto.reference, status: "approved" },
        }).catch(() => null);
      } else if (table?.findMany) {
        const rows = (await table.findMany({ where: { organizationId } }).catch(() => [])) ?? [];
        duplicate = rows.find((r: any) => r.trxId === dto.reference && r.status === "approved") ?? null;
      }
      if (duplicate) {
        throw new BadRequestException("This transaction reference has already been recorded as a verified payment");
      }
    }

    // The collection IS an EC19-shape approved verification row
    // (source "installment", installmentItemId set) — the staff
    // member is the verifier, and the order due drops by
    // construction in the EC19 math.
    await table.create({
      data: {
        organizationId,
        orderId: plan.orderId,
        conversationId: order.conversationId ?? order.codConversationId ?? null,
        messageId: null,
        provider: dto.method,
        trxId: dto.reference ?? null,
        amountMinor: amount,
        expectedAmountMinor: order.totalMinor ?? null,
        verdict: "matched",
        status: "approved",
        source: "installment",
        reviewedById: actorId,
        createdById: actorId,
        modelProvider: "manual_staff",
        note: dto.note ?? null,
        installmentItemId: item.id,
      },
    });

    const newPaid = BigInt(item.paidMinor ?? 0) + amount;
    const fullyPaid = newPaid >= BigInt(item.amountMinor ?? 0);
    await this.t("installmentItem").update({
      where: { id: item.id },
      data: {
        paidMinor: newPaid,
        ...(fullyPaid ? { paidAt: new Date() } : {}),
      },
    });

    // Plan completes when EVERY item is fully paid (any order).
    const siblings = await this.itemsForPlan(plan);
    const allPaid = siblings.every((s: any) => {
      const paid = s.id === item.id ? newPaid : BigInt(s.paidMinor ?? 0);
      return paid >= BigInt(s.amountMinor ?? 0);
    });
    if (allPaid) {
      await this.t("installmentPlan")
        .update({ where: { id: plan.id }, data: { status: "completed" } })
        .catch(() => undefined);
    }

    await this.safeAudit({
      organizationId, userId: actorId, action: "installments.collected",
      entityType: "InstallmentItem", entityId: item.id,
      metadata: { planId: plan.id, orderId: plan.orderId, amountMinor: amount.toString(), method: dto.method },
    });

    return this.getPlanByOrder(organizationId, plan.orderId);
  }

  async cancelPlan(organizationId: string, actorId: string, planId: string) {
    const plan = await this.t("installmentPlan")
      .findFirst({ where: { id: planId, organizationId }, include: { items: true } })
      .catch(() => null);
    if (!plan) throw new NotFoundException("কিস্তি প্ল্যান পাওয়া যায়নি");
    if (plan.status !== "active") {
      throw new BadRequestException("প্ল্যানটি সক্রিয় নয় — বাতিল করা যাচ্ছে না");
    }
    // Items and already-collected verifications are NOT touched:
    // money already collected stays collected (the order due
    // stays reduced); only future collection/reminders stop.
    await this.t("installmentPlan").update({
      where: { id: plan.id },
      data: { status: "cancelled" },
    });
    await this.safeAudit({
      organizationId, userId: actorId, action: "installments.plan_cancelled",
      entityType: "InstallmentPlan", entityId: plan.id,
      metadata: { orderId: plan.orderId },
    });
    return this.getPlanByOrder(organizationId, plan.orderId);
  }

  // ---------- Due worklist ----------

  async dueWorklist(organizationId: string, bucket: string) {
    if (bucket !== "today" && bucket !== "overdue") {
      throw new BadRequestException("bucket হতে হবে today অথবা overdue");
    }
    const today = this.todayDhaka();
    const plans: any[] =
      (await this.t("installmentPlan")
        .findMany({ where: { organizationId, status: "active" } })
        .catch(() => [])) ?? [];
    const rows: any[] = [];
    for (const plan of plans) {
      const items = await this.itemsForPlan(plan);
      const dueItems = items.filter((i: any) => {
        const remaining = BigInt(i.amountMinor ?? 0) - BigInt(i.paidMinor ?? 0);
        if (remaining <= 0n) return false;
        const day = this.dueDayOf(i);
        return bucket === "today" ? day === today : day < today;
      });
      if (dueItems.length === 0) continue;
      const summary = await this.orderCustomerSummary(organizationId, plan.orderId);
      for (const i of dueItems) {
        const day = this.dueDayOf(i);
        rows.push({
          planId: plan.id,
          orderId: plan.orderId,
          orderNumber: summary.orderNumber,
          customerName: summary.customerName,
          customerPhone: summary.customerPhone,
          itemId: i.id,
          seq: i.seq,
          dueDay: day,
          amountMinor: String(i.amountMinor ?? 0),
          paidMinor: String(i.paidMinor ?? 0),
          remainingMinor: (BigInt(i.amountMinor ?? 0) - BigInt(i.paidMinor ?? 0)).toString(),
          daysOverdue: bucket === "overdue" ? this.dayDiff(day, today) : 0,
        });
      }
    }
    rows.sort((a, b) => (a.dueDay < b.dueDay ? -1 : a.dueDay > b.dueDay ? 1 : Number(a.seq) - Number(b.seq)));
    return { bucket, items: rows };
  }

  // ---------- Reminder sweep (installment_due_sweep) ----------

  /**
   * For every active plan, each unpaid item whose Dhaka due day
   * is overdue (day < today) or due soon (today .. today+2)
   * gets ONE SMS reminder attempt per state — the item's stamp
   * (dueSoonRemindedAt / overdueRemindedAt) is written in ALL
   * cases, sent or not: the attempt is the exactly-once unit.
   * A failed_no_channel attempt is recorded honestly, never
   * claimed sent and never silently retried (EC28 honesty).
   */
  async runDueRemindersForOrg(organizationId: string) {
    const out = { checked: 0, sent: 0, failedNoChannel: 0, failed: 0, skipped: 0 };
    const plans: any[] =
      (await this.t("installmentPlan")
        .findMany({ where: { organizationId, status: "active" } })
        .catch(() => [])) ?? [];
    const today = this.todayDhaka();
    const dueSoonLimit = this.addDaysToDayString(today, 2);
    for (const plan of plans) {
      const items = await this.itemsForPlan(plan);
      const summary = await this.orderCustomerSummary(organizationId, plan.orderId).catch(() => ({
        order: null, orderNumber: null, customerName: null, customerPhone: null,
      }));
      for (const item of items) {
        try {
          const remaining = BigInt(item.amountMinor ?? 0) - BigInt(item.paidMinor ?? 0);
          if (remaining <= 0n) continue;
          out.checked++;
          const day = this.dueDayOf(item);
          const state: "overdue" | "due_soon" | null =
            day < today ? "overdue" : day <= dueSoonLimit ? "due_soon" : null;
          if (!state) { out.skipped++; continue; }
          const stampAt = state === "overdue" ? item.overdueRemindedAt : item.dueSoonRemindedAt;
          if (stampAt) { out.skipped++; continue; }

          const phone = summary.customerPhone ? String(summary.customerPhone) : null;
          let status: "sent" | "failed_no_channel" | "failed";
          let reason: string | undefined;
          if (!phone) {
            status = "failed_no_channel";
            reason = "no customer phone";
          } else if (!this.shopAccounts) {
            status = "failed_no_channel";
            reason = "no SMS sender configured";
          } else {
            const remainingMajor = this.formatMajor(remaining);
            const text =
              state === "due_soon"
                ? `আপনার কিস্তির ${item.seq} নম্বর পেমেন্টের তারিখ ${day} — পরিমাণ ৳${remainingMajor}। অনুগ্রহ করে সময়মতো পরিশোধ করুন।`
                : `আপনার কিস্তির ${item.seq} নম্বর পেমেন্টের তারিখ ${day} পার হয়ে গেছে — বকেয়া ৳${remainingMajor}। অনুগ্রহ করে দ্রুত পরিশোধ করুন।`;
            const send = await this.shopAccounts
              .sendShopSms(organizationId, phone, text, `installment-${item.id}-${state}`)
              .catch((e) => ({
                sent: false as const,
                notConfigured: false,
                reason: e instanceof Error ? e.message : String(e),
              }));
            if (send.sent) {
              status = "sent";
            } else if ((send as any).notConfigured) {
              status = "failed_no_channel";
              reason = (send as any).reason;
            } else {
              status = "failed";
              reason = (send as any).reason;
            }
          }

          await this.t("installmentItem")
            .update({
              where: { id: item.id },
              data:
                state === "overdue"
                  ? { overdueRemindedAt: new Date(), overdueRemindStatus: status }
                  : { dueSoonRemindedAt: new Date(), dueSoonRemindStatus: status },
            })
            .catch(() => undefined);
          if (status === "sent") out.sent++;
          else if (status === "failed_no_channel") out.failedNoChannel++;
          else out.failed++;
          await this.safeAudit({
            organizationId, action: "installments.reminder",
            entityType: "InstallmentItem", entityId: item.id,
            metadata: { state, status, ...(reason ? { reason } : {}) },
          });
        } catch (e) {
          out.failed++;
          this.logger.warn(
            `installment reminder failed for item ${item?.id}: ${e instanceof Error ? e.message : "unknown"}`,
          );
        }
      }
    }
    return out;
  }

  // ---------- Tracking summary (coordinator-wired) ----------

  /**
   * Compact plan summary for the order tracking payload.
   * ACTIVE plan only — anything else is null. Public and
   * side-effect free.
   */
  async summaryForOrder(organizationId: string, orderId: string) {
    const plan = await this.t("installmentPlan")
      .findFirst({ where: { orderId, organizationId, status: "active" }, include: { items: true } })
      .catch(() => null);
    if (!plan) return null;
    const items = await this.itemsForPlan(plan);
    const paidInstallments = items.filter(
      (i: any) => BigInt(i.paidMinor ?? 0) >= BigInt(i.amountMinor ?? 0),
    ).length;
    const next = items.find((i: any) => BigInt(i.amountMinor ?? 0) - BigInt(i.paidMinor ?? 0) > 0n) ?? null;
    const remainingMinor = items.reduce(
      (s: bigint, i: any) => s + (BigInt(i.amountMinor ?? 0) - BigInt(i.paidMinor ?? 0)),
      0n,
    );
    return {
      totalInstallments: plan.installmentCount,
      paidInstallments,
      nextDueDate: next ? this.dueDayOf(next) : null,
      nextDueAmountMinor: next
        ? (BigInt(next.amountMinor ?? 0) - BigInt(next.paidMinor ?? 0)).toString()
        : null,
      remainingMinor: remainingMinor.toString(),
    };
  }
}
