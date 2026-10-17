import { MessagingService, validateOnsiteUrl } from "./messaging.service";

/**
 * MX14 — On-site notifications as a Messaging broadcast channel.
 *
 * Fake-prisma style like mx12/mx13. There is NO send port for
 * this channel: the send IS a database write into the
 * OnsiteNotification table (the customer's shop-account
 * notification center), and the linked MessageDelivery is
 * written by the service itself with deliveryStatus
 * "delivered" at creation. Resolution reads Customer rows
 * only — leads/csv/custom/saved can never name a
 * notification-center account.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("gt" in v && !(row[k] > v.gt)) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("contains" in v && !String(row[k] ?? "").includes(v.contains)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  out.sort((a, b) => {
    for (const spec of specs) {
      for (const [key, dir] of Object.entries(spec)) {
        const av = a[key]; const bv = b[key];
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
  return out;
}

function project(row: any, select: any): any {
  if (!select) return row;
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, select }: any = {}) => {
      const row = rows.find((r) => matches(r, where ?? {})) ?? null;
      return row ? project(row, select) : null;
    },
    findMany: async ({ where, take, orderBy, cursor, skip, select }: any = {}) => {
      let out = sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (cursor?.id) {
        const pos = out.findIndex((r) => r.id === cursor.id);
        if (pos >= 0) out = out.slice(pos + (skip ?? 0));
      } else if (skip) {
        out = out.slice(skip);
      }
      if (take) out = out.slice(0, take);
      return out.map((r) => project(r, select));
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let n = 0;
      for (const row of rows) if (matches(row, where ?? {})) { Object.assign(row, data); row.updatedAt = new Date(); n++; }
      return { count: n };
    },
    deleteMany: async ({ where }: any) => {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); n++; }
      return { count: n };
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
  };
}

function makeRecipientTable() {
  const table: any = makeTable("bcr");
  table.createMany = async ({ data, skipDuplicates }: any) => {
    let count = 0;
    for (const d of data) {
      const dupe = table.rows.some((r: any) => r.broadcastId === d.broadcastId && r.dedupeKey === d.dedupeKey);
      if (dupe) {
        if (skipDuplicates) continue;
        throw new Error("Unique constraint failed on the fields: (`broadcastId`,`dedupeKey`)");
      }
      table.rows.push({ id: `bcr-${table.rows.length + 1}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), updatedAt: new Date(), ...d });
      count++;
    }
    return { count };
  };
  return table;
}

function makeOrderTable() {
  const table: any = makeTable("ord");
  // Minimal groupBy for computeRfm (count/sum/max per customerId).
  table.groupBy = async ({ by, where }: any) => {
    const filtered = table.rows.filter((r: any) => matches(r, where ?? {}));
    const groups = new Map<string, any>();
    for (const r of filtered) {
      const key = r[by[0]];
      const g = groups.get(key) ?? { [by[0]]: key, _count: { _all: 0 }, _sum: { totalMinor: 0n }, _max: { placedAt: null, createdAt: null } };
      g._count._all++;
      g._sum.totalMinor += BigInt(r.totalMinor ?? 0);
      for (const f of ["placedAt", "createdAt"]) {
        const v = r[f] ? new Date(r[f]) : null;
        if (v && (!g._max[f] || v.getTime() > new Date(g._max[f]).getTime())) g._max[f] = v;
      }
      groups.set(key, g);
    }
    return [...groups.values()];
  };
  return table;
}

function build() {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    broadcastRecipient: makeRecipientTable(),
    onsiteNotification: makeTable("onsite"),
    order: makeOrderTable(),
    messageLinkClick: makeTable("click"),
  };
  // customer-3 has NO email/phone at all — onsite needs no
  // contact address (the customer id IS the address), so this
  // customer is still reachable in their notification center.
  tables.customer.rows.push(
    { id: "customer-1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman", email: "ayesha@example.com", phone: "01712345671" },
    { id: "customer-2", organizationId: "org-1", firstName: "Tanvir", lastName: null, email: "tanvir@example.com", phone: "01712345672" },
    { id: "customer-3", organizationId: "org-1", firstName: "Noor", lastName: null, email: null, phone: null },
    { id: "customer-9", organizationId: "org-2", firstName: "Other", lastName: "Org", email: "other@example.com", phone: "01712345679" },
  );
  tables.lead.rows.push(
    { id: "lead-1", organizationId: "org-1", name: "Lead Rahim", email: "rahim@example.com", phone: "01712345673", stage: "qualified" },
  );
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = {
    findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }),
  };
  const email = { isConfigured: () => true, send: async () => ({ providerMessageId: "<unused>" }) } as any;
  const sms = { isConfigured: () => false, send: async () => { throw new Error("SMS is not configured"); } } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables };
}

async function draftOnsite(svc: MessagingService, extra: Record<string, unknown> = {}) {
  return svc.createBroadcast("org-1", "owner", {
    name: "Eid onsite", channel: "onsite", subject: "ঈদ অফার, {{name}}!", body: "হ্যালো {{name}}, দোকানে ঈদ অফার চলছে!",
    audienceType: "customers", onsiteUrl: "/sale",
    ...extra,
  } as any);
}

const rowsOf = (tables: any, broadcastId: string) =>
  tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === broadcastId);
const deliveriesOf = (tables: any, broadcastId: string) =>
  tables.messageDelivery.rows.filter((r: any) => r.broadcastId === broadcastId);
const notifsOf = (tables: any, broadcastId: string) =>
  tables.onsiteNotification.rows.filter((r: any) => r.broadcastId === broadcastId);

describe("MX14 validateOnsiteUrl — the shop-relative rule", () => {
  it("empty reads as null; a shop-relative path passes; absolute/protocol-relative/over-long are refused", () => {
    expect(validateOnsiteUrl(undefined)).toBeNull();
    expect(validateOnsiteUrl("")).toBeNull();
    expect(validateOnsiteUrl(" /sale ")).toBe("/sale");
    expect(() => validateOnsiteUrl("https://evil.example.com/x")).toThrow(/shop-relative/);
    expect(() => validateOnsiteUrl("//evil.example.com/x")).toThrow(/shop-relative/);
    expect(() => validateOnsiteUrl("sale")).toThrow(/shop-relative/);
    expect(() => validateOnsiteUrl(`/${"x".repeat(500)}`)).toThrow(/shop-relative/);
  });
});

describe("MX14 create validation", () => {
  it("accepts an onsite broadcast and stores title/body/onsiteUrl on the row", async () => {
    const { svc } = build();
    const bc: any = await draftOnsite(svc);
    expect(bc.channel).toBe("onsite");
    expect(bc.subject).toBe("ঈদ অফার, {{name}}!");
    expect(bc.onsiteUrl).toBe("/sale");
    expect(bc.status).toBe("draft");
    expect(svc.checkCompose({ channel: "onsite", subject: "t", body: "হ্যালো" }).warnings).toBeDefined();
  });

  it("refuses: no title, over-long title/body, a template, WhatsApp fields, a non-customer audience, an external URL, onsiteUrl on email, an enabled cascade, personalization", async () => {
    const { svc } = build();
    const base = { name: "x", channel: "onsite", subject: "t", body: "b", audienceType: "customers" } as any;
    await expect(svc.createBroadcast("org-1", "owner", { ...base, subject: undefined })).rejects.toThrow(/need a title/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, subject: "x".repeat(121) })).rejects.toThrow(/120/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, body: "x".repeat(2001) })).rejects.toThrow(/2000/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, templateId: "tpl-1" })).rejects.toThrow(/do not use message templates/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, whatsappTemplateId: "wa-1" })).rejects.toThrow(/only for WhatsApp/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, audienceType: "leads_stage", audienceStage: "qualified" })).rejects.toThrow(/shop customers only/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, audienceType: "csv", audienceCsv: "a@b.com" })).rejects.toThrow(/shop customers only/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, onsiteUrl: "https://evil.example.com" })).rejects.toThrow(/shop-relative/);
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "email", subject: "t", body: "b", audienceType: "customers", onsiteUrl: "/sale",
    } as any)).rejects.toThrow(/only allowed for onsite broadcasts/);
    await expect(svc.createBroadcast("org-1", "owner", {
      ...base, cascade: { enabled: true, channels: ["onsite", "sms"], smsBody: "fallback" },
    })).rejects.toThrow(/cascade/);
    await expect(svc.createBroadcast("org-1", "owner", {
      ...base, personalization: { uniqueCoupon: { kind: "percent", value: 10, expiryDays: 7, prefix: "EID" } },
    })).rejects.toThrow(/personalization is not available for onsite/);
  });

  it("edit: onsiteUrl re-validates (null clears), a template is refused, the merged title cap holds", async () => {
    const { svc } = build();
    const bc: any = await draftOnsite(svc);
    const edited: any = await svc.updateBroadcast("org-1", "owner", bc.id, { onsiteUrl: null } as any);
    expect(edited.onsiteUrl).toBeNull();
    await expect(svc.updateBroadcast("org-1", "owner", bc.id, { onsiteUrl: "https://evil.example.com" } as any)).rejects.toThrow(/shop-relative/);
    await expect(svc.updateBroadcast("org-1", "owner", bc.id, { templateId: "tpl-1" } as any)).rejects.toThrow(/do not use message templates/);
    await expect(svc.updateBroadcast("org-1", "owner", bc.id, { subject: "x".repeat(121) } as any)).rejects.toThrow(/120/);
    // Clone keeps the click URL (it is content).
    const reEdited: any = await svc.updateBroadcast("org-1", "owner", bc.id, { onsiteUrl: "/offer" } as any);
    expect(reEdited.onsiteUrl).toBe("/offer");
    const clone: any = await svc.cloneBroadcast("org-1", "owner", bc.id);
    expect(clone.onsiteUrl).toBe("/offer");
  });
});

describe("MX14 resolution — customers of the org only", () => {
  it("customers: every org customer resolves once (incl. the customer with no email/phone); other orgs and leads never resolve", async () => {
    const { svc, tables } = build();
    const bc: any = await draftOnsite(svc);
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    expect(prepared.totalRecipients).toBe(3);
    const rows = rowsOf(tables, bc.id);
    expect(rows.map((r: any) => r.recipientId).sort()).toEqual(["customer-1", "customer-2", "customer-3"]);
    expect(new Set(rows.map((r: any) => r.dedupeKey)).size).toBe(3);
    // The customer id is stamped into `address` at prepare
    // (the preference-store identity for onsite).
    expect(rows.find((r: any) => r.recipientId === "customer-3")?.address).toBe("customer-3");
    expect(rows.every((r: any) => r.recipientType === "customer")).toBe(true);
  });

  it("preview: counts customers, masks ids in the sample, and produces NO cost figure (no provider, no rate)", async () => {
    const { svc } = build();
    const preview: any = await svc.previewBroadcast("org-1", { channel: "onsite", audienceType: "customers" });
    expect(preview.total).toBe(3);
    expect(preview.costEstimate).toBeNull();
    expect(JSON.stringify(preview.sample)).not.toContain("customer-1");
  });

  it("segment: only customers in the named RFM segment resolve (same computeRfm source as every channel)", async () => {
    const { svc, tables } = build();
    // One recent order for customer-1 only → RFM segment "new".
    tables.order.rows.push({
      id: "ord-1", organizationId: "org-1", customerId: "customer-1", status: "delivered",
      totalMinor: 50000n, placedAt: new Date(), createdAt: new Date(),
    });
    const resolved: any = await svc.resolveBroadcastRecipients("org-1", { channel: "onsite", audienceType: "segment", audienceSegment: "new" });
    expect(resolved.recipients.map((r: any) => r.id)).toEqual(["customer-1"]);
    const none: any = await svc.resolveBroadcastRecipients("org-1", { channel: "onsite", audienceType: "segment", audienceSegment: "champions" });
    expect(none.recipients).toHaveLength(0);
  });

  it("opt-out (address = customer id) and pending preferences exclude; addPreference validates onsite ids", async () => {
    const { svc, tables } = build();
    await svc.setPreference("org-1", { channel: "onsite", address: "customer-2", status: "opted_out", source: "manual" });
    await svc.setPreference("org-1", { channel: "onsite", address: "customer-3", status: "pending", source: "signup_form" });
    const resolved: any = await svc.resolveBroadcastRecipients("org-1", { channel: "onsite", audienceType: "customers" });
    expect(resolved.recipients.map((r: any) => r.id)).toEqual(["customer-1"]);
    expect(resolved.excludedSuppressedCount).toBe(1);
    expect(resolved.excludedPendingCount).toBe(1);
    const pref = tables.messagePreference.rows.find((p: any) => p.channel === "onsite" && p.address === "customer-2");
    expect(pref?.status).toBe("opted_out");
    await expect(svc.addPreference("org-1", "owner", { channel: "onsite", address: "not an id", status: "opted_out" }))
      .rejects.toThrow(/Invalid onsite customer id/);
  });
});

describe("MX14 send — the notification create IS the delivery", () => {
  it("creates one notification + one delivered delivery per customer, with rendered title/body and the click URL", async () => {
    const { svc, tables } = build();
    const bc: any = await draftOnsite(svc);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("sent");
    expect(sent.sentCount).toBe(3);
    const notifs = notifsOf(tables, bc.id);
    expect(notifs).toHaveLength(3);
    const n1 = notifs.find((n: any) => n.customerId === "customer-1");
    expect(n1.title).toBe("ঈদ অফার, Ayesha Rahman!");
    expect(n1.body).toContain("হ্যালো Ayesha Rahman");
    expect(n1.url).toBe("/sale");
    expect(n1.readAt ?? null).toBeNull();
    const deliveries = deliveriesOf(tables, bc.id);
    expect(deliveries).toHaveLength(3);
    expect(deliveries.every((d: any) => d.channel === "onsite" && d.status === "sent")).toBe(true);
    expect(deliveries.every((d: any) => d.deliveryStatus === "delivered" && d.deliveredAt)).toBe(true);
    expect(deliveries.every((d: any) => d.providerMessageId === null || d.providerMessageId === undefined)).toBe(true);
    // The notification links its delivery (the read-stamp anchor).
    expect(n1.deliveryId).toBe(deliveries.find((d: any) => d.recipientId === "customer-1")?.id);
    // Report: delivered is REAL for onsite (= sent here), read
    // starts at a real 0, clicks/opened stay null, url carried.
    const report: any = await svc.getBroadcastReport("org-1", bc.id);
    expect(report.broadcast.onsiteUrl).toBe("/sale");
    expect(report.funnel.sent).toBe(3);
    expect(report.funnel.delivered).toBe(3);
    expect(report.funnel.read).toBe(0);
    expect(report.funnel.opened).toBeNull();
    expect(report.funnel.clickedRecipients).toBeNull();
    expect(report.funnel.totalClicks).toBeNull();
  });

  it("resume never duplicates: a partial process + a full process create each notification exactly once", async () => {
    const { svc, tables } = build();
    const bc: any = await draftOnsite(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const first: any = await svc.processBroadcast("org-1", bc.id, { maxEntries: 1 });
    expect(first.processed).toBe(1);
    expect(notifsOf(tables, bc.id)).toHaveLength(1);
    await svc.processBroadcast("org-1", bc.id);
    expect(notifsOf(tables, bc.id)).toHaveLength(3);
    expect(deliveriesOf(tables, bc.id)).toHaveLength(3);
  });

  it("a re-send to an already-notified customer (crash-resume calling the choke point again) returns sent WITHOUT a second notification or delivery", async () => {
    const { svc, tables } = build();
    const bc: any = await draftOnsite(svc);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    const again: any = await svc.sendToRecipient("org-1", {
      channel: "onsite", broadcastId: bc.id, subject: bc.subject, body: bc.body, onsiteUrl: "/sale",
      recipient: { type: "customer", id: "customer-1", name: "Ayesha Rahman", email: "ayesha@example.com", phone: "01712345671" } as any,
      vars: {},
    });
    expect(again.status).toBe("sent");
    expect(notifsOf(tables, bc.id)).toHaveLength(3);
    expect(deliveriesOf(tables, bc.id)).toHaveLength(3);
  });

  it("an opted-out customer is skipped at the single-send guard too (no notification created)", async () => {
    const { svc, tables } = build();
    await svc.setPreference("org-1", { channel: "onsite", address: "customer-1", status: "opted_out", source: "manual" });
    const bc: any = await draftOnsite(svc);
    const res: any = await svc.sendToRecipient("org-1", {
      channel: "onsite", broadcastId: bc.id, subject: "t", body: "b",
      recipient: { type: "customer", id: "customer-1", name: "Ayesha Rahman" } as any, vars: {},
    });
    expect(res.status).toBe("skipped");
    expect(tables.onsiteNotification.rows).toHaveLength(0);
  });

  it("quiet hours (MX3) defer an onsite broadcast — no notification created, recipients stay pending", async () => {
    const { svc, tables } = build();
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const nowParts = fmt.formatToParts(new Date());
    const nowMin = Number(nowParts.find((x) => x.type === "hour")?.value) * 60 + Number(nowParts.find((x) => x.type === "minute")?.value);
    const hhmm = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 1440) + 1440) % 1440 % 60).padStart(2, "0")}`;
    tables.messagingSetting.rows.push({
      id: "mset-1", organizationId: "org-1", frequencyCapPerDay: 0,
      quietHoursEnabled: true, quietHoursStart: hhmm(nowMin - 60), quietHoursEnd: hhmm(nowMin + 60),
    });
    const bc: any = await draftOnsite(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const result: any = await svc.processBroadcast("org-1", bc.id);
    expect(result.deferred).toBe("quiet_hours");
    expect(result.processed).toBe(0);
    expect(tables.onsiteNotification.rows).toHaveLength(0);
    expect(rowsOf(tables, bc.id).every((r: any) => r.status === "pending")).toBe(true);
  });

  it("test-send to a typed address is refused honestly (a test must not pollute a real customer's center)", async () => {
    const { svc } = build();
    const bc: any = await draftOnsite(svc);
    await expect(svc.testSendBroadcast("org-1", "owner", bc.id, "customer-1")).rejects.toThrow(/cannot be test-sent/);
  });
});
