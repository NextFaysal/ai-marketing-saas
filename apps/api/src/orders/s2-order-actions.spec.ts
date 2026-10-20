import "reflect-metadata";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { ROLES_KEY } from "../common/decorators";

/**
 * Sales & Data S2 — Order Actions (PATCH /orders/:orderId).
 * Positional construction with fake prisma, same style as the
 * M65 manual-orders spec. Inventory + Events are stubs here;
 * the real-module-graph wiring is proven separately in
 * s2-order-actions.di.spec.ts (the M65 DI insurance).
 */
describe("S2 OrdersService.updateOrder", () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const row: any = {
      id: "o1", organizationId: "org-1", status: "processing",
      totalMinor: 100000n, refundedMinor: 0n, internalNote: null,
      items: [], customer: null, ...overrides,
    };
    const prisma: any = {
      order: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id && where.id !== row.id) return null;
          if (where.organizationId && where.organizationId !== row.organizationId) return null;
          return { ...row };
        }),
        update: jest.fn(async ({ data }: any) => { Object.assign(row, data); return { ...row }; }),
      },
    };
    const audit = { log: jest.fn(async () => undefined) };
    const inventory = { applyOrderRestore: jest.fn(async () => ({ restored: 1, skipped: 0 })) };
    const emitted: { event: string; payload: any }[] = [];
    const events = { emit: jest.fn((event: string, payload: any) => { emitted.push({ event, payload }); }), on: jest.fn() };
    const svc = new OrdersService(prisma, undefined, undefined, audit as any, inventory as any, events as any);
    return { svc, prisma, audit, inventory, events, emitted, row };
  }

  it("rejects an empty PATCH with the Bengali nothing-sent 400", async () => {
    const { svc } = setup();
    await expect(svc.updateOrder("org-1", "u1", "o1", {})).rejects.toThrow(
      "কিছুই পাঠানো হয়নি — status, refund অথবা internalNote-এর যেকোনো একটি পাঠান",
    );
  });

  it("cross-org order is a 404 with the getOne message", async () => {
    const { svc } = setup();
    await expect(svc.updateOrder("org-2", "u1", "o1", { status: "completed" }))
      .rejects.toMatchObject({ code: "commerce.orderNotFoundInOrg" });
    await expect(svc.updateOrder("org-1", "u1", "missing", { status: "completed" }))
      .rejects.toMatchObject({ code: "commerce.orderNotFoundInOrg" });
  });

  describe("transition table", () => {
    const allowed: [string, string][] = [
      ["pending", "completed"], ["pending", "cancelled"], ["pending", "returned"],
      ["on-hold", "processing"], ["on-hold", "failed"],
      ["processing", "completed"], ["processing", "on-hold"], ["processing", "refunded"],
      ["completed", "refunded"], ["completed", "returned"],
      ["cancelled", "pending"], ["cancelled", "on-hold"], ["cancelled", "processing"],
      ["failed", "pending"], ["failed", "processing"],
    ];
    it.each(allowed)("allows %s -> %s", async (from, to) => {
      const { svc, row } = setup({ status: from });
      const out = await svc.updateOrder("org-1", "u1", "o1", { status: to });
      expect(row.status).toBe(to);
      expect(out.status).toBe(to);
    });

    const forbidden: [string, string][] = [
      ["completed", "pending"], ["completed", "cancelled"], ["completed", "processing"], ["completed", "failed"],
      ["cancelled", "completed"], ["cancelled", "refunded"], ["cancelled", "returned"],
      ["failed", "completed"], ["failed", "refunded"],
      ["refunded", "pending"], ["refunded", "completed"],
      ["returned", "processing"], ["returned", "completed"],
    ];
    it.each(forbidden)("forbids %s -> %s with the Bengali 400 naming both states", async (from, to) => {
      const { svc, prisma } = setup({ status: from });
      await expect(svc.updateOrder("org-1", "u1", "o1", { status: to }))
        .rejects.toThrow(`অর্ডারের অবস্থা "${from}" থেকে "${to}"-তে নেওয়া যাবে না`);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it("same -> same is a no-op success: no write, no events, no restore, no audit", async () => {
      const { svc, prisma, emitted, inventory, audit } = setup({ status: "processing" });
      const out = await svc.updateOrder("org-1", "u1", "o1", { status: "processing" });
      expect(out.status).toBe("processing");
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(emitted).toHaveLength(0);
      expect(inventory.applyOrderRestore).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it("legacy status outside the vocabulary may move to any vocabulary status (escape hatch)", async () => {
      const { svc, row, emitted } = setup({ status: "checkout-draft" });
      await svc.updateOrder("org-1", "u1", "o1", { status: "completed" });
      expect(row.status).toBe("completed");
      expect(emitted.map((e) => e.event)).toContain("order.delivered");
    });
  });

  describe("status side effects", () => {
    it("cancel restores stock exactly once with order_cancelled + emits status_changed + audits", async () => {
      const { svc, inventory, emitted, audit } = setup({ status: "processing" });
      await svc.updateOrder("org-1", "u1", "o1", { status: "cancelled" });
      expect(inventory.applyOrderRestore).toHaveBeenCalledTimes(1);
      expect(inventory.applyOrderRestore).toHaveBeenCalledWith("org-1", "o1", "order_cancelled");
      expect(emitted).toEqual([
        { event: "order.status_changed", payload: { organizationId: "org-1", context: { orderId: "o1", from: "processing", to: "cancelled" } } },
      ]);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: "orders.status_changed", metadata: { from: "processing", to: "cancelled" },
      }));
    });

    it("failed also restores with order_cancelled", async () => {
      const { svc, inventory } = setup({ status: "pending" });
      await svc.updateOrder("org-1", "u1", "o1", { status: "failed" });
      expect(inventory.applyOrderRestore).toHaveBeenCalledWith("org-1", "o1", "order_cancelled");
    });

    it("returned restores with order_returned", async () => {
      const { svc, inventory } = setup({ status: "completed" });
      await svc.updateOrder("org-1", "u1", "o1", { status: "returned" });
      expect(inventory.applyOrderRestore).toHaveBeenCalledWith("org-1", "o1", "order_returned");
    });

    it("completed emits order.delivered (workflow/conversion parity) and never restores", async () => {
      const { svc, inventory, emitted } = setup({ status: "processing" });
      await svc.updateOrder("org-1", "u1", "o1", { status: "completed" });
      expect(inventory.applyOrderRestore).not.toHaveBeenCalled();
      expect(emitted.map((e) => e.event)).toEqual(["order.delivered", "order.status_changed"]);
      expect(emitted[0].payload).toEqual({ organizationId: "org-1", context: { orderId: "o1" } });
    });

    it("a throwing inventory restore never breaks the status change", async () => {
      const { svc, inventory, row } = setup({ status: "processing" });
      inventory.applyOrderRestore.mockRejectedValueOnce(new Error("boom"));
      const out = await svc.updateOrder("org-1", "u1", "o1", { status: "cancelled" });
      expect(row.status).toBe("cancelled");
      expect(out.status).toBe("cancelled");
    });
  });

  describe("refund", () => {
    it("partial refund records money only: status untouched, no restore, refund event + audit", async () => {
      const { svc, row, inventory, emitted, audit } = setup({ status: "processing" });
      const out = await svc.updateOrder("org-1", "u1", "o1", { refund: { amountMinor: "30000", reason: "আংশিক ফেরত" } });
      expect(row.refundedMinor).toBe(30000n);
      expect(out.refundedMinor).toBe("30000");
      expect(row.status).toBe("processing");
      expect(inventory.applyOrderRestore).not.toHaveBeenCalled();
      expect(emitted).toEqual([
        { event: "order.refunded", payload: { organizationId: "org-1", context: { orderId: "o1", amountMinor: "30000", cumulativeRefundedMinor: "30000" } } },
      ]);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: "orders.refund_recorded",
        metadata: { amountMinor: "30000", cumulativeRefundedMinor: "30000", reason: "আংশিক ফেরত", autoStatus: null },
      }));
    });

    it("cumulative refunds are capped at the order total", async () => {
      const { svc, prisma } = setup({ refundedMinor: 70000n });
      await expect(svc.updateOrder("org-1", "u1", "o1", { refund: { amountMinor: "30001" } }))
        .rejects.toThrow("মোট refund অর্ডারের মোট মূল্যের বেশি হতে পারবে না");
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it("rejects non-numeric and zero refund amounts", async () => {
      const { svc } = setup();
      await expect(svc.updateOrder("org-1", "u1", "o1", { refund: { amountMinor: "abc" } }))
        .rejects.toThrow("refund-এর পরিমাণ সঠিক সংখ্যায় পাঠান (পয়সায়)");
      await expect(svc.updateOrder("org-1", "u1", "o1", { refund: { amountMinor: "0" } }))
        .rejects.toThrow("refund-এর পরিমাণ সঠিক সংখ্যায় পাঠান (পয়সায়)");
    });

    it("full refund auto-moves an open order to refunded (bypassing the table), with status_changed event", async () => {
      const { svc, row, emitted, audit } = setup({ status: "processing", refundedMinor: 70000n });
      await svc.updateOrder("org-1", "u1", "o1", { refund: { amountMinor: "30000" } });
      expect(row.status).toBe("refunded");
      expect(emitted.map((e) => e.event)).toEqual(["order.status_changed", "order.refunded"]);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: "orders.refund_recorded", metadata: expect.objectContaining({ autoStatus: "refunded" }),
      }));
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: "orders.status_changed", metadata: { from: "processing", to: "refunded" },
      }));
    });

    it("full refund from completed keeps status completed (terminal exclusion)", async () => {
      const { svc, row, emitted } = setup({ status: "completed" });
      await svc.updateOrder("org-1", "u1", "o1", { refund: { amountMinor: "100000" } });
      expect(row.status).toBe("completed");
      expect(emitted.map((e) => e.event)).toEqual(["order.refunded"]);
    });

    it("full refund on a cancelled order does not resurrect it and triggers no second restore", async () => {
      const { svc, row, inventory } = setup({ status: "cancelled" });
      await svc.updateOrder("org-1", "u1", "o1", { refund: { amountMinor: "100000" } });
      expect(row.status).toBe("cancelled");
      expect(inventory.applyOrderRestore).not.toHaveBeenCalled();
    });

    it("an explicit status wins over the full-refund auto-status", async () => {
      const { svc, row, audit } = setup({ status: "processing" });
      await svc.updateOrder("org-1", "u1", "o1", { status: "completed", refund: { amountMinor: "100000" } });
      expect(row.status).toBe("completed");
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: "orders.refund_recorded", metadata: expect.objectContaining({ autoStatus: null }),
      }));
    });

    it("refund alone never restores stock even when it completes the total", async () => {
      const { svc, inventory } = setup({ status: "completed" });
      await svc.updateOrder("org-1", "u1", "o1", { refund: { amountMinor: "100000" } });
      expect(inventory.applyOrderRestore).not.toHaveBeenCalled();
    });
  });

  describe("internal note", () => {
    it("sets the note trimmed, in a single update, and audits without the content", async () => {
      const { svc, row, audit } = setup();
      const out = await svc.updateOrder("org-1", "u1", "o1", { internalNote: "  কাস্টমার ফোনে নিশ্চিত করেছেন  " });
      expect(row.internalNote).toBe("কাস্টমার ফোনে নিশ্চিত করেছেন");
      expect(out.internalNote).toBe("কাস্টমার ফোনে নিশ্চিত করেছেন");
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: "orders.internal_note_updated", metadata: { cleared: false },
      }));
      const metadata = (audit.log.mock.calls[0] as any[])[0].metadata;
      expect(JSON.stringify(metadata)).not.toContain("কাস্টমার");
    });

    it("explicit null clears the note", async () => {
      const { svc, row, audit } = setup({ internalNote: "আগের নোট" });
      await svc.updateOrder("org-1", "u1", "o1", { internalNote: null });
      expect(row.internalNote).toBeNull();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: "orders.internal_note_updated", metadata: { cleared: true },
      }));
    });

    it("whitespace-only note stores null", async () => {
      const { svc, row } = setup({ internalNote: "x" });
      await svc.updateOrder("org-1", "u1", "o1", { internalNote: "   " });
      expect(row.internalNote).toBeNull();
    });

    it("absent internalNote key leaves the note untouched (no field in the update)", async () => {
      const { svc, prisma, row } = setup({ internalNote: "আগের নোট" });
      await svc.updateOrder("org-1", "u1", "o1", { status: "completed" });
      expect(row.internalNote).toBe("আগের নোট");
      const updateArg = (prisma.order.update.mock.calls[0] as any[])[0];
      expect(updateArg.data).not.toHaveProperty("internalNote");
    });
  });

  it("DTO: explicit null survives class-transformer so clear is distinguishable from untouched", async () => {
    const { plainToInstance } = await import("class-transformer");
    const { UpdateOrderDto } = await import("./orders.dto");
    const cleared = plainToInstance(UpdateOrderDto, { internalNote: null });
    expect("internalNote" in cleared).toBe(true);
    expect(cleared.internalNote).toBeNull();
    expect(cleared.internalNote !== undefined).toBe(true);
    const untouched = plainToInstance(UpdateOrderDto, {});
    expect(untouched.internalNote).toBeUndefined();
  });

  it("controller PATCH route carries the write-role metadata", () => {
    const roles = Reflect.getMetadata(ROLES_KEY, OrdersController.prototype.update);
    expect(roles).toEqual(["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"]);
  });
});
