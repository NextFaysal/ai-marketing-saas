import "reflect-metadata";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { BookingService, depositLabelFor } from "./booking.service";
import { computeSlots } from "./slots";

/**
 * NF4 (FB2) — Service & Appointment bookings. Fake-prisma
 * harness in the live-commerce.spec.ts pattern (in-memory
 * tables, org-scoped `matches`, positional construction).
 * ShopAccountService is a STUB — the reminder sweep must send
 * through sendShopSms (the shared path) and record its honest
 * outcomes; the stub's call count pins the exactly-once rule.
 *
 * Calendar anchor: 2026-10-19 is a Monday; Asia/Dhaka = UTC+6,
 * so 10:00 Dhaka = 04:00Z.
 */

type Row = Record<string, any>;

function cmp(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      if ("lt" in v) return cmp(row[k], (v as any).lt) < 0;
      if ("lte" in v) return cmp(row[k], (v as any).lte) <= 0;
      if ("gt" in v) return cmp(row[k], (v as any).gt) > 0;
      if ("gte" in v) return cmp(row[k], (v as any).gte) >= 0;
      return true;
    }
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return row[k] === v;
  });
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  if (!specs.length) return rows;
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [key, dir] = Object.entries(spec)[0] as [string, string];
      const c = cmp(a[key], b[key]);
      if (c !== 0) return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

function setup(opts: { sms?: jest.Mock } = {}) {
  const organizations: Row[] = [
    { id: "org-1", slug: "shop-one", name: "সেলুন এক", timezone: "Asia/Dhaka" },
    { id: "org-2", slug: "shop-two", name: "ক্লিনিক দুই", timezone: "Asia/Dhaka" },
  ];
  const users: Row[] = [
    { id: "u1", name: "রাবেয়া সুলতানা", email: "rabeya@example.com" },
    { id: "u2", name: "অন্য দোকানের সদস্য", email: "other@example.com" },
  ];
  const memberships: Row[] = [
    { id: "m1", userId: "u1", organizationId: "org-1", status: "ACTIVE", role: "ADMIN" },
    { id: "m2", userId: "u2", organizationId: "org-2", status: "ACTIVE", role: "ADMIN" },
    { id: "m3", userId: "u1", organizationId: "org-1", status: "SUSPENDED", role: "VIEWER" },
  ];
  const businessProfiles: Row[] = [
    { id: "bp-1", organizationId: "org-1", depositMode: null, depositPercent: null, depositFixedMinor: null, depositAppliesTo: "cod", depositNote: null },
    { id: "bp-2", organizationId: "org-2", depositMode: null, depositPercent: null, depositFixedMinor: null, depositAppliesTo: "cod", depositNote: null },
  ];
  const services: Row[] = [];
  const staffRows: Row[] = [];
  const availabilities: Row[] = [];
  const bookings: Row[] = [];
  const customers: Row[] = [];
  let seq = 0;
  const nid = (p: string) => `${p}-${++seq}`;

  const attach = (table: string, row: Row | null, include: any): any => {
    if (!row) return null;
    const out: Row = { ...row };
    if (!include) return out;
    if (table === "membership" && include.user) {
      out.user = users.find((u) => u.id === row.userId) ?? null;
    }
    if (table === "serviceStaff" && include.membership) {
      const m = memberships.find((x) => x.id === row.membershipId) ?? null;
      out.membership = m ? attach("membership", m, include.membership.include) : null;
    }
    if (table === "serviceBooking") {
      if (include.service) out.service = services.find((s) => s.id === row.serviceId) ?? null;
      if (include.staff) {
        const s = staffRows.find((x) => x.id === row.staffId) ?? null;
        out.staff = s ? attach("serviceStaff", s, include.staff.include) : null;
      }
    }
    return out;
  };

  const generic = (rows: Row[], prefix: string, table: string) => ({
    findFirst: jest.fn(async ({ where, include }: any = {}) =>
      attach(table, rows.find((r) => matches(r, where)) ?? null, include)),
    findMany: jest.fn(async ({ where, orderBy, include }: any = {}) => {
      const found = rows.filter((r) => matches(r, where ?? {}));
      return sortRows(found, orderBy).map((r) => attach(table, r, include));
    }),
    create: jest.fn(async ({ data, include }: any) => {
      const row = { id: nid(prefix), createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return attach(table, row, include);
    }),
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data) rows.push({ id: nid(prefix), createdAt: new Date(), updatedAt: new Date(), ...d });
      return { count: data.length };
    }),
    update: jest.fn(async ({ where, data, include }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return attach(table, row, include);
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); count += 1; }
      return { count };
    }),
  });

  const prisma: any = {
    organization: generic(organizations, "org", "organization"),
    membership: generic(memberships, "mem", "membership"),
    businessProfile: generic(businessProfiles, "bp", "businessProfile"),
    serviceOffering: generic(services, "svc", "serviceOffering"),
    serviceStaff: generic(staffRows, "stf", "serviceStaff"),
    staffAvailability: generic(availabilities, "avl", "staffAvailability"),
    serviceBooking: generic(bookings, "bkg", "serviceBooking"),
    customer: generic(customers, "cst", "customer"),
  };
  prisma.$transaction = async function (cb: any) { return cb(prisma); };

  const audit = { log: jest.fn(async () => undefined) };
  const sendShopSms = opts.sms ?? jest.fn(async () => ({ sent: true }));
  const shopAccounts = { sendShopSms };
  const svc = new BookingService(prisma as any, audit as any, shopAccounts as any);
  return {
    svc, prisma, audit, sendShopSms,
    tables: { organizations, users, memberships, businessProfiles, services, staffRows, availabilities, bookings, customers },
  };
}

/** org-1 with one service (60 min, ৳1000), one staff, Monday 10:00–14:00 availability. */
async function seedBasic(fx: ReturnType<typeof setup>) {
  const service: any = await fx.svc.createService("org-1", "u1", {
    name: "হেয়ারকাট", durationMinutes: 60, priceMinor: "100000", bufferMinutes: 0,
  });
  const staff: any = await fx.svc.addStaff("org-1", "u1", { membershipId: "m1" });
  await fx.svc.setAvailability("org-1", "u1", staff.id, {
    rows: [{ weekday: 1, startMinute: 600, endMinute: 840 }],
  });
  return { service, staff };
}

const MON = "2026-10-19"; // Monday
const at = (hhmm: string) => new Date(`2026-10-19T${hhmm}:00.000Z`); // UTC wall = Dhaka - 6h

describe("computeSlots — pure slot math", () => {
  const base = {
    date: MON, timezone: "Asia/Dhaka",
    availabilityRows: [{ weekday: 1, startMinute: 600, endMinute: 840 }],
    durationMinutes: 60, bufferMinutes: 0,
  };

  it("window minus booking (buffer 0): touching boundaries stay free", () => {
    const slots = computeSlots({
      ...base,
      bookings: [{ startAt: at("05:00"), endAt: at("06:00"), status: "confirmed" }], // 11:00–12:00 Dhaka
    });
    expect(slots).toEqual([
      "2026-10-19T04:00:00.000Z", // 10:00
      "2026-10-19T06:00:00.000Z", // 12:00
      "2026-10-19T07:00:00.000Z", // 13:00
    ]);
  });

  it("buffer expands the blocked interval on both sides", () => {
    const slots = computeSlots({
      ...base, bufferMinutes: 15,
      bookings: [{ startAt: at("05:00"), endAt: at("06:00"), status: "confirmed" }],
    });
    // Blocked 10:45–12:15 Dhaka → only 13:00 survives.
    expect(slots).toEqual(["2026-10-19T07:00:00.000Z"]);
  });

  it("a slot crossing the window end is excluded", () => {
    const slots = computeSlots({ ...base, durationMinutes: 90, bookings: [] });
    expect(slots).toEqual(["2026-10-19T04:00:00.000Z", "2026-10-19T05:30:00.000Z"]);
  });

  it("weekday with no availability → []", () => {
    expect(computeSlots({ ...base, date: "2026-10-20", bookings: [] })).toEqual([]); // Tuesday
  });

  it("cancelled bookings do not block", () => {
    const slots = computeSlots({
      ...base,
      bookings: [{ startAt: at("05:00"), endAt: at("06:00"), status: "cancelled" }],
    });
    expect(slots).toHaveLength(4);
  });
});

describe("BookingService — services, staff, availability validation", () => {
  it("rejects out-of-range duration / negative price / bad buffer", async () => {
    const fx = setup();
    await expect(fx.svc.createService("org-1", "u1", { name: "X", durationMinutes: 3, priceMinor: "100" }))
      .rejects.toMatchObject({ code: "booking.theServiceDurationMustBeBetween" });
    await expect(fx.svc.createService("org-1", "u1", { name: "X", durationMinutes: 60, priceMinor: "-5" }))
      .rejects.toMatchObject({ code: "booking.theServicePriceCannotBeNegative" });
    await expect(fx.svc.createService("org-1", "u1", { name: "X", durationMinutes: 60, priceMinor: "100", bufferMinutes: 999 }))
      .rejects.toMatchObject({ code: "booking.theBufferTimeMustBeBetween" });
  });

  it("staff add refuses a foreign or non-ACTIVE membership", async () => {
    const fx = setup();
    await expect(fx.svc.addStaff("org-1", "u1", { membershipId: "m2" })).rejects.toMatchObject({ code: "booking.theMemberDoesNotBelongTo" });
    await expect(fx.svc.addStaff("org-1", "u1", { membershipId: "m3" })).rejects.toMatchObject({ code: "booking.onlyAnActiveMemberCanBe" });
    const ok: any = await fx.svc.addStaff("org-1", "u1", { membershipId: "m1" });
    expect(ok.memberName).toBe("রাবেয়া সুলতানা");
    expect(ok.memberEmail).toBe("rabeya@example.com");
  });

  it("availability refuses inverted and overlapping rows", async () => {
    const fx = setup();
    const staff: any = await fx.svc.addStaff("org-1", "u1", { membershipId: "m1" });
    await expect(fx.svc.setAvailability("org-1", "u1", staff.id, {
      rows: [{ weekday: 1, startMinute: 700, endMinute: 600 }],
    })).rejects.toMatchObject({ code: "booking.theTimeRangeMustBeValid" });
    await expect(fx.svc.setAvailability("org-1", "u1", staff.id, {
      rows: [
        { weekday: 1, startMinute: 600, endMinute: 720 },
        { weekday: 1, startMinute: 700, endMinute: 800 },
      ],
    })).rejects.toMatchObject({ code: "booking.twoTimeRangesOnTheSame" });
    // Failed writes replaced nothing.
    const after = await fx.svc.getAvailability("org-1", staff.id);
    expect(after.rows).toHaveLength(0);
  });
});

describe("BookingService — create, overlap, slots end-to-end", () => {
  it("getSlots reflects availability; a booking removes its slot", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    const before: any = await fx.svc.getSlots("org-1", { serviceId: service.id, staffId: staff.id, date: MON });
    expect(before.slots).toHaveLength(4);
    await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T05:00:00.000Z",
      guestName: "অতিথি", guestPhone: "01710000009",
    });
    const after: any = await fx.svc.getSlots("org-1", { serviceId: service.id, staffId: staff.id, date: MON });
    expect(after.slots).toEqual([
      "2026-10-19T04:00:00.000Z", "2026-10-19T06:00:00.000Z", "2026-10-19T07:00:00.000Z",
    ]);
  });

  it("overlap refused; touching boundary (end == start) succeeds", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T04:00:00.000Z", // 10:00–11:00 Dhaka
      guestName: "প্রথম", guestPhone: "01710000001",
    });
    await expect(fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T04:30:00.000Z",
      guestName: "দ্বিতীয়", guestPhone: "01710000002",
    })).rejects.toMatchObject({ code: "booking.theStaffMemberHasAnotherBooking" });
    const touching: any = await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T05:00:00.000Z", // starts exactly at first end
      guestName: "তৃতীয়", guestPhone: "01710000003",
    });
    expect(touching.status).toBe("pending");
    expect(touching.source).toBe("dashboard");
    expect(fx.tables.bookings).toHaveLength(2);
  });

  it("a cancelled booking frees the slot for a new create", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    const b: any = await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T04:00:00.000Z",
      guestName: "অতিথি", guestPhone: "01710000001",
    });
    await fx.svc.transitionBooking("org-1", "u1", b.id, "cancelled");
    const again: any = await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T04:00:00.000Z",
      guestName: "নতুন", guestPhone: "01710000005",
    });
    expect(again.status).toBe("pending");
  });
});

describe("BookingService — org isolation", () => {
  it("public surface of org B cannot see or book org A's service", async () => {
    const fx = setup();
    const { service } = await seedBasic(fx);
    const pub: any = await fx.svc.publicServices("shop-two");
    expect(pub.services).toHaveLength(0);
    await expect(fx.svc.publicSlots("shop-two", { serviceId: service.id, staffId: "x", date: MON }))
      .rejects.toMatchObject({ code: "booking.theServiceWasNotFound" });
    await expect(fx.svc.publicBook("shop-two", {
      serviceId: service.id, staffId: "x", date: MON, startTime: "10:00",
      guestName: "অতিথি", guestPhone: "01710000001",
    })).rejects.toMatchObject({ code: "booking.theServiceWasNotFound" });
    await expect(fx.svc.publicServices("no-such-shop")).rejects.toMatchObject({ code: "booking.theShopWasNotFound" });
  });

  it("tenant of org B cannot confirm org A's booking", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    const b: any = await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T04:00:00.000Z",
      guestName: "অতিথি", guestPhone: "01710000001",
    });
    await expect(fx.svc.transitionBooking("org-2", "u2", b.id, "confirmed"))
      .rejects.toMatchObject({ code: "booking.theBookingWasNotFound" });
    await expect(fx.svc.markDepositPaid("org-2", "u2", b.id)).rejects.toMatchObject({ code: "booking.theBookingWasNotFound" });
    expect(fx.tables.bookings[0].status).toBe("pending");
  });
});

describe("BookingService — guest → customer link + public booking", () => {
  it("same phone reuses ONE Customer row across two public bookings", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    const b1: any = await fx.svc.publicBook("shop-one", {
      serviceId: service.id, staffId: staff.id, date: MON, startTime: "10:00",
      guestName: "নুসরাত", guestPhone: "01712345678",
    });
    const b2: any = await fx.svc.publicBook("shop-one", {
      serviceId: service.id, staffId: staff.id, date: MON, startTime: "11:00",
      guestName: "নুসরাত", guestPhone: "01712345678",
    });
    expect(fx.tables.customers).toHaveLength(1);
    expect(fx.tables.customers[0].source).toBe("booking");
    expect(b1.customerId).toBe(fx.tables.customers[0].id);
    expect(b2.customerId).toBe(b1.customerId);
    expect(b1.source).toBe("storefront");
    expect(b1.status).toBe("pending");
  });

  it("public book validates the phone (10–15 digits)", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    await expect(fx.svc.publicBook("shop-one", {
      serviceId: service.id, staffId: staff.id, date: MON, startTime: "10:00",
      guestName: "অতিথি", guestPhone: "123",
    })).rejects.toMatchObject({ code: "booking.giveAValidPhoneNumber10" });
  });

  it("public slots response carries slots only — no booking details", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    await fx.svc.publicBook("shop-one", {
      serviceId: service.id, staffId: staff.id, date: MON, startTime: "10:00",
      guestName: "গোপন অতিথি", guestPhone: "01799999999",
    });
    const res: any = await fx.svc.publicSlots("shop-one", { serviceId: service.id, staffId: staff.id, date: MON });
    const json = JSON.stringify(res);
    expect(json).not.toContain("01799999999");
    expect(json).not.toContain("গোপন অতিথি");
    expect(res.slots).toHaveLength(3);
  });
});

describe("BookingService — deposit honesty", () => {
  it("percent config (appliesTo all) quotes the deposit as unpaid_manual; no config → not_required", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    const noCfg: any = await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T04:00:00.000Z",
      guestName: "অতিথি", guestPhone: "01710000001",
    });
    expect(noCfg.depositState).toBe("not_required");
    expect(noCfg.depositRequiredMinor).toBe("0");
    expect(noCfg.depositLabel).toContain("প্রয়োজন নেই");

    fx.tables.businessProfiles[0].depositMode = "percent";
    fx.tables.businessProfiles[0].depositPercent = 20;
    fx.tables.businessProfiles[0].depositAppliesTo = "all";
    const withCfg: any = await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T05:00:00.000Z",
      guestName: "অতিথি", guestPhone: "01710000002",
    });
    expect(withCfg.depositRequiredMinor).toBe("20000"); // 20% of ৳1000
    expect(withCfg.depositState).toBe("unpaid_manual");
    expect(withCfg.depositLabel).toContain("ম্যানুয়াল");
    expect(withCfg.depositLabel).toContain("কোনো অনলাইন পেমেন্ট নেওয়া হয়নি");
  });

  it("cod-only config does NOT quote a manual booking deposit", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    fx.tables.businessProfiles[0].depositMode = "fixed";
    fx.tables.businessProfiles[0].depositFixedMinor = 50000n;
    fx.tables.businessProfiles[0].depositAppliesTo = "cod";
    const b: any = await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T04:00:00.000Z",
      guestName: "অতিথি", guestPhone: "01710000001",
    });
    expect(b.depositState).toBe("not_required");
  });

  it("markDepositPaid only from unpaid_manual, exactly to paid_manual", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    fx.tables.businessProfiles[0].depositMode = "percent";
    fx.tables.businessProfiles[0].depositPercent = 10;
    fx.tables.businessProfiles[0].depositAppliesTo = "all";
    const b: any = await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T04:00:00.000Z",
      guestName: "অতিথি", guestPhone: "01710000001",
    });
    const paid: any = await fx.svc.markDepositPaid("org-1", "u1", b.id);
    expect(paid.depositState).toBe("paid_manual");
    await expect(fx.svc.markDepositPaid("org-1", "u1", b.id)).rejects.toMatchObject({ code: "booking.thisBookingHasNoRemainingManual" });
    const auditCall = fx.audit.log.mock.calls.find((c: any[]) => c[0].action === "booking.deposit_paid");
    expect(auditCall).toBeTruthy();
  });

  it("depositLabelFor states the manual truth for every state", () => {
    expect(depositLabelFor("not_required", 0n)).toContain("প্রয়োজন নেই");
    expect(depositLabelFor("unpaid_manual", 20000n)).toContain("৳200");
    expect(depositLabelFor("paid_manual", 20000n)).toContain("পরিশোধিত");
  });
});

describe("BookingService — status transition guards", () => {
  it("pending → completed is refused; the legal path works; terminal states are frozen", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    const b: any = await fx.svc.createBookingFromDashboard("org-1", "u1", {
      serviceId: service.id, staffId: staff.id, startAt: "2026-10-19T04:00:00.000Z",
      guestName: "অতিথি", guestPhone: "01710000001",
    });
    await expect(fx.svc.transitionBooking("org-1", "u1", b.id, "completed"))
      .rejects.toMatchObject({ code: "booking.theBookingCannotBeMovedFrom" });
    const confirmed: any = await fx.svc.transitionBooking("org-1", "u1", b.id, "confirmed");
    expect(confirmed.status).toBe("confirmed");
    const noShow: any = await fx.svc.transitionBooking("org-1", "u1", b.id, "no_show");
    expect(noShow.status).toBe("no_show");
    await expect(fx.svc.transitionBooking("org-1", "u1", b.id, "cancelled"))
      .rejects.toMatchObject({ code: "booking.theBookingCannotBeMovedFrom" });
  });
});

describe("BookingService — reminder sweep exactly-once", () => {
  async function seedConfirmed(fx: ReturnType<typeof setup>, startAt: Date) {
    const { service, staff } = await seedBasic(fx);
    const b: any = await fx.svc.createBooking("org-1", {
      serviceId: service.id, staffId: staff.id, startAt,
      guestName: "অতিথি", guestPhone: "01710000001", source: "dashboard", actorId: "u1",
    });
    await fx.svc.transitionBooking("org-1", "u1", b.id, "confirmed");
    return b;
  }

  it("sends once through sendShopSms; a second sweep sends nothing", async () => {
    const fx = setup();
    const now = new Date("2026-10-19T00:00:00.000Z");
    await seedConfirmed(fx, new Date(now.getTime() + 2 * 3600_000));
    const first: any = await fx.svc.runReminderSweep("org-1", now);
    expect(first).toEqual({ checked: 1, sent: 1, failedNoChannel: 0, failedError: 0 });
    expect(fx.sendShopSms).toHaveBeenCalledTimes(1);
    expect(fx.tables.bookings[0].reminderStatus).toBe("sent");
    expect(fx.tables.bookings[0].reminderSentAt).toBeTruthy();
    const second: any = await fx.svc.runReminderSweep("org-1", now);
    expect(second.checked).toBe(0);
    expect(fx.sendShopSms).toHaveBeenCalledTimes(1);
  });

  it("no configured channel → failed_no_channel recorded, never resent", async () => {
    const fx = setup({
      sms: jest.fn(async () => ({ sent: false, notConfigured: true, reason: "no SMS sender configured" })),
    });
    const now = new Date("2026-10-19T00:00:00.000Z");
    await seedConfirmed(fx, new Date(now.getTime() + 3 * 3600_000));
    const first: any = await fx.svc.runReminderSweep("org-1", now);
    expect(first.failedNoChannel).toBe(1);
    expect(first.sent).toBe(0);
    expect(fx.tables.bookings[0].reminderStatus).toBe("failed_no_channel");
    expect(fx.tables.bookings[0].reminderSentAt).toBeTruthy();
    const second: any = await fx.svc.runReminderSweep("org-1", now);
    expect(second.checked).toBe(0);
    expect(fx.sendShopSms).toHaveBeenCalledTimes(1);
  });

  it("pending bookings and bookings beyond 24h are not reminded", async () => {
    const fx = setup();
    const { service, staff } = await seedBasic(fx);
    const now = new Date("2026-10-19T00:00:00.000Z");
    await fx.svc.createBooking("org-1", {
      serviceId: service.id, staffId: staff.id, startAt: new Date(now.getTime() + 3600_000),
      guestName: "অতিথি", guestPhone: "01710000001", source: "dashboard", actorId: "u1",
    }); // stays pending
    const far: any = await fx.svc.createBooking("org-1", {
      serviceId: service.id, staffId: staff.id, startAt: new Date(now.getTime() + 30 * 3600_000),
      guestName: "অতিথি", guestPhone: "01710000002", source: "dashboard", actorId: "u1",
    });
    await fx.svc.transitionBooking("org-1", "u1", far.id, "confirmed");
    const out: any = await fx.svc.runReminderSweep("org-1", now);
    expect(out.checked).toBe(0);
    expect(fx.sendShopSms).not.toHaveBeenCalled();
  });
});
