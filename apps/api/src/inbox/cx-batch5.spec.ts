import { PackingScanService } from "../orders/packing-scan.service";
import { PracticeModeService, DEFAULT_PRACTICE_SCENARIOS } from "./practice-mode.service";
import { BadRequestException, NotFoundException } from "@nestjs/common";

function makeTable(name: string, allTables: Record<string, any>) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, include, orderBy }: any = {}) => {
      let filtered = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] as [string, string];
        filtered.sort((a, b) => {
          const valA = a[field] instanceof Date ? a[field].getTime() : a[field];
          const valB = b[field] instanceof Date ? b[field].getTime() : b[field];
          return dir === "desc" ? valB - valA : valA - valB;
        });
      }
      const item = filtered[0] ?? null;
      if (!item) return null;
      return hydrate(name, item, include, allTables);
    },
    findMany: async ({ where, include, orderBy, take }: any = {}) => {
      let filtered = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] as [string, string];
        filtered.sort((a, b) => {
          const valA = a[field] instanceof Date ? a[field].getTime() : a[field];
          const valB = b[field] instanceof Date ? b[field].getTime() : b[field];
          return dir === "desc" ? valB - valA : valA - valB;
        });
      }
      if (take) filtered = filtered.slice(0, take);
      return filtered.map((item) => hydrate(name, item, include, allTables));
    },
    create: async ({ data, include }: any) => {
      const { items, ...rest } = data;
      const row = {
        id: `${name}-${++seq}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        scannedAt: new Date(),
        ...rest,
      };
      rows.push(row);

      // Handle nested items creation
      if (items?.create && allTables.packingScanItem) {
        for (const itemData of items.create) {
          allTables.packingScanItem.rows.push({
            id: `psi-${++seq}`,
            packingScanId: row.id,
            ...itemData,
          });
        }
      }

      return hydrate(name, row, include, allTables);
    },
    update: async ({ where, data, include }: any) => {
      const row = rows.find((r) => r.id === where.id || matches(r, where));
      if (!row) throw new Error("Row not found for update");
      Object.assign(row, data, { updatedAt: new Date() });
      return hydrate(name, row, include, allTables);
    },
  };
}

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function hydrate(tableName: string, row: any, include: any, allTables: Record<string, any>) {
  if (!include) return { ...row };
  const res = { ...row };
  if (tableName === "packingScanLog") {
    if (include.items && allTables.packingScanItem) {
      res.items = allTables.packingScanItem.rows.filter((i: any) => i.packingScanId === row.id);
    }
    if (include.order && allTables.order) {
      const ord = allTables.order.rows.find((o: any) => o.id === row.orderId);
      res.order = ord ? hydrate("order", ord, include.order?.include, allTables) : null;
    }
  }
  if (tableName === "order") {
    if (include.items && allTables.orderItem) {
      res.items = allTables.orderItem.rows.filter((i: any) => i.orderId === row.id);
    }
  }
  return res;
}

const auditStub: any = { log: jest.fn().mockResolvedValue(undefined) };

describe("CX Batch 5 (CX8 Packing Scanner, CX12a Practice Mode)", () => {
  describe("CX8: Packing Vision Label & Product Scanner", () => {
    let tables: Record<string, any>;
    let service: PackingScanService;

    beforeEach(() => {
      tables = {};
      tables.order = makeTable("order", tables);
      tables.orderItem = makeTable("orderItem", tables);
      tables.packingScanLog = makeTable("packingScanLog", tables);
      tables.packingScanItem = makeTable("packingScanItem", tables);

      // Seed order
      tables.order.rows.push({
        id: "ord-1",
        organizationId: "org-1",
        externalNumber: "1001",
        status: "processing",
        totalMinor: 150000n,
      });

      tables.orderItem.rows.push(
        { id: "item-1", orderId: "ord-1", sku: "SHIRT-M", name: "Cotton Shirt M", quantity: 2 },
        { id: "item-2", orderId: "ord-1", sku: "PANTS-32", name: "Denim Pants 32", quantity: 1 },
      );

      service = new PackingScanService(tables as any, auditStub);
    });

    it("starts a packing scan session with expected item quantities", async () => {
      const scan = await service.startScan("org-1", "user-1", { orderId: "ord-1" });

      expect(scan.id).toBeDefined();
      expect(scan.status).toBe("in_progress");
      expect(scan.totalItems).toBe(3);
      expect(scan.items).toHaveLength(2);
      expect(scan.items.find((i: any) => i.sku === "SHIRT-M").expectedQty).toBe(2);
    });

    it("verifies items incrementally and detects over-packing or mismatches", async () => {
      const scan = await service.startScan("org-1", "user-1", { orderId: "ord-1" });

      // Scan first shirt
      const step1 = await service.verifyItem("org-1", scan.id, { sku: "SHIRT-M" });
      expect(step1.matched).toBe(true);
      expect(step1.item.scannedQty).toBe(1);
      expect(step1.allMatched).toBe(false);

      // Scan second shirt
      const step2 = await service.verifyItem("org-1", scan.id, { sku: "SHIRT-M" });
      expect(step2.item.scannedQty).toBe(2);
      expect(step2.item.status).toBe("matched");

      // Scan pants
      const step3 = await service.verifyItem("org-1", scan.id, { sku: "PANTS-32" });
      expect(step3.item.scannedQty).toBe(1);
      expect(step3.item.status).toBe("matched");
      expect(step3.allMatched).toBe(true);
    });

    it("rejects unknown SKU not in the order", async () => {
      const scan = await service.startScan("org-1", "user-1", { orderId: "ord-1" });
      const res = await service.verifyItem("org-1", scan.id, { sku: "UNKNOWN-ITEM" });

      expect(res.matched).toBe(false);
      expect(res.message).toContain("অনাকাঙ্ক্ষিত আইটেম");
    });

    it("requires override flag to complete when items are missing", async () => {
      const scan = await service.startScan("org-1", "user-1", { orderId: "ord-1" });
      await service.verifyItem("org-1", scan.id, { sku: "SHIRT-M" }); // Only 1 of 3 scanned

      await expect(
        service.completeScan("org-1", "user-1", scan.id, { overrideMismatch: false })
      ).rejects.toThrow("সবগুলো আইটেম সঠিকভাবে মেলেনি");

      const overridden = await service.completeScan("org-1", "user-1", scan.id, {
        overrideMismatch: true,
        notes: "Customer confirmed 1 shirt only",
      });
      expect(overridden.status).toBe("overridden");
      expect(overridden.notes).toBe("Customer confirmed 1 shirt only");
    });
  });

  describe("CX12a: Setup Guide & Practice Mode (Interactive Simulation)", () => {
    let tables: Record<string, any>;
    let service: PracticeModeService;
    let inboxStub: any;

    beforeEach(() => {
      tables = {};
      tables.practiceScenario = makeTable("practiceScenario", tables);
      tables.practiceSession = makeTable("practiceSession", tables);

      inboxStub = {
        testComposeReply: jest.fn().mockResolvedValue({
          answer: "ঢাকার ভেতরে ডেলিভারি চার্জ ৬০ টাকা, ঢাকার বাইরে ১২০ টাকা।",
        }),
      };

      service = new PracticeModeService(tables as any, inboxStub, auditStub);
    });

    it("lists default practice scenarios", async () => {
      const list = await service.listScenarios();
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(list[0].id).toBe(DEFAULT_PRACTICE_SCENARIOS[0].id);
    });

    it("starts a practice session and initializes transcript from scenario", async () => {
      const session = await service.startSession("org-1", "user-1", {
        scenarioId: "scen-price-inquiry",
        channel: "whatsapp",
      });

      expect(session.id).toBeDefined();
      expect(session.status).toBe("active");
      expect(session.channel).toBe("whatsapp");
      expect(session.transcript).toHaveLength(1);
      expect(session.transcript[0].text).toContain("দাম কত");
    });

    it("sends simulated message through bot engine and records bot response", async () => {
      const session = await service.startSession("org-1", "user-1", {
        scenarioId: "scen-price-inquiry",
      });

      const res = await service.sendMessage("org-1", "user-1", session.id, {
        message: "ঢাকার বাইরে ডেলিভারি কত?",
      });

      expect(res.replyText).toContain("ঢাকার বাইরে ১২০ টাকা");
      expect(res.session.transcript).toHaveLength(3); // 1 initial + 1 user + 1 bot
      expect(inboxStub.testComposeReply).toHaveBeenCalled();
    });

    it("completes session with score and feedback", async () => {
      const session = await service.startSession("org-1", "user-1", {
        scenarioId: "scen-price-inquiry",
      });

      const finished = await service.completeSession("org-1", "user-1", session.id, {
        score: 95,
        feedback: "খুব চমৎকার উত্তর দিয়েছে বট।",
      });

      expect(finished.status).toBe("completed");
      expect(finished.score).toBe(95);
      expect(finished.feedback).toBe("খুব চমৎকার উত্তর দিয়েছে বট।");
    });
  });
});
