import { MessagingService } from "./messaging.service";
import {
  AudienceDefinitionError, validateAudienceDefinition, matchesAudienceDefinition, parseAddressList,
} from "./audience-rules";

/**
 * MS3 — Audience Builder v2: the strict pure validator, custom
 * definitions over customers/leads (DB order aggregates incl. the
 * no-orders null rule, RFM segments, tags, custom fields, address
 * keys), cursor-chunked base scans, saved-audience CRUD with the
 * deleted-saved honest failure, csv audiences (matched / unmatched
 * / invalid + snapshot send), and suppression on a custom
 * audience. Fake-prisma style like the MS1/MS2 specs; the fake
 * findMany HONOURS orderBy/cursor/skip/take so the chunk walk is
 * really exercised.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy, cursor, skip }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.id === "asc") out = [...out].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      if (cursor?.id) {
        const idx = out.findIndex((r) => r.id === cursor.id);
        if (idx >= 0) out = out.slice(idx + (skip ?? 0));
      }
      return take ? out.slice(0, take) : out;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) { Object.assign(row, data); row.updatedAt = new Date(); } return row; },
    upsert: async ({ where, update, create }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (row) { Object.assign(row, update); row.updatedAt = new Date(); return row; }
      const created = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(created); return created;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

const DAY = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const CUSTOMERS: any[] = [
  { id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman", email: "user1@example.com", phone: "01712345671", source: "facebook", createdAt: daysAgo(100), customFields: { tier: "gold", city: "Dhaka" }, address: { district: "Dhaka", city: "Dhaka" } },
  { id: "c2", organizationId: "org-1", firstName: "Babul", lastName: null, email: "user2@example.com", phone: null, source: "website", createdAt: daysAgo(10), customFields: { tier: "silver" }, address: { district: "Khulna" } },
  { id: "c3", organizationId: "org-1", firstName: "Chitra", lastName: null, email: null, phone: "01712345673", source: "facebook", createdAt: daysAgo(200), customFields: {}, address: null },
  { id: "c4", organizationId: "org-1", firstName: "Dulal", lastName: null, email: "user4@example.com", phone: "01712345674", source: "walk-in", createdAt: daysAgo(30), customFields: { tier: "gold" }, address: { district: "Dhaka North" } },
  { id: "c5", organizationId: "org-1", firstName: "Esha", lastName: null, email: "user5@example.com", phone: "01712345675", source: "website", createdAt: daysAgo(400), customFields: {}, address: null },
  { id: "c6", organizationId: "org-1", firstName: "Farid", lastName: null, email: "user6@example.com", phone: "01712345676", source: "website", createdAt: daysAgo(390), customFields: {}, address: null },
  { id: "c7", organizationId: "org-1", firstName: "Gita", lastName: null, email: "user7@example.com", phone: "01712345677", source: "website", createdAt: daysAgo(380), customFields: {}, address: null },
  { id: "c8", organizationId: "org-1", firstName: "Hasan", lastName: null, email: "user8@example.com", phone: "01712345678", source: "website", createdAt: daysAgo(370), customFields: {}, address: null },
];

const LEADS: any[] = [
  { id: "l1", organizationId: "org-1", name: "Lead One", email: "lead1@example.com", phone: "01812345671", stage: "new", tags: ["vip", "eid"], valueMinor: 5000, source: "facebook", createdAt: daysAgo(5), customFields: { interest: "shoes" } },
  { id: "l2", organizationId: "org-1", name: "Lead Two", email: "lead2@example.com", phone: null, stage: "won", tags: ["regular"], valueMinor: 100, source: "website", createdAt: daysAgo(50), customFields: {} },
  { id: "l3", organizationId: "org-1", name: "Lead Three", email: null, phone: "01812345673", stage: "new", tags: [], valueMinor: null, source: "website", createdAt: daysAgo(90), customFields: {} },
];

function orderRows(): any[] {
  const rows: any[] = [];
  let seq = 0;
  const add = (customerId: string, count: number, eachMinor: number, lastDaysAgo: number, status = "completed") => {
    for (let i = 0; i < count; i++) {
      rows.push({
        id: `o${++seq}`, organizationId: "org-1", customerId, status,
        totalMinor: eachMinor, placedAt: daysAgo(lastDaysAgo + i), createdAt: daysAgo(lastDaysAgo + i),
      });
    }
  };
  add("c1", 3, 166667, 5);            // 3 orders, ~500001 total, last 5d ago
  add("c3", 1, 10000, 90);            // 1 order
  add("c4", 2, 999999, 1, "cancelled"); // cancelled only → aggregates read as ZERO orders
  add("c5", 10, 200000, 1);           // champion material
  add("c6", 6, 100000, 2);            // loyal, not champion (f=4, m=3)
  add("c7", 5, 160000, 3);
  add("c8", 2, 25000, 60);
  return rows;
}

function makeOrderTable(rows: any[]) {
  return {
    rows,
    groupBy: async ({ by, where }: any) => {
      const filtered = rows.filter((r) => {
        if (r.organizationId !== where.organizationId) return false;
        if (where.status?.not && r.status === where.status.not) return false;
        if (where.customerId?.not === null && (r.customerId === null || r.customerId === undefined)) return false;
        if (where.placedAt?.not === null && (r.placedAt === null || r.placedAt === undefined)) return false;
        if (where.placedAt === null && r.placedAt !== null && r.placedAt !== undefined) return false;
        return true;
      });
      const groups = new Map<string, any>();
      for (const r of filtered) {
        const key = r[by[0]];
        const g = groups.get(key) ?? { customerId: key, count: 0, sum: 0, maxPlaced: null, maxCreated: null };
        g.count += 1; g.sum += Number(r.totalMinor ?? 0);
        if (r.placedAt && (!g.maxPlaced || r.placedAt > g.maxPlaced)) g.maxPlaced = r.placedAt;
        if (r.createdAt && (!g.maxCreated || r.createdAt > g.maxCreated)) g.maxCreated = r.createdAt;
        groups.set(key, g);
      }
      return [...groups.values()].map((g) => ({
        customerId: g.customerId,
        _count: { _all: g.count },
        _sum: { totalMinor: g.sum },
        _max: { placedAt: g.maxPlaced, createdAt: g.maxCreated },
      }));
    },
  };
}

function build() {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    messagingSavedAudience: makeTable("saud"), messagingSenderConfig: makeTable("scfg"),
    order: makeOrderTable(orderRows()),
  };
  for (const c of CUSTOMERS) tables.customer.rows.push({ ...c });
  for (const l of LEADS) tables.lead.rows.push({ ...l });
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = { findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }) };
  const calls: { to: string; subject: string; text: string }[] = [];
  const email = {
    isConfigured: () => true,
    send: async ({ to, subject, text }: any) => { calls.push({ to, subject, text }); return { providerMessageId: `<id-${to}>` }; },
  } as any;
  const smsCalls: { to: string; text: string }[] = [];
  const sms = {
    isConfigured: () => true,
    send: async ({ to, text }: any) => { smsCalls.push({ to, text }); return { providerMessageId: `sms-${to}` }; },
  } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables, calls, smsCalls };
}

const ids = (rows: any[]) => rows.map((r) => r.id).sort();

describe("MS3 validator (pure)", () => {
  it("rejects an unknown field and an unknown op with verbatim messages", () => {
    expect(() => validateAudienceDefinition({ entity: "customers", conditions: [{ field: "shoe_size", op: "eq", value: "42" }] }))
      .toThrow(AudienceDefinitionError);
    expect(() => validateAudienceDefinition({ entity: "customers", conditions: [{ field: "shoe_size", op: "eq", value: "42" }] }))
      .toThrow(/not a valid customers field/);
    expect(() => validateAudienceDefinition({ entity: "leads", conditions: [{ field: "stage", op: "contains", value: "new" }] }))
      .toThrow(/does not support op "contains"/);
    expect(() => validateAudienceDefinition({ entity: "leads", conditions: [{ field: "orders_count", op: "gte", value: 1 }] }))
      .toThrow(/not a valid leads field/);
    expect(() => validateAudienceDefinition({ entity: "customers", conditions: [{ field: "source", op: "regex", value: "x" }] }))
      .toThrow(/not a valid operator/);
  });

  it("rejects >20 conditions, a keyless custom_field, a mistyped value and a bad RFM segment", () => {
    const many = Array.from({ length: 21 }, () => ({ field: "source", op: "eq", value: "x" }));
    expect(() => validateAudienceDefinition({ entity: "customers", conditions: many })).toThrow(/at most 20 conditions/);
    expect(() => validateAudienceDefinition({ entity: "customers", conditions: [{ field: "custom_field", op: "eq", value: "gold" }] }))
      .toThrow(/needs a non-empty "key"/);
    expect(() => validateAudienceDefinition({ entity: "customers", conditions: [{ field: "orders_count", op: "gte", value: "3" }] }))
      .toThrow(/needs a numeric value/);
    expect(() => validateAudienceDefinition({ entity: "customers", conditions: [{ field: "rfm_segment", op: "eq", value: "whales" }] }))
      .toThrow(/rfm_segment must be one of/);
    expect(() => validateAudienceDefinition({ entity: "orders", conditions: [] })).toThrow(/entity must be/);
  });

  it("accepts a valid definition and normalizes match default", () => {
    const def = validateAudienceDefinition({ entity: "leads", conditions: [{ field: "tag", op: "contains", value: "vip" }] });
    expect(def.match).toBe("all");
    expect(def.conditions).toHaveLength(1);
  });

  it("match any vs all in the pure evaluator", () => {
    const facts: any = { source: "facebook", createdDaysAgo: 5, hasEmail: true, hasPhone: false, customFields: null };
    const conds = [
      { field: "source", op: "eq", value: "facebook" },
      { field: "has_phone", op: "eq", value: true },
    ];
    expect(matchesAudienceDefinition({ entity: "customers", match: "all", conditions: conds }, facts)).toBe(false);
    expect(matchesAudienceDefinition({ entity: "customers", match: "any", conditions: conds }, facts)).toBe(true);
  });

  it("parseAddressList splits, strips quotes and dedupes", () => {
    expect(parseAddressList("a@x.com\nB@x.com, a@x.com; \"c@x.com\"")).toEqual(["a@x.com", "B@x.com", "c@x.com"]);
    // Dedupe here is by exact digits; the two FORMS of one number
    // both survive parsing and are unified at resolve time (the
    // csv dedupe test below proves one recipient, not two).
    expect(parseAddressList(["01712345671", "+880 1712-345671"])).toEqual(["01712345671", "+880 1712-345671"]);
    expect(parseAddressList("")).toEqual([]);
  });
});

describe("MS3 custom audience — customers", () => {
  it("order aggregates: orders_count / total_spent, and cancelled-only counts as zero", async () => {
    const { svc } = build();
    const many = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "orders_count", op: "gte", value: 2 }] },
    });
    expect(ids(many)).toEqual(["c1", "c5", "c6", "c7", "c8"]);
    const spent = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "total_spent_minor", op: "gte", value: 1000000 }] },
    });
    expect(ids(spent)).toEqual(["c5"]);
  });

  it("no-orders null rule: orders_count eq 0 matches never-ordered; last_order_days_ago never matches them", async () => {
    const { svc } = build();
    const zero = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "orders_count", op: "eq", value: 0 }] },
    });
    expect(ids(zero)).toEqual(["c2", "c4"]); // c4's orders are all cancelled → zero; c3 has no email
    const recent = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "last_order_days_ago", op: "lte", value: 10 }] },
    });
    expect(ids(recent)).toEqual(["c1", "c5", "c6", "c7"]); // null (c2/c4) is FALSE, never "recent"
  });

  it("source + has_email, custom_field and address_key conditions", async () => {
    const { svc } = build();
    const fb = await svc.resolveAudience("org-1", "sms", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "source", op: "eq", value: "facebook" }] },
    });
    expect(ids(fb)).toEqual(["c1", "c3"]);
    const gold = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "custom_field", op: "eq", key: "tier", value: "gold" }] },
    });
    expect(ids(gold)).toEqual(["c1", "c4"]);
    const dhaka = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "address_key", op: "contains", key: "district", value: "Dhaka" }] },
    });
    expect(ids(dhaka)).toEqual(["c1", "c4"]);
    const dhakaExact = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "address_key", op: "eq", key: "district", value: "Dhaka" }] },
    });
    expect(ids(dhakaExact)).toEqual(["c1"]);
    const old = await svc.resolveAudience("org-1", "sms", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "created_days_ago", op: "gte", value: 100 }] },
    });
    expect(ids(old)).toEqual(["c1", "c3", "c5", "c6", "c7", "c8"]);
  });

  it("rfm_segment condition reuses computeRfm (champions = the heavy recent buyer)", async () => {
    const { svc } = build();
    const champs = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "rfm_segment", op: "eq", value: "champions" }] },
    });
    expect(ids(champs)).toEqual(["c5"]);
  });

  it("an invalid definition at resolve is a 400, never a silent widening", async () => {
    const { svc } = build();
    await expect(svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "nope", op: "eq", value: "x" }] },
    })).rejects.toThrow(/not a valid customers field/);
  });
});

describe("MS3 custom audience — leads", () => {
  it("stage / tag contains / value_minor with the null rule", async () => {
    const { svc } = build();
    const fresh = await svc.resolveAudience("org-1", "sms", "custom", undefined, undefined, {
      audienceDefinition: { entity: "leads", match: "all", conditions: [{ field: "stage", op: "eq", value: "new" }] },
    });
    expect(ids(fresh)).toEqual(["l1", "l3"]);
    const vip = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "leads", match: "all", conditions: [{ field: "tag", op: "contains", value: "vip" }] },
    });
    expect(ids(vip)).toEqual(["l1"]);
    const valuable = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "leads", match: "all", conditions: [{ field: "value_minor", op: "gte", value: 1000 }] },
    });
    expect(ids(valuable)).toEqual(["l1"]); // l3's null value never matches
    const any = await svc.resolveAudience("org-1", "email", "custom", undefined, undefined, {
      audienceDefinition: { entity: "leads", match: "any", conditions: [
        { field: "stage", op: "eq", value: "won" }, { field: "tag", op: "contains", value: "vip" },
      ] },
    });
    expect(ids(any)).toEqual(["l1", "l2"]);
  });
});

describe("MS3 chunked scan", () => {
  it("walks >500 rows fully via cursor chunks (no unbounded findMany)", async () => {
    const { svc, tables } = build();
    tables.customer.rows.length = 0;
    for (let i = 0; i < 1200; i++) {
      tables.customer.rows.push({
        id: `bulk-${String(i).padStart(4, "0")}`, organizationId: "org-1", firstName: `Bulk${i}`, lastName: null,
        email: `bulk${i}@example.com`, phone: null, source: "import", createdAt: daysAgo(3), customFields: {}, address: null,
      });
    }
    let customerFindManyCalls = 0;
    const orig = tables.customer.findMany;
    tables.customer.findMany = async (args: any) => { customerFindManyCalls++; return orig(args); };
    const recipients = await svc.resolveAudience("org-1", "email", "customers");
    expect(recipients).toHaveLength(1200);
    expect(customerFindManyCalls).toBe(3); // 500 + 500 + 200
  });
});

describe("MS3 saved audiences", () => {
  const DEF = { entity: "customers", match: "all", conditions: [{ field: "source", op: "eq", value: "facebook" }] };

  it("CRUD: create validates, list/update/delete work, resolve reads the saved definition", async () => {
    const { svc, tables } = build();
    await expect(svc.createSavedAudience("org-1", "owner", { name: "Bad", definition: { entity: "customers", conditions: [{ field: "nope", op: "eq", value: "x" }] } }))
      .rejects.toThrow(/not a valid customers field/);
    const created: any = await svc.createSavedAudience("org-1", "owner", { name: "FB customers", definition: DEF });
    expect(created.id).toBeTruthy();
    expect(tables.messagingSavedAudience.rows).toHaveLength(1);
    const renamed: any = await svc.updateSavedAudience("org-1", "owner", created.id, { name: "FB folks" });
    expect(renamed.name).toBe("FB folks");
    const list = await svc.listSavedAudiences("org-1");
    expect(list).toHaveLength(1);
    const preview = await svc.previewBroadcast("org-1", { channel: "sms", audienceType: "saved", audienceSavedId: created.id });
    expect(preview.total).toBe(2); // c1 + c3 have phones
    await expect(svc.updateSavedAudience("org-1", "owner", "missing-id", { name: "x" })).rejects.toThrow(/not found/);
  });

  it("deleting a saved audience a DRAFT references: allowed; preview + send then fail honestly", async () => {
    const { svc } = build();
    const created: any = await svc.createSavedAudience("org-1", "owner", { name: "FB customers", definition: DEF });
    const bc: any = await svc.createBroadcast("org-1", "owner", {
      name: "Saved send", channel: "email", subject: "Hi", body: "Hello {{name}}",
      audienceType: "saved", audienceSavedId: created.id,
    });
    expect(bc.audienceSavedId).toBe(created.id);
    await svc.deleteSavedAudience("org-1", "owner", created.id);
    await expect(svc.previewBroadcast("org-1", { channel: "email", audienceType: "saved", audienceSavedId: created.id }))
      .rejects.toThrow(/Saved audience no longer exists/);
    await expect(svc.sendBroadcast("org-1", "owner", bc.id)).rejects.toThrow(/Saved audience no longer exists/);
  });
});

describe("MS3 csv audience", () => {
  it("preview splits matched / unmatched / invalid and reports invalidCount", async () => {
    const { svc } = build();
    const preview = await svc.previewBroadcast("org-1", {
      channel: "email", audienceType: "csv",
      audienceCsv: "user1@example.com\nnewperson@example.com\nnot-an-email\nUSER2@example.com",
    });
    expect(preview.invalidCount).toBe(1);
    expect(preview.audienceTotal).toBe(3);
    expect(preview.total).toBe(3);
    expect(preview.sample.map((s: any) => s.type).sort()).toEqual(["csv", "customer", "customer"]);
  });

  it("phone csv matches customers across local and +880 forms; junk is counted invalid", async () => {
    const { svc } = build();
    const preview = await svc.previewBroadcast("org-1", {
      channel: "sms", audienceType: "csv",
      audienceCsv: "01712345671, +8801712345674, 999",
    });
    expect(preview.invalidCount).toBe(1);
    expect(preview.total).toBe(2); // c1 (local form) + c4 (+880 form)
    expect(preview.sample.every((s: any) => s.type === "customer")).toBe(true);
  });

  it("the same customer pasted in two phone forms is ONE recipient, never a double send", async () => {
    const { svc } = build();
    const preview = await svc.previewBroadcast("org-1", {
      channel: "sms", audienceType: "csv",
      audienceCsv: "01712345671\n+8801712345671",
    });
    expect(preview.total).toBe(1);
    expect(preview.sample[0].type).toBe("customer");
  });

  it("a csv recipient reaches the snapshot and sends; its delivery records recipientId null", async () => {
    const { svc, tables, calls } = build();
    const bc: any = await svc.createBroadcast("org-1", "owner", {
      name: "CSV send", channel: "email", subject: "Hi", body: "Hello {{name}}",
      audienceType: "csv", audienceCsv: "user1@example.com\nnewperson@example.com",
    });
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("sent");
    expect(calls.map((c) => c.to).sort()).toEqual(["newperson@example.com", "user1@example.com"]);
    const row = tables.broadcast.rows.find((r: any) => r.id === bc.id);
    const csvEntry = row.recipientSnapshot.find((e: any) => e.type === "csv");
    expect(csvEntry).toBeTruthy();
    expect(csvEntry.id).toBe("newperson@example.com"); // snapshot key = normalized address
    const deliveries = tables.messageDelivery.rows.filter((d: any) => d.broadcastId === bc.id);
    const csvDelivery = deliveries.find((d: any) => d.recipientType === "csv");
    expect(csvDelivery.recipientId).toBeNull();
    expect(csvDelivery.address).toBe("newperson@example.com");
    const custDelivery = deliveries.find((d: any) => d.recipientType === "customer");
    expect(custDelivery.recipientId).toBe("c1");
  });

  it("an over-cap csv list is refused at create, never truncated", async () => {
    const { svc } = build();
    const big = Array.from({ length: 5001 }, (_, i) => `person${i}@example.com`).join("\n");
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "Too big", channel: "email", subject: "Hi", body: "Hello",
      audienceType: "csv", audienceCsv: big,
    })).rejects.toThrow(/cap of 5000/);
  });
});

describe("MS3 suppression on a custom audience", () => {
  it("an opted-out custom-audience member is dropped and counted like any other", async () => {
    const { svc } = build();
    await svc.setPreference("org-1", { channel: "email", address: "user1@example.com", status: "opted_out", source: "manual" });
    const preview = await svc.previewBroadcast("org-1", {
      channel: "email", audienceType: "custom",
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "source", op: "eq", value: "facebook" }] },
    });
    expect(preview.audienceTotal).toBe(1); // only c1 (c3 has no email)
    expect(preview.excludedSuppressedCount).toBe(1);
    expect(preview.total).toBe(0);
  });
});
