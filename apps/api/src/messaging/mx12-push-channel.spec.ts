import { MessagingService, validatePushUrl } from "./messaging.service";

/**
 * MX12 — Web Push as a Messaging broadcast channel.
 *
 * Fake-prisma style like mx1-recipient-table.spec.ts (cursor /
 * sortIndex-aware findMany, count, createMany with the unique
 * constraint). The push SEND goes through a fake registered
 * PushSendPort — the port is the seam the webpush module
 * registers in production; here it records calls and returns
 * scripted real-shaped outcomes (sent / gone / failed). The
 * fake port's "gone" outcome does NOT touch any subscription
 * row (marking gone is the port IMPLEMENTATION's job, inside
 * the webpush module — its spec lives in the webpush suite);
 * this spec pins the MESSAGING side: resolution from active
 * subscriptions only, preference stages, delivery rows, the
 * funnel's null stages, resume semantics, quiet hours.
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

const EP = (n: string) => `https://push.example.com/sub/${n}`;

function build(opts?: {
  portOutcomes?: Map<string, { outcome: "sent" | "gone" | "failed"; statusCode?: number | null; error?: string }>;
  noPort?: boolean;
}) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    broadcastRecipient: makeRecipientTable(),
    webPushSubscription: makeTable("wps"),
    order: makeTable("ord"),
    messageLinkClick: makeTable("click"),
  };
  tables.customer.rows.push(
    { id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman", email: "ayesha@example.com", phone: "01712345671" },
    { id: "c2", organizationId: "org-1", firstName: "Tanvir", lastName: null, email: "tanvir@example.com", phone: "01712345672" },
  );
  // sub-1 + sub-2: TWO devices of customer c1. sub-3: customer
  // c2. sub-4: anonymous storefront visitor. sub-5: GONE — must
  // never be resolved.
  tables.webPushSubscription.rows.push(
    { id: "sub-1", organizationId: "org-1", endpoint: EP("1"), p256dh: "k1", auth: "a1", customerId: "c1", status: "active" },
    { id: "sub-2", organizationId: "org-1", endpoint: EP("2"), p256dh: "k2", auth: "a2", customerId: "c1", status: "active" },
    { id: "sub-3", organizationId: "org-1", endpoint: EP("3"), p256dh: "k3", auth: "a3", customerId: "c2", status: "active" },
    { id: "sub-4", organizationId: "org-1", endpoint: EP("4"), p256dh: "k4", auth: "a4", customerId: null, status: "active" },
    { id: "sub-5", organizationId: "org-1", endpoint: EP("5"), p256dh: "k5", auth: "a5", customerId: "c2", status: "gone" },
  );
  tables.systemSetting = {
    findUnique: async () => null,
  };
  tables.organization = {
    findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }),
  };
  const email = { isConfigured: () => true, send: async () => ({ providerMessageId: "<unused>" }) } as any;
  const sms = { isConfigured: () => false, send: async () => { throw new Error("SMS is not configured"); } } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  const portCalls: { subscriptionId: string; title: string; body: string; url?: string | null }[] = [];
  if (!opts?.noPort) {
    svc.registerPushSendPort({
      sendPush: async (_orgId: string, input: any) => {
        portCalls.push({ ...input });
        return opts?.portOutcomes?.get(input.subscriptionId) ?? { outcome: "sent", statusCode: 201 };
      },
    });
  }
  return { svc, tables, portCalls };
}

async function draftPush(svc: MessagingService, extra: Record<string, unknown> = {}) {
  return svc.createBroadcast("org-1", "owner", {
    name: "Eid push", channel: "push", subject: "ঈদ অফার {{name}}", body: "আজই দেখুন",
    audienceType: "push_subscribers", pushUrl: "/sale", ...extra,
  } as any);
}

const rowsOf = (tables: any, broadcastId: string) =>
  tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === broadcastId);
const deliveriesOf = (tables: any, broadcastId: string) =>
  tables.messageDelivery.rows.filter((r: any) => r.broadcastId === broadcastId);

describe("MX12 create validation", () => {
  it("accepts a push broadcast and stores title/body/pushUrl on the row", async () => {
    const { svc } = build();
    const bc: any = await draftPush(svc);
    expect(bc.channel).toBe("push");
    expect(bc.subject).toBe("ঈদ অফার {{name}}");
    expect(bc.pushUrl).toBe("/sale");
    expect(bc.status).toBe("draft");
  });

  it("refuses a push broadcast without a title, with an external pushUrl, and with an unresolvable audience type", async () => {
    const { svc } = build();
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "push", body: "b", audienceType: "push_subscribers",
    } as any)).rejects.toThrow(/need a title/);
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "push", subject: "t", body: "b", audienceType: "push_subscribers", pushUrl: "https://evil.example.com/x",
    } as any)).rejects.toThrow(/shop-relative/);
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "push", subject: "t", body: "b", audienceType: "leads_stage", audienceStage: "new",
    } as any)).rejects.toThrow(/not available for the push channel/);
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "email", subject: "t", body: "b", audienceType: "customers", pushUrl: "/sale",
    } as any)).rejects.toThrow(/only allowed for push broadcasts/);
  });

  it("refuses an enabled cascade on a push broadcast (cascade channels stay email/sms/whatsapp)", async () => {
    const { svc } = build();
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "push", subject: "t", body: "b", audienceType: "push_subscribers",
      cascade: { enabled: true, channels: ["push", "sms"], smsBody: "fallback" },
    } as any)).rejects.toThrow(/cascade/);
  });

  it("validatePushUrl: shop-relative only, empty reads as null", () => {
    expect(validatePushUrl("/sale")).toBe("/sale");
    expect(validatePushUrl("")).toBeNull();
    expect(validatePushUrl(null)).toBeNull();
    expect(() => validatePushUrl("https://example.com/x")).toThrow(/shop-relative/);
    expect(() => validatePushUrl("//example.com/x")).toThrow(/shop-relative/);
  });
});

describe("MX12 resolution — from ACTIVE subscriptions only", () => {
  it("push_subscribers: every active subscription is a recipient (per subscription, not per contact); gone is skipped", async () => {
    const { svc, tables } = build();
    const bc: any = await draftPush(svc);
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    expect(prepared.totalRecipients).toBe(4);
    const rows = rowsOf(tables, bc.id);
    expect(rows.map((r: any) => r.pushSubscriptionId).sort()).toEqual(["sub-1", "sub-2", "sub-3", "sub-4"]);
    // Dedupe is by subscription identity: c1's two devices are
    // two rows with distinct push: dedupe keys.
    expect(new Set(rows.map((r: any) => r.dedupeKey))).toEqual(new Set(["push:sub-1", "push:sub-2", "push:sub-3", "push:sub-4"]));
    const anon = rows.find((r: any) => r.pushSubscriptionId === "sub-4");
    expect(anon.recipientType).toBe("push");
    expect(anon.address).toBe(EP("4"));
    const identified = rows.find((r: any) => r.pushSubscriptionId === "sub-1");
    expect(identified.recipientType).toBe("customer");
    expect(identified.recipientId).toBe("c1");
  });

  it("customers audience: only identified subscriptions resolve", async () => {
    const { svc, tables } = build();
    const bc: any = await draftPush(svc, { audienceType: "customers" });
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    expect(prepared.totalRecipients).toBe(3);
    expect(rowsOf(tables, bc.id).map((r: any) => r.pushSubscriptionId).sort()).toEqual(["sub-1", "sub-2", "sub-3"]);
  });

  it("preview: counts come from subscriptions, the sample masks endpoints, and NO cost figure is produced (no org rate exists for push)", async () => {
    const { svc } = build();
    const preview: any = await svc.previewBroadcast("org-1", { channel: "push", audienceType: "push_subscribers" });
    expect(preview.total).toBe(4);
    expect(preview.costEstimate).toBeNull();
    expect(preview.sample.map((x: any) => x.address)).toContain("https://push.example.com/***");
    expect(JSON.stringify(preview.sample)).not.toContain("/sub/");
  });
});

describe("MX12 preference stages apply to push (address = endpoint)", () => {
  it("an opted_out endpoint is excluded at resolve; a pending endpoint is excluded too", async () => {
    const { svc, tables } = build();
    await svc.setPreference("org-1", { channel: "push", address: EP("3"), status: "opted_out", source: "manual" });
    await svc.setPreference("org-1", { channel: "push", address: EP("4"), status: "pending", source: "signup_form" });
    const resolved: any = await svc.resolveBroadcastRecipients("org-1", { channel: "push", audienceType: "push_subscribers" });
    expect(resolved.recipients.map((r: any) => r.pushSubscriptionId).sort()).toEqual(["sub-1", "sub-2"]);
    expect(resolved.excludedSuppressedCount).toBe(1);
    expect(resolved.excludedPendingCount).toBe(1);
  });

  it("addPreference validates a push endpoint like the base system (https URL)", async () => {
    const { svc } = build();
    const row: any = await svc.addPreference("org-1", "owner", { channel: "push", address: EP("9"), status: "opted_out" });
    expect(row.channel).toBe("push");
    expect(row.address).toBe(EP("9"));
    await expect(svc.addPreference("org-1", "owner", { channel: "push", address: "not-a-url", status: "opted_out" }))
      .rejects.toThrow(/Invalid push subscription endpoint/);
  });
});

describe("MX12 send — through the registered port", () => {
  it("success: every recipient is sent via the port with the rendered title/body + pushUrl; deliveries carry channel push", async () => {
    const { svc, tables, portCalls } = build();
    const bc: any = await draftPush(svc);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("sent");
    expect(portCalls).toHaveLength(4);
    expect(portCalls[0]).toMatchObject({ title: "ঈদ অফার Ayesha Rahman", body: "আজই দেখুন", url: "/sale" });
    const anonCall = portCalls.find((c) => c.subscriptionId === "sub-4");
    expect(anonCall?.title).toBe("ঈদ অফার Push subscriber");
    const deliveries = deliveriesOf(tables, bc.id);
    expect(deliveries).toHaveLength(4);
    expect(deliveries.every((d: any) => d.channel === "push" && d.status === "sent")).toBe(true);
    expect(deliveries.find((d: any) => d.address === EP("4"))?.recipientType).toBe("push");
  });

  it("410/gone: the delivery is FAILED with the real reason (the port owns marking the subscription gone)", async () => {
    const outcomes = new Map([["sub-3", { outcome: "gone" as const, statusCode: 410, error: "subscription has unsubscribed or expired" }]]);
    const { svc, tables } = build({ portOutcomes: outcomes });
    const bc: any = await draftPush(svc);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("partial");
    expect(sent.sentCount).toBe(3);
    expect(sent.failedCount).toBe(1);
    const failed = deliveriesOf(tables, bc.id).find((d: any) => d.status === "failed");
    expect(failed.address).toBe(EP("3"));
    expect(failed.error).toContain("subscription has unsubscribed or expired");
    expect(failed.error).toContain("410");
  });

  it("port absent: every send fails honestly — nothing is ever recorded sent", async () => {
    const { svc, tables } = build({ noPort: true });
    const bc: any = await draftPush(svc);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("failed");
    expect(sent.sentCount).toBe(0);
    const deliveries = deliveriesOf(tables, bc.id);
    expect(deliveries).toHaveLength(4);
    expect(deliveries.every((d: any) => d.status === "failed" && /send port is not available/.test(d.error ?? ""))).toBe(true);
  });

  it("resume never re-sends a confirmed recipient: process again after a partial run only touches pending rows", async () => {
    const { svc, tables, portCalls } = build();
    const bc: any = await draftPush(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const first: any = await svc.processBroadcast("org-1", bc.id, { maxEntries: 2 });
    expect(first.processed).toBe(2);
    expect(portCalls).toHaveLength(2);
    const second: any = await svc.processBroadcast("org-1", bc.id);
    expect(second.processed).toBe(2);
    // Still exactly one port call per subscription, one delivery each.
    expect(portCalls).toHaveLength(4);
    expect(new Set(portCalls.map((c) => c.subscriptionId)).size).toBe(4);
    expect(deliveriesOf(tables, bc.id)).toHaveLength(4);
  });

  it("quiet hours (MX3) defer a push broadcast exactly like other marketing channels — no port call, recipients stay pending", async () => {
    const { svc, tables, portCalls } = build();
    // A window covering the current Dhaka time (start 1h ago,
    // end 1h ahead — overnight-safe arithmetic).
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const nowParts = fmt.formatToParts(new Date());
    const nowMin = Number(nowParts.find((x) => x.type === "hour")?.value) * 60 + Number(nowParts.find((x) => x.type === "minute")?.value);
    const hhmm = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 1440) + 1440) % 1440 % 60).padStart(2, "0")}`;
    tables.messagingSetting.rows.push({
      id: "mset-1", organizationId: "org-1", frequencyCapPerDay: 0,
      quietHoursEnabled: true, quietHoursStart: hhmm(nowMin - 60), quietHoursEnd: hhmm(nowMin + 60),
    });
    const bc: any = await draftPush(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const result: any = await svc.processBroadcast("org-1", bc.id);
    expect(result.deferred).toBe("quiet_hours");
    expect(result.processed).toBe(0);
    expect(portCalls).toHaveLength(0);
    expect(rowsOf(tables, bc.id).every((r: any) => r.status === "pending")).toBe(true);
  });
});

describe("MX12 report funnel — honest null stages for push", () => {
  it("delivered/read/opened/clicked are null (never 0) while sent/failed are real", async () => {
    const outcomes = new Map([["sub-2", { outcome: "failed" as const, statusCode: 500, error: "push service unavailable" }]]);
    const { svc } = build({ portOutcomes: outcomes });
    const bc: any = await draftPush(svc);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    const report: any = await svc.getBroadcastReport("org-1", bc.id);
    expect(report.broadcast.pushUrl).toBe("/sale");
    expect(report.funnel.sent).toBe(3);
    expect(report.funnel.failed).toBe(1);
    expect(report.funnel.delivered).toBeNull();
    expect(report.funnel.read).toBeNull();
    expect(report.funnel.opened).toBeNull();
    expect(report.funnel.clickedRecipients).toBeNull();
    expect(report.funnel.totalClicks).toBeNull();
  });

  it("test-send to a typed address refuses honestly for push", async () => {
    const { svc } = build();
    const bc: any = await draftPush(svc);
    await expect(svc.testSendBroadcast("org-1", "owner", bc.id, "01712345671"))
      .rejects.toThrow(/cannot be test-sent to a typed address/);
  });
});
