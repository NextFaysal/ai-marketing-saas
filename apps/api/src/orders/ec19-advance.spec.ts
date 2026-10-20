import "reflect-metadata";
import { ApiException } from "../i18n";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { ROLES_KEY } from "../common/decorators";

/**
 * EC19 — staff-recorded order advances backed by
 * PaymentVerification rows (status "approved", source
 * "manual_advance"). Fake prisma in the s2-order-actions style.
 */
describe("EC19 OrdersService.recordAdvanceVerification", () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const orderRow: any = {
      id: "o1", organizationId: "org-1", status: "processing",
      totalMinor: 100000n, refundedMinor: 0n, internalNote: null,
      conversationId: "conv-1", codConversationId: null,
      items: [], customer: null, deliverySlotId: null, deliveryDate: null,
      ...overrides,
    };
    let pvSeq = 0;
    const pvRows: any[] = [];
    const match = (row: any, where: any) =>
      Object.entries(where ?? {}).every(([k, v]) => v === undefined || row[k] === v);
    const prisma: any = {
      order: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id && where.id !== orderRow.id) return null;
          if (where.organizationId && where.organizationId !== orderRow.organizationId) return null;
          return { ...orderRow };
        }),
        update: jest.fn(async ({ data }: any) => { Object.assign(orderRow, data); return { ...orderRow }; }),
      },
      paymentVerification: {
        findFirst: jest.fn(async ({ where }: any) => pvRows.find((r) => match(r, where)) ?? null),
        findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
          let rows = pvRows.filter((r) => match(r, where));
          if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return rows;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `pv-${++pvSeq}`, createdAt: new Date(Date.now() + pvSeq), ...data };
          pvRows.push(row);
          return row;
        }),
      },
    };
    const audit = { log: jest.fn(async () => undefined) };
    const svc = new OrdersService(prisma, undefined, undefined, audit as any, undefined, undefined);
    return { svc, prisma, audit, pvRows, orderRow };
  }

  it("records an approved manual_advance row and reduces the amount due on the order detail", async () => {
    const { svc, pvRows } = setup();
    const out: any = await svc.recordAdvanceVerification("org-1", "staff-1", "o1", {
      amountMinor: "30000", method: "bkash", reference: "TRX123", note: "ফোনে যাচাই করা হয়েছে",
    });
    expect(pvRows).toHaveLength(1);
    expect(pvRows[0]).toMatchObject({
      organizationId: "org-1", orderId: "o1", conversationId: "conv-1", messageId: null,
      provider: "bkash", trxId: "TRX123", verdict: "matched", status: "approved",
      source: "manual_advance", reviewedById: "staff-1", createdById: "staff-1",
      modelProvider: "manual_staff", note: "ফোনে যাচাই করা হয়েছে",
    });
    expect(pvRows[0].amountMinor).toBe(30000n);
    expect(pvRows[0].expectedAmountMinor).toBe(100000n);
    expect(out.advancePaidMinor).toBe("30000");
    expect(out.amountDueMinor).toBe("70000");
    expect(out.paymentVerifications).toHaveLength(1);
    expect(out.paymentVerifications[0].amountMinor).toBe("30000");
    expect(out.paymentVerifications[0].expectedAmountMinor).toBe("100000");
  });

  it("a second partial advance accumulates", async () => {
    const { svc } = setup();
    await svc.recordAdvanceVerification("org-1", "staff-1", "o1", { amountMinor: "30000", method: "bkash" });
    const out: any = await svc.recordAdvanceVerification("org-1", "staff-1", "o1", { amountMinor: "20000", method: "nagad" });
    expect(out.advancePaidMinor).toBe("50000");
    expect(out.amountDueMinor).toBe("50000");
    expect(out.paymentVerifications).toHaveLength(2);
  });

  it("an advance above the amount still due is rejected, naming the due amount, and writes nothing", async () => {
    const { svc, pvRows, prisma } = setup();
    await svc.recordAdvanceVerification("org-1", "staff-1", "o1", { amountMinor: "30000", method: "cash" });
    await expect(
      svc.recordAdvanceVerification("org-1", "staff-1", "o1", { amountMinor: "70001", method: "cash" }),
    ).rejects.toThrow(/70001.*70000|70000/);
    await expect(
      svc.recordAdvanceVerification("org-1", "staff-1", "o1", { amountMinor: "70001", method: "cash" }),
    ).rejects.toBeInstanceOf(ApiException);
    expect(pvRows).toHaveLength(1);
    expect(prisma.paymentVerification.create).toHaveBeenCalledTimes(1);
  });

  it("a foreign-org order is a 404", async () => {
    const { svc } = setup();
    await expect(
      svc.recordAdvanceVerification("org-2", "staff-1", "o1", { amountMinor: "1000", method: "cash" }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.recordAdvanceVerification("org-1", "staff-1", "missing", { amountMinor: "1000", method: "cash" }),
    ).rejects.toMatchObject({ code: "commerce.orderNotFoundInOrg" });
  });

  it("a duplicate approved transaction reference is rejected org-wide", async () => {
    const { svc, pvRows } = setup();
    await svc.recordAdvanceVerification("org-1", "staff-1", "o1", {
      amountMinor: "10000", method: "bkash", reference: "TRXDUP",
    });
    await expect(
      svc.recordAdvanceVerification("org-1", "staff-2", "o1", {
        amountMinor: "5000", method: "bkash", reference: "TRXDUP",
      }),
    ).rejects.toMatchObject({ code: "orders.transactionAlreadyRecorded" });
    expect(pvRows).toHaveLength(1);
  });

  it("writes the audit entry with amount + method metadata (never the note)", async () => {
    const { svc, audit } = setup();
    await svc.recordAdvanceVerification("org-1", "staff-9", "o1", {
      amountMinor: "15000", method: "rocket", note: "গোপন নোট",
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1", userId: "staff-9",
      action: "orders.advance_verification_recorded",
      entityType: "PaymentVerification",
      entityId: expect.any(String),
      metadata: { orderId: "o1", amountMinor: "15000", method: "rocket" },
    }));
  });

  it("rejects non-numeric and non-positive amounts", async () => {
    const { svc } = setup();
    await expect(svc.recordAdvanceVerification("org-1", "s", "o1", { amountMinor: "abc", method: "cash" }))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.recordAdvanceVerification("org-1", "s", "o1", { amountMinor: "0", method: "cash" }))
      .rejects.toBeInstanceOf(ApiException);
    await expect(svc.recordAdvanceVerification("org-1", "s", "o1", { amountMinor: "-5", method: "cash" }))
      .rejects.toBeInstanceOf(ApiException);
  });

  it("getOne with no verifications returns advancePaidMinor 0 and the full amount due", async () => {
    const { svc } = setup();
    const out: any = await svc.getOne("org-1", "o1");
    expect(out.paymentVerifications).toEqual([]);
    expect(out.advancePaidMinor).toBe("0");
    expect(out.amountDueMinor).toBe("100000");
    expect(out.deliverySlot).toBeNull();
  });

  it("legacy rows (pending inbox extractions, note-only orders) never count as paid advances", async () => {
    const { svc, pvRows } = setup({ internalNote: "কাস্টমার বলেছেন advance পাঠিয়েছেন" });
    pvRows.push({
      id: "pv-legacy", organizationId: "org-1", orderId: "o1", conversationId: "conv-1",
      messageId: "m-1", provider: "bkash", trxId: "LEGACY1", amountMinor: 40000n,
      expectedAmountMinor: 100000n, verdict: "matched", status: "pending", source: null,
      reviewedById: null, createdById: null, modelProvider: "dev", note: null,
      createdAt: new Date(),
    });
    const out: any = await svc.getOne("org-1", "o1");
    expect(out.advancePaidMinor).toBe("0");
    expect(out.amountDueMinor).toBe("100000");
    expect(out.paymentVerifications).toHaveLength(1);
    // A pending row's trxId does not block a staff verification of it.
    const after: any = await svc.recordAdvanceVerification("org-1", "staff-1", "o1", {
      amountMinor: "40000", method: "bkash", reference: "LEGACY1",
    });
    expect(after.advancePaidMinor).toBe("40000");
  });

  it("controller route carries the staff write roles", () => {
    const roles = Reflect.getMetadata(ROLES_KEY, OrdersController.prototype.recordAdvanceVerification);
    expect(roles).toEqual(["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"]);
  });
});
