import { BadRequestException } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";

/**
 * Milestone 75 (Business Command Center): the operational
 * profile layer — money lands as BigInt minor units, BD
 * payment numbers are normalized (Bengali digits too) or
 * rejected, business hours are validated with the M68
 * evaluator, and completeness is computed from real rows.
 */
function db(profile: any = null, extras: any = {}) {
  const store = { profile };
  const fake: any = {
    businessProfile: {
      findUnique: jest.fn(async () => store.profile),
      upsert: jest.fn(async ({ create, update }: any) => {
        store.profile = store.profile ? { ...store.profile, ...update } : { id: "p1", ...create };
        return store.profile;
      }),
    },
    businessPolicy: { findMany: jest.fn(async () => extras.policies ?? []) },
    knowledgeDocument: { count: jest.fn(async ({ where }: any) => (where.kind === "faq" ? extras.faq ?? 0 : extras.docs ?? 0)) },
    product: { count: jest.fn(async () => extras.products ?? 0) },
  };
  const audit = { log: jest.fn(async () => undefined) };
  return { svc: new OrganizationsService(fake, audit as any), store };
}

describe("M75 operational profile", () => {
  it("money is stored as BigInt and payment numbers normalize", async () => {
    const { svc, store } = db();
    await svc.updateBusinessProfile("org", "boss", {
      deliveryChargeInsideMinor: 6000, bkashNumber: "০১৭১২-৩৪৫ ৬৭৮",
    } as any);
    expect(store.profile.deliveryChargeInsideMinor).toBe(6000n);
    expect(store.profile.bkashNumber).toBe("01712345678");
  });

  it("a malformed payment number and bogus hours are refused", async () => {
    const { svc } = db();
    await expect(svc.updateBusinessProfile("org", "boss", { bkashNumber: "12345" } as any))
      .rejects.toThrow(BadRequestException);
    await expect(svc.updateBusinessProfile("org", "boss", {
      businessHours: { timezone: "Asia/Dhaka", windows: { sat: [["25:00", "26:00"]] } },
    } as any)).rejects.toThrow(/উইন্ডো/);
    const ok = await svc.updateBusinessProfile("org", "boss", {
      businessHours: { windows: { sat: [["09:00", "21:00"]] } },
    } as any);
    expect((ok as any).businessHours.timezone).toBe("Asia/Dhaka");
  });

  it("profile JSON carries BigInt money as strings (never a serialization 500)", () => {
    const out: any = OrganizationsService.profileJson({ id: "p", deliveryChargeInsideMinor: 6000n, monthlyBudgetMinor: null, bkashNumber: "01712345678" });
    expect(out.deliveryChargeInsideMinor).toBe("6000");
    expect(out.monthlyBudgetMinor).toBeNull();
    expect(() => JSON.stringify(out)).not.toThrow();
    expect(OrganizationsService.profileJson(null)).toBeNull();
  });

  it("completeness reflects what actually exists", async () => {
    const empty = db(null);
    const c0: any = await empty.svc.getProfileCompleteness("org");
    expect(c0.percent).toBe(0);
    expect(c0.aiCanAnswer.delivery).toBe(false);

    const filled = db({
      description: "d", industry: "fashion", contactPhone: "01700000000", address: "Khulna",
      deliveryChargeInsideMinor: 6000n, deliveryDaysInside: 2, codAvailable: true, businessHours: { timezone: "Asia/Dhaka", windows: {} },
    }, { policies: [{ type: "shipping" }, { type: "return" }], faq: 2, docs: 3, products: 5 });
    const c1: any = await filled.svc.getProfileCompleteness("org");
    expect(c1.percent).toBe(100);
    expect(c1.aiCanAnswer).toEqual({ priceStock: true, delivery: true, payment: true, contactHours: true, faq: true });
    expect(c1.counts).toEqual({ faq: 2, documents: 3, products: 5, policies: 2 });
  });
});
