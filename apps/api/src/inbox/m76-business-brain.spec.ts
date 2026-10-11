import { InboxService } from "./inbox.service";
import { deliveryFactLines, matchKnowledge, paymentFactLines } from "./business-brain";

/**
 * Milestone 76 (Business Brain v2): the fact builders quote
 * ONLY stored facts, the FAQ matcher needs real overlap, and
 * buildFactPack now answers delivery/payment/contact
 * questions from the Command Center profile — where v1
 * stayed silent without a policy row.
 */
describe("M76 fact builders", () => {
  const profile = {
    deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n,
    deliveryDaysInside: 2, deliveryDaysOutside: null,
    freeDeliveryAboveMinor: 200000n, minOrderMinor: null,
    codAvailable: true, bkashNumber: "01712345678", nagadNumber: null,
    advancePaymentPercent: 20, paymentNote: null,
  };
  it("delivery lines carry the stored numbers and nothing invented", () => {
    const lines = deliveryFactLines(profile);
    expect(lines.join(" ")).toContain("60"); // 6000 minor -> BDT 60.00
    expect(lines.join(" ")).toContain("120");
    expect(lines.some((l) => l.includes("ডেলিভারি সময়: 2 দিন"))).toBe(true);
    expect(lines.join(" ")).not.toContain("undefined");
    expect(deliveryFactLines(null)).toEqual([]);
    expect(deliveryFactLines({})).toEqual([]);
  });
  it("payment lines include COD, the number and the advance rule", () => {
    const lines = paymentFactLines(profile);
    expect(lines.join(" ")).toContain("ক্যাশ অন ডেলিভারি");
    expect(lines.join(" ")).toContain("01712345678");
    expect(lines.join(" ")).toContain("20%");
  });
  it("knowledge matching requires real overlap and ranks title hits first", () => {
    const docs = [
      { id: "d1", title: "ওয়ারেন্টি নীতি", content: "সব ঘড়িতে এক বছরের ওয়ারেন্টি দেওয়া হয়।", kind: "faq" },
      { id: "d2", title: "ডেলিভারি এলাকা", content: "সারা দেশে ডেলিভারি করা হয়।", kind: "faq" },
    ];
    const hits = matchKnowledge("ঘড়ির ওয়ারেন্টি কত দিনের?", docs);
    expect(hits[0]?.doc.id).toBe("d1");
    expect(matchKnowledge("আবহাওয়া কেমন আজ?", docs)).toEqual([]);
  });
});

describe("M76 fact pack v2", () => {
  function svc() {
    const fake: any = {
      businessProfile: { findUnique: jest.fn(async () => ({
        deliveryChargeInsideMinor: 6000n, deliveryDaysInside: 2,
        codAvailable: true, bkashNumber: "01712345678",
        contactPhone: "01712345678", address: "সোনাডাঙ্গা", city: "খুলনা",
        businessHours: { timezone: "Asia/Dhaka", windows: { sun: [["09:00", "21:00"]] } },
      })) },
      businessPolicy: { findFirst: jest.fn(async () => null) },
      knowledgeDocument: { findMany: jest.fn(async () => ([
        { id: "f1", title: "রিটার্ন নীতি", content: "পণ্যে ত্রুটি থাকলে ৭ দিনের মধ্যে রিটার্ন করা যাবে।", kind: "faq" },
      ])) },
      organization: { findUnique: jest.fn(async () => ({ name: "T1 Shop" })) },
      product: { findMany: jest.fn(async () => []) },
      order: { findFirst: jest.fn(async () => null) },
    };
    return new InboxService(fake, { log: jest.fn(async () => undefined) } as any, {} as any);
  }

  it("delivery intent is answered from the profile alone (v1 needed a policy)", async () => {
    const pack: any = await (svc() as any).buildFactPack("org", { customerId: null }, "delivery", "ডেলিভারি চার্জ কত?");
    expect(pack).not.toBeNull();
    expect(pack.factsText).toContain("ব্যবসার নাম: T1 Shop");
    expect(pack.factsText).toContain("ডেলিভারি চার্জ");
    expect(pack.sources).toContainEqual({ type: "business_profile", area: "delivery" });
  });

  it("a return question finds the FAQ by keywords", async () => {
    const pack: any = await (svc() as any).buildFactPack("org", { customerId: null }, "other", "রিটার্ন করা যাবে কি?");
    expect(pack.factsText).toContain("রিটার্ন নীতি");
    expect(pack.sources.some((s: any) => s.type === "knowledge" && s.docId === "f1")).toBe(true);
  });

  it("with nothing stored anywhere the pack is honestly null", async () => {
    const empty: any = new InboxService({
      businessProfile: { findUnique: jest.fn(async () => null) },
      businessPolicy: { findFirst: jest.fn(async () => null) },
      knowledgeDocument: { findMany: jest.fn(async () => []) },
      organization: { findUnique: jest.fn(async () => null) },
      product: { findMany: jest.fn(async () => []) },
      order: { findFirst: jest.fn(async () => null) },
    } as any, { log: jest.fn(async () => undefined) } as any, {} as any);
    expect(await empty.buildFactPack("org", { customerId: null }, "delivery", "ডেলিভারি?")).toBeNull();
  });
});
