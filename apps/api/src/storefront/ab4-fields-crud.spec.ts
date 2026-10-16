import "reflect-metadata";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CheckoutFieldsService } from "./checkout-fields.service";
import { CheckoutFieldsController } from "./checkout-fields.controller";
import { OrdersService } from "../orders/orders.service";
import { ROLES_KEY } from "../common/decorators";

/**
 * AB4 (AX5b) — staff CRUD for CheckoutFieldDef + the order-side
 * rendering (getOne checkoutFieldDefs / deposit block, CSV
 * field:<key> columns). Fake prisma in the neighbouring spec
 * style (equality-where tables, explicit createdAt for ordering).
 */

function matchWhere(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => v === undefined || row[k] === v);
}

function makeFieldTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `field-${++seq}`, createdAt: new Date(1700000000000 + seq * 1000), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    }),
    delete: jest.fn(async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    }),
  };
}

function setup() {
  const checkoutFieldDef = makeFieldTable();
  const prisma: any = { checkoutFieldDef };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new CheckoutFieldsService(prisma, audit as any);
  return { svc, prisma, checkoutFieldDef, audit };
}

const SELECT_DTO = {
  key: "delivery_area", label: "ডেলিভারি এলাকা", type: "select",
  options: ["ঢাকার ভিতরে", " ঢাকার বাইরে "], required: true, appliesTo: "shop", sortOrder: 2,
};

describe("AB4 CheckoutFieldsService.create", () => {
  it("creates a select field: options trimmed, defaults applied, audited", async () => {
    const { svc, audit, checkoutFieldDef } = setup();
    const out: any = await svc.create("org-1", "staff-1", { ...SELECT_DTO });
    expect(out.field).toMatchObject({
      key: "delivery_area", label: "ডেলিভারি এলাকা", type: "select",
      options: ["ঢাকার ভিতরে", "ঢাকার বাইরে"], required: true, appliesTo: "shop", sortOrder: 2,
      active: true, createdById: "staff-1",
    });
    expect(checkoutFieldDef.rows[0].options).toEqual(["ঢাকার ভিতরে", "ঢাকার বাইরে"]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1", userId: "staff-1", action: "checkout_field.created",
      entityType: "CheckoutFieldDef", entityId: out.field.id,
    }));
  });

  it("defaults appliesTo to 'all', required to false, sortOrder to 0; non-select stores options null", async () => {
    const { svc, checkoutFieldDef } = setup();
    const out: any = await svc.create("org-1", "staff-1", {
      key: "note_text", label: "নোট", type: "text", options: ["উপেক্ষিত"],
    } as any);
    expect(out.field).toMatchObject({ appliesTo: "all", required: false, sortOrder: 0, options: [] });
    expect(checkoutFieldDef.rows[0].options).toBeNull();
  });

  it.each(["Abc", "a", "_abc", "a b", "a-b", "বাংলা", "a".repeat(41), ""])(
    "rejects a bad key (%j) with a Bengali 400",
    async (key) => {
      const { svc, checkoutFieldDef } = setup();
      await expect(svc.create("org-1", "s", { key, label: "লেবেল", type: "text" }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(checkoutFieldDef.rows).toHaveLength(0);
    },
  );

  it("rejects a duplicate key in the same org with the verbatim message — but another org may reuse it", async () => {
    const { svc } = setup();
    await svc.create("org-1", "s", { ...SELECT_DTO });
    await expect(svc.create("org-1", "s", { ...SELECT_DTO }))
      .rejects.toThrow("এই key দিয়ে ইতিমধ্যে একটি ফিল্ড আছে");
    const other: any = await svc.create("org-2", "s", { ...SELECT_DTO });
    expect(other.field.key).toBe("delivery_area");
  });

  it("select without valid options → 400 (missing, empty, blank, duplicate, >30, >80 chars)", async () => {
    const { svc } = setup();
    const base = { key: "sel_field", label: "বেছে নিন", type: "select" };
    await expect(svc.create("org-1", "s", { ...base })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "s", { ...base, options: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "s", { ...base, options: ["  "] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "s", { ...base, options: ["এক", " এক "] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "s", { ...base, options: Array.from({ length: 31 }, (_, i) => `opt-${i}`) }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "s", { ...base, options: ["x".repeat(81)] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a short/long label, an unknown type, an unknown surface and a non-integer sortOrder", async () => {
    const { svc } = setup();
    const base = { key: "some_field", label: "লেবেল", type: "text" };
    await expect(svc.create("org-1", "s", { ...base, label: " ক " })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "s", { ...base, label: "x".repeat(81) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "s", { ...base, type: "radio" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "s", { ...base, appliesTo: "everywhere" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create("org-1", "s", { ...base, sortOrder: 1.5 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("AB4 CheckoutFieldsService list / update / remove", () => {
  it("list returns only the org's defs, sortOrder asc then createdAt asc, options as string[]", async () => {
    const { svc, checkoutFieldDef } = setup();
    checkoutFieldDef.rows.push(
      { id: "f-b", organizationId: "org-1", key: "b_key", label: "বি", type: "text", options: null, required: false, appliesTo: "all", sortOrder: 1, active: true, createdById: null, createdAt: new Date(2000), updatedAt: new Date(2000) },
      { id: "f-a", organizationId: "org-1", key: "a_key", label: "এ", type: "select", options: ["এক"], required: true, appliesTo: "shop", sortOrder: 1, active: true, createdById: null, createdAt: new Date(1000), updatedAt: new Date(1000) },
      { id: "f-c", organizationId: "org-1", key: "c_key", label: "সি", type: "checkbox", options: null, required: false, appliesTo: "all", sortOrder: 0, active: false, createdById: null, createdAt: new Date(3000), updatedAt: new Date(3000) },
      { id: "f-foreign", organizationId: "org-2", key: "x_key", label: "এক্স", type: "text", options: null, required: false, appliesTo: "all", sortOrder: 0, active: true, createdById: null, createdAt: new Date(500), updatedAt: new Date(500) },
    );
    const out: any = await svc.list("org-1");
    expect(out.fields.map((f: any) => f.id)).toEqual(["f-c", "f-a", "f-b"]);
    expect(out.fields[1].options).toEqual(["এক"]);
    expect(out.fields[0].options).toEqual([]);
    expect(out.fields[0].active).toBe(false);
  });

  it("update edits label/type/options/required/surface/order/active and audits", async () => {
    const { svc, audit } = setup();
    const created: any = await svc.create("org-1", "s", { key: "note_field", label: "নোট", type: "text" });
    const id = created.field.id;
    const out: any = await svc.update("org-1", "staff-2", id, {
      label: "বিশেষ নোট", type: "select", options: ["হ্যাঁ", "না"], required: true,
      appliesTo: "landing", sortOrder: 5, active: false,
    });
    expect(out.field).toMatchObject({
      key: "note_field", label: "বিশেষ নোট", type: "select", options: ["হ্যাঁ", "না"],
      required: true, appliesTo: "landing", sortOrder: 5, active: false,
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "checkout_field.updated", entityType: "CheckoutFieldDef", entityId: id, userId: "staff-2",
    }));
  });

  it("update REFUSES a key change (400) but accepts the same key as a no-op", async () => {
    const { svc } = setup();
    const created: any = await svc.create("org-1", "s", { key: "note_field", label: "নোট", type: "text" });
    await expect(svc.update("org-1", "s", created.field.id, { key: "other_key" }))
      .rejects.toBeInstanceOf(BadRequestException);
    const ok: any = await svc.update("org-1", "s", created.field.id, { key: "note_field", label: "নতুন লেবেল" });
    expect(ok.field.label).toBe("নতুন লেবেল");
  });

  it("a type change TO select re-validates options (stored none → 400; given → ok); changing AWAY clears them", async () => {
    const { svc, checkoutFieldDef } = setup();
    const created: any = await svc.create("org-1", "s", { key: "note_field", label: "নোট", type: "text" });
    const id = created.field.id;
    await expect(svc.update("org-1", "s", id, { type: "select" })).rejects.toBeInstanceOf(BadRequestException);
    const asSelect: any = await svc.update("org-1", "s", id, { type: "select", options: ["এক"] });
    expect(asSelect.field.options).toEqual(["এক"]);
    const back: any = await svc.update("org-1", "s", id, { type: "textarea" });
    expect(back.field.options).toEqual([]);
    expect(checkoutFieldDef.rows[0].options).toBeNull();
  });

  it("foreign ids are 404 for update and remove; a missing id is 404 too", async () => {
    const { svc } = setup();
    const created: any = await svc.create("org-1", "s", { key: "note_field", label: "নোট", type: "text" });
    const id = created.field.id;
    await expect(svc.update("org-2", "s", id, { label: "হ্যাক" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove("org-2", "s", id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update("org-1", "s", "missing", { label: "হ্যাক" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove("org-1", "s", "missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("remove hard-deletes the def and audits; the org list is then empty", async () => {
    const { svc, audit, checkoutFieldDef } = setup();
    const created: any = await svc.create("org-1", "s", { key: "note_field", label: "নোট", type: "text" });
    const out: any = await svc.remove("org-1", "staff-3", created.field.id);
    expect(out).toEqual({ deleted: true, fieldId: created.field.id });
    expect(checkoutFieldDef.rows).toHaveLength(0);
    expect((await svc.list("org-1")).fields).toEqual([]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "checkout_field.deleted", entityType: "CheckoutFieldDef", userId: "staff-3",
    }));
  });

  it("controller write routes carry the staff WRITE roles", () => {
    for (const method of ["create", "update", "remove"] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, CheckoutFieldsController.prototype[method]))
        .toEqual(["OWNER", "ADMIN", "MARKETING_MANAGER"]);
    }
    expect(Reflect.getMetadata(ROLES_KEY, CheckoutFieldsController.prototype.list)).toBeUndefined();
  });
});

/* ---------- Order-side rendering (getOne + CSV) ---------- */

function ordersSetup(opts: { order?: any; verifications?: any[]; defs?: any[] } = {}) {
  const orderRow: any = {
    id: "o1", organizationId: "org-1", status: "processing",
    totalMinor: 100000n, refundedMinor: 0n, subtotalMinor: 100000n, shippingMinor: 0n,
    discountMinor: 0n, taxMinor: 0n, items: [], customer: null, store: null,
    deliverySlotId: null, deliveryDate: null, pickupPointId: null,
    checkoutFields: null, depositDueMinor: null,
    ...(opts.order ?? {}),
  };
  const pvRows = opts.verifications ?? [];
  const checkoutFieldDef = makeFieldTable();
  for (const d of opts.defs ?? []) checkoutFieldDef.rows.push(d);
  const prisma: any = {
    order: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === orderRow.id && where.organizationId === orderRow.organizationId ? { ...orderRow } : null),
      findMany: jest.fn(async () => [{ ...orderRow }]),
    },
    paymentVerification: {
      findMany: jest.fn(async ({ where }: any = {}) => pvRows.filter((r) => matchWhere(r, where))),
    },
    checkoutFieldDef,
    // stockAllocation intentionally absent: allocations read as [].
  };
  const svc = new OrdersService(prisma);
  return { svc, prisma, orderRow, checkoutFieldDef };
}

const pv = (over: Record<string, any>) => ({
  id: `pv-${Math.random()}`, organizationId: "org-1", orderId: "o1",
  amountMinor: 0n, expectedAmountMinor: null, status: "approved", source: "gateway_deposit",
  createdAt: new Date(), ...over,
});

describe("AB4 OrdersService.getOne — checkoutFieldDefs + deposit", () => {
  it("labels present answer keys from the org's defs; a deleted def falls back to its key", async () => {
    const { svc } = ordersSetup({
      order: { checkoutFields: { delivery_area: "ঢাকার ভিতরে", gone_key: true } },
      defs: [
        { id: "f1", organizationId: "org-1", key: "delivery_area", label: "ডেলিভারি এলাকা", type: "select", options: [], required: true, appliesTo: "all", sortOrder: 1, active: true, createdAt: new Date(1000) },
      ],
    });
    const out: any = await svc.getOne("org-1", "o1");
    expect(out.checkoutFields).toEqual({ delivery_area: "ঢাকার ভিতরে", gone_key: true });
    expect(out.checkoutFieldDefs).toEqual([
      { key: "delivery_area", label: "ডেলিভারি এলাকা" },
      { key: "gone_key", label: "gone_key" },
    ]);
    expect(out.deposit).toBeNull();
    expect(out.depositDueMinor).toBeNull();
  });

  it("no answers → empty checkoutFieldDefs; deposit block sums APPROVED gateway_deposit rows only, capped at due", async () => {
    const { svc } = ordersSetup({
      order: { depositDueMinor: 5000n },
      verifications: [
        pv({ amountMinor: 2000n }),
        pv({ amountMinor: 4000n }), // 2000+4000 > due → capped at 5000
        pv({ amountMinor: 9000n, status: "pending" }), // not approved → ignored
        pv({ amountMinor: 3000n, source: "manual_advance" }), // not a gateway deposit → ignored here
      ],
    });
    const out: any = await svc.getOne("org-1", "o1");
    expect(out.checkoutFieldDefs).toEqual([]);
    expect(out.depositDueMinor).toBe("5000");
    expect(out.deposit).toEqual({ dueMinor: "5000", paidMinor: "5000", outstandingMinor: "0" });
    // The manual advance still counts toward the order's advance math.
    expect(out.advancePaidMinor).toBe("9000");
  });

  it("a partially paid deposit reports the real outstanding amount", async () => {
    const { svc } = ordersSetup({
      order: { depositDueMinor: 5000n },
      verifications: [pv({ amountMinor: 1500n }), pv({ amountMinor: 1000n })],
    });
    const out: any = await svc.getOne("org-1", "o1");
    expect(out.deposit).toEqual({ dueMinor: "5000", paidMinor: "2500", outstandingMinor: "2500" });
  });
});

describe("AB4 OrdersService.exportCsv — field:<key> columns", () => {
  const BASE_HEADER = "order_id,external_id,external_number,source,status,is_cod,payment_method,customer_name,customer_phone,customer_email,items,subtotal,shipping,discount,tax,total,refunded,currency,placed_at,created_at";
  const csvOrder = {
    externalId: "ext-1", externalNumber: "1001", source: "shop", status: "processing",
    isCod: true, paymentMethod: "cod", currency: "BDT",
    placedAt: new Date("2026-10-05T04:00:00.000Z"), createdAt: new Date("2026-10-05T04:05:00.000Z"),
    checkoutFields: { gift_wrap: true, delivery_area: "ঢাকার ভিতরে" },
  };

  it("appends ACTIVE defs' columns in sortOrder order: string as-is, boolean as yes/no, missing as empty", async () => {
    const { svc } = ordersSetup({
      order: csvOrder,
      defs: [
        { id: "f2", organizationId: "org-1", key: "note_missing", label: "নোট", type: "text", options: null, required: false, appliesTo: "all", sortOrder: 3, active: true, createdAt: new Date(3000) },
        { id: "f1", organizationId: "org-1", key: "delivery_area", label: "এলাকা", type: "select", options: [], required: true, appliesTo: "all", sortOrder: 1, active: true, createdAt: new Date(1000) },
        { id: "f3", organizationId: "org-1", key: "gift_wrap", label: "মোড়ক", type: "checkbox", options: null, required: false, appliesTo: "all", sortOrder: 2, active: true, createdAt: new Date(2000) },
        { id: "f4", organizationId: "org-1", key: "off_field", label: "বন্ধ", type: "text", options: null, required: false, appliesTo: "all", sortOrder: 0, active: false, createdAt: new Date(500) },
      ],
    });
    const csv = await svc.exportCsv("org-1", {});
    const lines = csv.split("\n");
    expect(lines[0]).toBe(`${BASE_HEADER},field:delivery_area,field:gift_wrap,field:note_missing`);
    expect(lines[1].endsWith(",ঢাকার ভিতরে,yes,")).toBe(true);
  });

  it("no defs → the export is byte-identical to the pre-AB4 shape", async () => {
    const { svc } = ordersSetup({ order: csvOrder });
    const csv = await svc.exportCsv("org-1", {});
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(BASE_HEADER);
  });

  it("a missing checkoutFieldDef table (older deploy) also leaves the export untouched", async () => {
    const { svc, prisma } = ordersSetup({ order: csvOrder });
    delete prisma.checkoutFieldDef;
    const csv = await svc.exportCsv("org-1", {});
    expect(csv.split("\n")[0]).toBe(BASE_HEADER);
  });
});
