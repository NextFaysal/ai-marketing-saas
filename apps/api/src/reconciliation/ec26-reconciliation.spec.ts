import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ReconciliationService, parseSheetMoney } from "./reconciliation.service";

/** EC26 — courier COD reconciliation: mapping validation, robust
 * sheet-money parsing, the six line outcomes, idempotent
 * re-import, profile reuse, and staff line resolution. Fake
 * prisma mirrors the ec23-accounting.spec.ts style. */

const ORG = "org-1";
const ACTOR = "user-1";
const MAPPING = {
  trackingColumn: "Tracking ID",
  amountColumn: "Amount",
  chargeColumn: "Charge",
  orderRefColumn: "Order Ref",
  statusColumn: "Status",
};
const HEADER = "Tracking ID,Order Ref,Amount,Charge,Status";

function matchWhere(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => row[k] === v);
}

function makeWorld() {
  const integrations: any[] = [
    { id: "int-sf", organizationId: ORG, provider: "steadfast", status: "CONNECTED" },
    { id: "int-meta", organizationId: ORG, provider: "meta", status: "CONNECTED" },
    { id: "int-foreign", organizationId: "org-2", provider: "pathao", status: "CONNECTED" },
  ];
  const orders: any[] = [
    { id: "ord-1", organizationId: ORG, externalId: "ext-1", externalNumber: "ORD-1" },
    { id: "ord-2", organizationId: ORG, externalId: "ext-2", externalNumber: "ORD-2" },
  ];
  const shipments: any[] = [
    {
      id: "sh-1", organizationId: ORG, orderId: "ord-1", provider: "steadfast",
      trackingCode: "TRK-1", consignmentId: "CONS-1", invoice: "ORD-1", status: "delivered",
      codAmountMinor: 125000n, codCollectedMinor: null, codCollectedAt: null, codCollectionSource: null,
      createdAt: new Date("2026-10-01T00:00:00Z"),
    },
    {
      id: "sh-2", organizationId: ORG, orderId: "ord-2", provider: "steadfast",
      trackingCode: "TRK-2", consignmentId: "CONS-2", invoice: "SF-INV-2", status: "delivered",
      codAmountMinor: 50000n, codCollectedMinor: null, codCollectedAt: null, codCollectionSource: null,
      createdAt: new Date("2026-10-02T00:00:00Z"),
    },
    {
      // Second (latest) shipment for ord-2 — the order-ref fallback
      // must pick THIS one, via externalNumber, when invoice misses.
      id: "sh-3", organizationId: ORG, orderId: "ord-2", provider: "steadfast",
      trackingCode: "TRK-3", consignmentId: "CONS-3", invoice: "SF-INV-3", status: "delivered",
      codAmountMinor: 70000n, codCollectedMinor: null, codCollectedAt: null, codCollectionSource: null,
      createdAt: new Date("2026-10-03T00:00:00Z"),
    },
  ];
  const profiles: any[] = [];
  const imports: any[] = [];
  const lines: any[] = [];
  let impSeq = 0;
  let lineSeq = 0;
  let profileSeq = 0;

  const shipmentUpdate = jest.fn(async ({ where, data }: any) => {
    const s = shipments.find((x) => x.id === where.id);
    Object.assign(s, data);
    return s;
  });

  const prisma: any = {
    integration: {
      findFirst: async ({ where }: any) => integrations.find((r) => matchWhere(r, where)) ?? null,
    },
    order: {
      findMany: async ({ where }: any) => orders.filter((r) => matchWhere(r, where)),
    },
    courierShipment: {
      findMany: async ({ where }: any) => shipments.filter((r) => matchWhere(r, where)),
      findFirst: async ({ where }: any) => shipments.find((r) => matchWhere(r, where)) ?? null,
      update: shipmentUpdate,
    },
    reconciliationProfile: {
      findFirst: async ({ where }: any) => profiles.find((r) => matchWhere(r, where)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `prof-${++profileSeq}`, ...data };
        profiles.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = profiles.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    reconciliationImport: {
      findFirst: async ({ where }: any) => imports.find((r) => matchWhere(r, where)) ?? null,
      findMany: async ({ where }: any) => imports.filter((r) => matchWhere(r, where)),
      create: async ({ data }: any) => {
        impSeq += 1;
        const row = {
          id: `imp-${impSeq}`,
          matchedCount: 0, mismatchCount: 0, notFoundCount: 0, duplicateCount: 0,
          createdAt: new Date(Date.UTC(2026, 9, 1, 0, impSeq)),
          ...data,
        };
        imports.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = imports.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    reconciliationLine: {
      findFirst: async ({ where }: any) => lines.find((r) => matchWhere(r, where)) ?? null,
      findMany: async ({ where }: any) => lines.filter((r) => matchWhere(r, where)),
      create: async ({ data }: any) => {
        const row = { id: `line-${++lineSeq}`, reviewedAt: null, reviewedBy: null, createdAt: new Date(), ...data };
        lines.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = lines.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  return { prisma, audit, integrations, orders, shipments, profiles, imports, lines, shipmentUpdate };
}

function svc(world: ReturnType<typeof makeWorld>) {
  return new ReconciliationService(world.prisma, world.audit);
}

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("EC26 parseSheetMoney", () => {
  it("parses the formats couriers actually export", () => {
    expect(parseSheetMoney("1,250.00")).toBe(125000n);
    expect(parseSheetMoney("1250")).toBe(125000n);
    expect(parseSheetMoney("1250.5")).toBe(125050n);
    expect(parseSheetMoney("BDT 1,250.00")).toBe(125000n);
    expect(parseSheetMoney("৳500")).toBe(50000n);
    expect(parseSheetMoney(" 750 ")).toBe(75000n);
  });
  it("returns null (never a guess) for junk", () => {
    expect(parseSheetMoney("abc")).toBeNull();
    expect(parseSheetMoney("")).toBeNull();
    expect(parseSheetMoney("12.345")).toBeNull();
    expect(parseSheetMoney("-50")).toBeNull();
    expect(parseSheetMoney(null)).toBeNull();
  });
});

describe("EC26 readHeaders", () => {
  it("returns the sheet's own header names", async () => {
    const w = makeWorld();
    await expect(svc(w).readHeaders(csv("TRK-1,ORD-1,1,2,delivered"))).resolves.toEqual({
      headers: ["Tracking ID", "Order Ref", "Amount", "Charge", "Status"],
    });
  });
  it("empty CSV ⇒ 400 header message", async () => {
    const w = makeWorld();
    await expect(svc(w).readHeaders("")).rejects.toMatchObject({ code: "reconciliation.noHeaderWasFoundInThe" });
    await expect(svc(w).readHeaders("   ")).rejects.toThrow("CSV ফাইলে header পাওয়া যায়নি");
  });
});

describe("EC26 courier + profile validation", () => {
  it("foreign integration ⇒ 404; non-courier provider ⇒ 400", async () => {
    const w = makeWorld();
    await expect(svc(w).getProfile(ORG, "int-foreign")).rejects.toMatchObject({ code: "reconciliation.courierIntegrationNotFoundInThis" });
    await expect(svc(w).getProfile(ORG, "int-meta")).rejects.toMatchObject({ code: "reconciliation.thisIntegrationIsNotACourier" });
    await expect(svc(w).getProfile(ORG, "nope")).rejects.toMatchObject({ code: "reconciliation.courierIntegrationNotFoundInThis" });
  });

  it("saveProfile validates mapping: tracking + amount columns required", async () => {
    const w = makeWorld();
    await expect(
      svc(w).saveProfile(ORG, { courierIntegrationId: "int-sf", mapping: { trackingColumn: "T" } as any }),
    ).rejects.toMatchObject({ code: "reconciliation.isRequiredInColumnMappingIt" });
    const saved = await svc(w).saveProfile(ORG, { courierIntegrationId: "int-sf", mapping: MAPPING as any });
    expect(saved.mapping.trackingColumn).toBe("Tracking ID");
    const got = await svc(w).getProfile(ORG, "int-sf");
    expect(got.mapping.amountColumn).toBe("Amount");
    expect(got.provider).toBe("steadfast");
  });

  it("first import without any mapping ⇒ 400 profile-required message", async () => {
    const w = makeWorld();
    await expect(
      svc(w).importSheet(ORG, ACTOR, { courierIntegrationId: "int-sf", csvText: csv("TRK-1,ORD-1,1250,,delivered") }),
    ).rejects.toThrow("column mapping সেট করা হয়নি");
  });

  it("a mapping sent with the import is saved and reused by the next import", async () => {
    const w = makeWorld();
    const s = svc(w);
    await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv("TRK-1,ORD-1,1250,,delivered"), mapping: MAPPING as any,
    });
    expect(w.profiles).toHaveLength(1);
    // Second import, NO mapping in the dto — the saved profile applies.
    const second = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv("TRK-2,SF-INV-2,500,,delivered"),
    });
    expect(second.matchedCount).toBe(1);
  });

  it("a mapped column missing from the file ⇒ 400 NAMING the column", async () => {
    const w = makeWorld();
    await expect(
      svc(w).importSheet(ORG, ACTOR, {
        courierIntegrationId: "int-sf",
        csvText: csv("TRK-1,ORD-1,1250,,delivered"),
        mapping: { ...MAPPING, trackingColumn: "Consignment No" } as any,
      }),
    ).rejects.toThrow("mapping-এর কলাম পাওয়া যায়নি: Consignment No");
  });
});

describe("EC26 import outcomes", () => {
  it("matched: '1,250.00' → 125000n stamped with source + audit", async () => {
    const w = makeWorld();
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", fileName: "oct.csv",
      csvText: csv('TRK-1,ORD-1,"1,250.00",60.00,delivered'), mapping: MAPPING as any,
    });
    expect(result.matchedCount).toBe(1);
    const sh = w.shipments.find((x) => x.id === "sh-1")!;
    expect(sh.codCollectedMinor).toBe(125000n);
    expect(sh.codCollectionSource).toBe(result.id);
    expect(sh.codCollectedAt).toBeInstanceOf(Date);
    const { items } = await s.listLines(ORG, result.id);
    expect(items[0].outcome).toBe("matched");
    expect(items[0].sheetAmountMinor).toBe("125000");
    expect(items[0].sheetChargeMinor).toBe("6000");
    expect(items[0].expectedMinor).toBe("125000");
    expect(items[0].matchedShipmentId).toBe("sh-1");
    expect(items[0].matchedOrderId).toBe("ord-1");
    expect(w.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reconciliation.imported", entityType: "ReconciliationImport" }),
    );
  });

  it("consignmentId is also a tracking key; plain '500' parses to 50000n", async () => {
    const w = makeWorld();
    const result = await svc(w).importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv("CONS-2,SF-INV-2,500,,delivered"), mapping: MAPPING as any,
    });
    expect(result.matchedCount).toBe(1);
    expect(w.shipments.find((x) => x.id === "sh-2")!.codCollectedMinor).toBe(50000n);
  });

  it("invoice matches before the order fallback; order fallback takes the LATEST shipment", async () => {
    const w = makeWorld();
    const s = svc(w);
    // Row 1: unknown tracking, Order Ref = SF-INV-2 (sh-2's invoice).
    // Row 2: unknown tracking, Order Ref = ORD-2 (no invoice match;
    // order externalNumber → latest ord-2 shipment = sh-3).
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf",
      csvText: csv("XXX-1,SF-INV-2,500,,delivered", "XXX-2,ORD-2,700,,delivered"),
      mapping: MAPPING as any,
    });
    const { items } = await s.listLines(ORG, result.id);
    expect(items[0].matchedShipmentId).toBe("sh-2");
    expect(items[1].matchedShipmentId).toBe("sh-3");
    expect(items[1].expectedMinor).toBe("70000");
    expect(result.matchedCount).toBe(2);
  });

  it("amount_mismatch: sheet amount STILL stamps, line flags expected vs sheet", async () => {
    const w = makeWorld();
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv("TRK-2,SF-INV-2,400,,delivered"), mapping: MAPPING as any,
    });
    expect(result.mismatchCount).toBe(1);
    expect(w.shipments.find((x) => x.id === "sh-2")!.codCollectedMinor).toBe(40000n);
    const { items } = await s.listLines(ORG, result.id);
    expect(items[0].outcome).toBe("amount_mismatch");
    expect(items[0].note).toContain("50000");
    expect(items[0].note).toContain("40000");
  });

  it("not_found preserves the raw values verbatim", async () => {
    const w = makeWorld();
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv("NOPE-9,REF-9,900,,delivered"), mapping: MAPPING as any,
    });
    expect(result.notFoundCount).toBe(1);
    const { items } = await s.listLines(ORG, result.id);
    expect(items[0].outcome).toBe("not_found");
    expect(items[0].rawTrackingId).toBe("NOPE-9");
    expect(items[0].rawOrderRef).toBe("REF-9");
    expect(items[0].sheetAmountMinor).toBe("90000");
    expect(items[0].matchedShipmentId).toBeNull();
  });

  it("unparseable amount on a MATCHED row ⇒ row_error, raw in note, shipment NOT stamped", async () => {
    const w = makeWorld();
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv("TRK-1,ORD-1,abc,,delivered"), mapping: MAPPING as any,
    });
    const { items } = await s.listLines(ORG, result.id);
    expect(items[0].outcome).toBe("row_error");
    expect(items[0].note).toContain("abc");
    expect(items[0].matchedShipmentId).toBe("sh-1");
    expect(items[0].expectedMinor).toBe("125000");
    expect(w.shipments.find((x) => x.id === "sh-1")!.codCollectedMinor).toBeNull();
  });

  it("row with neither tracking nor order ref ⇒ row_error", async () => {
    const w = makeWorld();
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv(",,500,,delivered"), mapping: MAPPING as any,
    });
    const { items } = await s.listLines(ORG, result.id);
    expect(items[0].outcome).toBe("row_error");
    expect(items[0].note).toContain("tracking/order ref নেই");
  });

  it("duplicate key in the same file: applied once, second row is duplicate", async () => {
    const w = makeWorld();
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf",
      csvText: csv("TRK-1,ORD-1,1250,,delivered", "TRK-1,ORD-1,1250,,delivered"),
      mapping: MAPPING as any,
    });
    expect(result.matchedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    const stamps = w.shipmentUpdate.mock.calls.filter((c: any) => c[0].where.id === "sh-1");
    expect(stamps).toHaveLength(1);
  });

  it("same shipment under two different keys in one file: second hit is duplicate, stamped once", async () => {
    const w = makeWorld();
    const s = svc(w);
    // Row 1 matches sh-1 by tracking; row 2 carries no tracking but
    // the order ref ORD-1 resolves (via invoice) to the SAME sh-1 —
    // with a DIFFERENT amount. The shipment must keep row 1's stamp.
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf",
      csvText: csv("TRK-1,,1250,,delivered", ",ORD-1,999,,delivered"),
      mapping: MAPPING as any,
    });
    expect(result.matchedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    const stamps = w.shipmentUpdate.mock.calls.filter((c: any) => c[0].where.id === "sh-1");
    expect(stamps).toHaveLength(1);
    const sh = w.shipments.find((x) => x.id === "sh-1")!;
    expect(sh.codCollectedMinor).toBe(125000n);
    const { items } = await s.listLines(ORG, result.id);
    expect(items[1].outcome).toBe("duplicate");
    expect(items[1].matchedShipmentId).toBe("sh-1");
  });

  it("a repeat of a NOT-FOUND row is evaluated fresh (not a duplicate)", async () => {
    const w = makeWorld();
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf",
      csvText: csv("NOPE,REF,100,,", "NOPE,REF,100,,"),
      mapping: MAPPING as any,
    });
    expect(result.notFoundCount).toBe(2);
    expect(result.duplicateCount).toBe(0);
  });

  it("already_collected: an earlier collection is never overwritten", async () => {
    const w = makeWorld();
    const sh = w.shipments.find((x) => x.id === "sh-1")!;
    sh.codCollectedMinor = 99900n;
    sh.codCollectedAt = new Date("2026-10-05T00:00:00Z");
    sh.codCollectionSource = "imp-earlier";
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv("TRK-1,ORD-1,1250,,delivered"), mapping: MAPPING as any,
    });
    const { items } = await s.listLines(ORG, result.id);
    expect(items[0].outcome).toBe("already_collected");
    expect(sh.codCollectedMinor).toBe(99900n);
    expect(sh.codCollectionSource).toBe("imp-earlier");
  });

  it("counts identity: import count fields equal the line-outcome counts; rowCount = all lines", async () => {
    const w = makeWorld();
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf",
      csvText: csv(
        "TRK-1,ORD-1,1250,,delivered", // matched
        "TRK-2,SF-INV-2,400,,delivered", // amount_mismatch
        "NOPE,REF,100,,", // not_found
        "TRK-1,ORD-1,1250,,delivered", // duplicate
        ",,500,,", // row_error
      ),
      mapping: MAPPING as any,
    });
    const { items } = await s.listLines(ORG, result.id);
    const byOutcome = (o: string) => items.filter((l: any) => l.outcome === o).length;
    expect(result.rowCount).toBe(5);
    expect(items).toHaveLength(5);
    expect(result.matchedCount).toBe(byOutcome("matched"));
    expect(result.mismatchCount).toBe(byOutcome("amount_mismatch"));
    expect(result.notFoundCount).toBe(byOutcome("not_found"));
    expect(result.duplicateCount).toBe(byOutcome("duplicate"));
    const total = ["matched", "amount_mismatch", "not_found", "duplicate", "already_collected", "row_error"]
      .reduce((n, o) => n + byOutcome(o), 0);
    expect(total).toBe(result.rowCount);
    // listLines outcome filter
    const onlyMismatch = await s.listLines(ORG, result.id, "amount_mismatch");
    expect(onlyMismatch.items).toHaveLength(1);
  });
});

describe("EC26 re-import discipline", () => {
  const TEXT = csv("TRK-1,ORD-1,1250,,delivered");
  it("the same file hash again ⇒ 400", async () => {
    const w = makeWorld();
    const s = svc(w);
    await s.importSheet(ORG, ACTOR, { courierIntegrationId: "int-sf", csvText: TEXT, mapping: MAPPING as any });
    await expect(
      s.importSheet(ORG, ACTOR, { courierIntegrationId: "int-sf", csvText: TEXT }),
    ).rejects.toThrow("এই ফাইলটি আগেই import করা হয়েছে");
  });

  it("force re-import: rows become already_collected, no double stamp", async () => {
    const w = makeWorld();
    const s = svc(w);
    const first = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: TEXT, mapping: MAPPING as any,
    });
    const sh = w.shipments.find((x) => x.id === "sh-1")!;
    expect(sh.codCollectionSource).toBe(first.id);
    w.shipmentUpdate.mockClear();
    const second = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: TEXT, force: true,
    });
    const { items } = await s.listLines(ORG, second.id);
    expect(items[0].outcome).toBe("already_collected");
    expect(w.shipmentUpdate).not.toHaveBeenCalled();
    expect(sh.codCollectedMinor).toBe(125000n);
    expect(sh.codCollectionSource).toBe(first.id);
  });

  it("header-only CSV and empty text ⇒ 400; >5000 rows ⇒ 400", async () => {
    const w = makeWorld();
    const s = svc(w);
    await expect(
      s.importSheet(ORG, ACTOR, { courierIntegrationId: "int-sf", csvText: HEADER, mapping: MAPPING as any }),
    ).rejects.toMatchObject({ code: "reconciliation.thereIsNoDataRowIn" });
    await expect(
      s.importSheet(ORG, ACTOR, { courierIntegrationId: "int-sf", csvText: "", mapping: MAPPING as any }),
    ).rejects.toMatchObject({ code: "reconciliation.noHeaderWasFoundInThe" });
    const bigCsv = ["Tracking ID,Amount", ...Array.from({ length: 5001 }, (_, i) => `TRK-${i},100`)].join("\n");
    await expect(
      s.importSheet(ORG, ACTOR, {
        courierIntegrationId: "int-sf", csvText: bigCsv,
        mapping: { trackingColumn: "Tracking ID", amountColumn: "Amount" } as any,
      }),
    ).rejects.toThrow("5000");
  });
});

describe("EC26 reads + line resolution", () => {
  it("listImports is newest-first and courier-filterable; foreign import ⇒ 404", async () => {
    const w = makeWorld();
    const s = svc(w);
    w.imports.push({
      id: "imp-foreign", organizationId: "org-2", courierIntegrationId: "int-foreign",
      fileHash: "x", rowCount: 1, createdAt: new Date(),
    });
    await s.importSheet(ORG, ACTOR, { courierIntegrationId: "int-sf", csvText: csv("TRK-1,ORD-1,1250,,delivered"), mapping: MAPPING as any });
    await s.importSheet(ORG, ACTOR, { courierIntegrationId: "int-sf", csvText: csv("TRK-2,SF-INV-2,500,,delivered") });
    const all = await s.listImports(ORG);
    expect(all.items).toHaveLength(2);
    expect(new Date(all.items[0].createdAt).getTime()).toBeGreaterThan(new Date(all.items[1].createdAt).getTime());
    const filtered = await s.listImports(ORG, "int-sf");
    expect(filtered.items).toHaveLength(2);
    await expect(s.getImport(ORG, "imp-foreign")).rejects.toMatchObject({ code: "reconciliation.reconciliationImportNotFoundInThis" });
    await expect(s.listLines(ORG, "imp-foreign")).rejects.toMatchObject({ code: "reconciliation.reconciliationImportNotFoundInThis" });
  });

  it("accept_sheet overwrites the collection with the sheet amount + audits old/new", async () => {
    const w = makeWorld();
    const sh = w.shipments.find((x) => x.id === "sh-1")!;
    sh.codCollectedMinor = 99900n;
    sh.codCollectionSource = "imp-earlier";
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv("TRK-1,ORD-1,1250,,delivered"), mapping: MAPPING as any,
    });
    const { items } = await s.listLines(ORG, result.id);
    expect(items[0].outcome).toBe("already_collected");
    const resolved = await s.resolveLine(ORG, ACTOR, items[0].id, { action: "accept_sheet", note: "যাচাই হয়েছে" });
    expect(sh.codCollectedMinor).toBe(125000n);
    expect(sh.codCollectionSource).toBe(result.id);
    expect(resolved.reviewedBy).toBe(ACTOR);
    expect(resolved.reviewedAt).toBeInstanceOf(Date);
    expect(w.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reconciliation.line_accepted",
        metadata: expect.objectContaining({ oldCollectedMinor: "99900", newCollectedMinor: "125000" }),
      }),
    );
  });

  it("mark_reviewed stamps the line only — the shipment is untouched", async () => {
    const w = makeWorld();
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv("TRK-1,ORD-1,1250,,delivered"), mapping: MAPPING as any,
    });
    const { items } = await s.listLines(ORG, result.id);
    w.shipmentUpdate.mockClear();
    const resolved = await s.resolveLine(ORG, ACTOR, items[0].id, { action: "mark_reviewed", note: "দেখেছি" });
    expect(resolved.reviewedBy).toBe(ACTOR);
    expect(resolved.note).toBe("দেখেছি");
    expect(w.shipmentUpdate).not.toHaveBeenCalled();
  });

  it("accept_sheet without a matched shipment ⇒ 400; unknown action ⇒ 400; foreign line ⇒ 404", async () => {
    const w = makeWorld();
    const s = svc(w);
    const result = await s.importSheet(ORG, ACTOR, {
      courierIntegrationId: "int-sf", csvText: csv("NOPE,REF,100,,"), mapping: MAPPING as any,
    });
    const { items } = await s.listLines(ORG, result.id);
    await expect(s.resolveLine(ORG, ACTOR, items[0].id, { action: "accept_sheet" })).rejects.toMatchObject({ code: "reconciliation.thisRowHasNoMatchedShipment" });
    await expect(s.resolveLine(ORG, ACTOR, items[0].id, { action: "bogus" })).rejects.toMatchObject({ code: "reconciliation.unknownActionGiveAcceptSheetOr" });
    w.lines.push({ id: "line-foreign", organizationId: "org-2", importId: "imp-foreign", outcome: "matched", matchedShipmentId: "x", sheetAmountMinor: 1n });
    await expect(s.resolveLine(ORG, ACTOR, "line-foreign", { action: "mark_reviewed" })).rejects.toMatchObject({ code: "reconciliation.reconciliationLineNotFoundInThis" });
  });
});
