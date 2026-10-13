import { MentionsService } from "./mentions.service";

const ORG = "org1";

function containsMatch(value: any, cond: any): boolean {
  if (cond && typeof cond === "object" && "contains" in cond) {
    return String(value ?? "").toLowerCase().includes(String(cond.contains).toLowerCase());
  }
  return value === cond;
}
function rowMatches(row: any, where: any): boolean {
  for (const [k, v] of Object.entries<any>(where)) {
    if (k === "OR") { if (!v.some((c: any) => rowMatches(row, c))) return false; continue; }
    if (!containsMatch(row[k], v)) return false;
  }
  return true;
}
function table(rows: any[]) {
  return {
    findMany: async ({ where, take }: any) => rows.filter((r) => rowMatches(r, where)).slice(0, take),
  };
}

function makeService() {
  const prisma: any = {
    order: table([
      { id: "o1", organizationId: ORG, isPractice: false, externalNumber: "1042", externalId: "1042", status: "processing", currency: "BDT", totalMinor: 150000n, createdAt: new Date() },
      { id: "o2", organizationId: "other", isPractice: false, externalNumber: "1042", externalId: "x", status: "processing", currency: "BDT", totalMinor: 100n, createdAt: new Date() },
    ]),
    customer: table([
      { id: "c1", organizationId: ORG, mergedIntoId: null, firstName: "Rahim", lastName: "Uddin", phone: "01711042", email: null, createdAt: new Date() },
    ]),
    product: table([
      { id: "p1", organizationId: ORG, name: "Cotton Panjabi", sku: "PN-1042", updatedAt: new Date() },
    ]),
    campaignPlan: table([
      { id: "cp1", organizationId: ORG, name: "Eid 1042 Sale", status: "draft", updatedAt: new Date() },
    ]),
  };
  return new MentionsService(prisma);
}

describe("MentionsService (G6)", () => {
  it("searches all four types, org-scoped", async () => {
    const items = await makeService().search(ORG, "1042");
    expect(items.map((i) => i.type).sort()).toEqual(["campaign", "customer", "order", "product"]);
    expect(items.find((i) => i.type === "order")!.label).toContain("1042");
    expect(items.some((i) => i.id === "o2")).toBe(false); // foreign org never surfaces
  });
  it("type filter narrows the search", async () => {
    const items = await makeService().search(ORG, "1042", "product");
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("product");
  });
  it("empty query → no results", async () => {
    expect(await makeService().search(ORG, "  ")).toEqual([]);
  });
});
