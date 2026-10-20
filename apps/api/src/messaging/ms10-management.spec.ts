process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { MessagingService } from "./messaging.service";

/**
 * MS10 — broadcast management: the PATCH status matrix (with
 * the render-at-send proof for paused broadcasts), clone
 * purity, delete rules, archive semantics (hidden from lists,
 * send/schedule refused) and the list's cursor pagination +
 * server-side q/status filters in both response modes.
 * Fake-prisma style like the MS1–MS9 specs.
 */
const cmp = (a: any, b: any) => {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  return av < bv ? -1 : av > bv ? 1 : 0;
};
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) {
        if (v.not === null) { if (row[k] === null || row[k] === undefined) return false; }
        else if (row[k] === v.not) return false;
      }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("contains" in v && !String(row[k] ?? "").includes(String(v.contains))) return false;
      if ("gt" in v && !(cmp(row[k], v.gt) > 0)) return false;
      if ("gte" in v && !(cmp(row[k], v.gte) >= 0)) return false;
      if ("lt" in v && !(cmp(row[k], v.lt) < 0)) return false;
      if ("lte" in v && !(cmp(row[k], v.lte) <= 0)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return cmp(row[k], v) === 0;
    return row[k] === v;
  });
}
function applyOrder(list: any[], orderBy: any): any[] {
  if (!orderBy) return list;
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...list];
  for (let i = keys.length - 1; i >= 0; i--) {
    const [key, dir] = Object.entries(keys[i])[0] as [string, string];
    out.sort((a, b) => (dir === "desc" ? cmp(b[key], a[key]) : cmp(a[key], b[key])));
  }
  return out;
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const f = applyOrder(rows.filter((r) => matches(r, where ?? {})), orderBy);
      return take ? f.slice(0, take) : f;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

const TABLE_NAMES = [
  "messageTemplate", "broadcast", "messageDelivery", "customer", "lead", "whatsAppTemplate",
  "messagePreference", "messagingSetting", "messagingSavedAudience", "messagingSenderConfig",
  "messageLinkClick", "product", "integration",
];

function build() {
  const tables: Record<string, any> = {};
  for (const n of TABLE_NAMES) tables[n] = makeTable(n);
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = { findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }) };
  tables.subscription = { findFirst: async () => null };
  const auditCalls: any[] = [];
  const audit = { log: async (entry: any) => { auditCalls.push(entry); } } as any;
  const emailCalls: any[] = [];
  const email = {
    isConfigured: () => true,
    send: async (input: any) => { emailCalls.push(input); return { providerMessageId: `<id-${input.to}>` }; },
  } as any;
  const sms = { isConfigured: () => true, send: async () => ({ providerMessageId: "sms-1" }) } as any;
  const svc = new MessagingService(tables as any, audit, email, sms);
  return { svc, tables, auditCalls, emailCalls };
}

const statusOf = (e: any) => (typeof e?.getStatus === "function" ? e.getStatus() : e?.status);
let seedSeq = 0;
function seedBroadcast(tables: any, over: any = {}) {
  const row = {
    id: `bc-${++seedSeq}`, organizationId: "org-1", name: "Test Broadcast", channel: "email",
    templateId: null, whatsappTemplateId: null, templateParams: [], templateComponents: null,
    subject: "আসল Subject", body: "পুরনো অফার {{name}}", htmlBody: null,
    audienceType: "customers", audienceStage: null, audienceSegment: null,
    audienceDefinition: null, audienceSavedId: null, audienceCsv: null,
    abVariant: null, abGroupId: null, excludePreviousRecipients: false,
    status: "draft", scheduledAt: null, recurrence: null, recurrenceGroupId: null,
    recipientSnapshot: null, totalRecipients: 0, sentCount: 0, failedCount: 0,
    createdById: "user-1", sentAt: null, archivedAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  tables.broadcast.rows.push(row);
  return row;
}

describe("MS10 PATCH: status matrix", () => {
  it("draft: content edits apply", async () => {
    const { svc, tables } = build();
    const b = seedBroadcast(tables, { status: "draft" });
    const res = await svc.updateBroadcast("org-1", "user-1", b.id, { name: "নতুন নাম", body: "নতুন Body {{name}}", subject: "নতুন Subject" });
    expect(res.name).toBe("নতুন নাম");
    expect(res.body).toBe("নতুন Body {{name}}");
    expect(res.subject).toBe("নতুন Subject");
    expect(res.recipientSnapshot).toBeUndefined();
    expect(res.progress).toBeTruthy();
  });

  it("scheduled: content + a future scheduledAt apply; a past time 400s; null unschedules to draft", async () => {
    const { svc, tables } = build();
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const b = seedBroadcast(tables, { status: "scheduled", scheduledAt: new Date(Date.now() + 1800 * 1000) });
    const res = await svc.updateBroadcast("org-1", "user-1", b.id, { body: "বদলানো Body", scheduledAt: future });
    expect(res.body).toBe("বদলানো Body");
    expect(res.status).toBe("scheduled");
    expect(new Date(res.scheduledAt).toISOString()).toBe(future);
    const past = await svc.updateBroadcast("org-1", "user-1", b.id, { scheduledAt: new Date(Date.now() - 1000).toISOString() }).catch((e) => e);
    expect(statusOf(past)).toBe(400);
    const un = await svc.updateBroadcast("org-1", "user-1", b.id, { scheduledAt: null });
    expect(un.status).toBe("draft");
    expect(un.scheduledAt).toBeNull();
  });

  it("paused: content applies, a schedule change refuses", async () => {
    const { svc, tables } = build();
    const b = seedBroadcast(tables, { status: "paused", recipientSnapshot: [] });
    const res = await svc.updateBroadcast("org-1", "user-1", b.id, { body: "Pause অবস্থায় বদলানো" });
    expect(res.body).toBe("Pause অবস্থায় বদলানো");
    const err = await svc.updateBroadcast("org-1", "user-1", b.id, { scheduledAt: new Date(Date.now() + 3600e3).toISOString() }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
  });

  it.each(["sending", "sent", "partial", "failed", "cancelled"])("%s: refuses, naming the status", async (status) => {
    const { svc, tables } = build();
    const b = seedBroadcast(tables, { status });
    const err = await svc.updateBroadcast("org-1", "user-1", b.id, { body: "x" }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
    expect(String(err.message)).toContain(status);
  });

  it("archived: refuses until unarchived", async () => {
    const { svc, tables } = build();
    const b = seedBroadcast(tables, { status: "draft", archivedAt: new Date() });
    const err = await svc.updateBroadcast("org-1", "user-1", b.id, { body: "x" }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
    expect(err.code).toBe("messaging.thisBroadcastIsArchivedUnarchiveIt3");
  });
});

describe("MS10 PATCH: create-time validation is reused, not weakened", () => {
  it("htmlBody on an SMS broadcast ⇒ 400 (the MS5 rule)", async () => {
    const { svc, tables } = build();
    const b = seedBroadcast(tables, { channel: "sms", subject: null });
    const err = await svc.updateBroadcast("org-1", "user-1", b.id, { htmlBody: "<p>x</p>" }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
    expect(err.code).toBe("messaging.htmlBodyIsOnlyAllowedForEmail3");
  });

  it("clearing an email subject ⇒ 400 (email always needs a subject)", async () => {
    const { svc, tables } = build();
    const b = seedBroadcast(tables, {});
    const err = await svc.updateBroadcast("org-1", "user-1", b.id, { subject: null }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
    expect(err.code).toBe("messaging.emailBroadcastsNeedASubject");
  });

  it("emptying the body ⇒ 400", async () => {
    const { svc, tables } = build();
    const b = seedBroadcast(tables, {});
    const err = await svc.updateBroadcast("org-1", "user-1", b.id, { body: "" }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
    expect(err.code).toBe("messaging.broadcastBodyIsRequiredWriteOne");
  });

  it("templateId: foreign template 404s; a channel mismatch 400s; a matching one links", async () => {
    const { svc, tables } = build();
    tables.messageTemplate.rows.push({ id: "tpl-sms", organizationId: "org-1", name: "SMS T", channel: "sms", subject: null, body: "sms body", htmlBody: null });
    tables.messageTemplate.rows.push({ id: "tpl-foreign", organizationId: "org-2", name: "F", channel: "email", subject: "s", body: "b", htmlBody: null });
    tables.messageTemplate.rows.push({ id: "tpl-email", organizationId: "org-1", name: "E", channel: "email", subject: "s", body: "b", htmlBody: null });
    const b = seedBroadcast(tables, {});
    const e404 = await svc.updateBroadcast("org-1", "user-1", b.id, { templateId: "tpl-foreign" }).catch((e) => e);
    expect(statusOf(e404)).toBe(404);
    const e400 = await svc.updateBroadcast("org-1", "user-1", b.id, { templateId: "tpl-sms" }).catch((e) => e);
    expect(statusOf(e400)).toBe(400);
    expect(e400.code).toBe("messaging.templateChannelDoesNotMatchThe");
    const ok = await svc.updateBroadcast("org-1", "user-1", b.id, { templateId: "tpl-email" });
    expect(ok.templateId).toBe("tpl-email");
    const cleared = await svc.updateBroadcast("org-1", "user-1", b.id, { templateId: null });
    expect(cleared.templateId).toBeNull();
  });

  it("whatsapp: body edits refuse; a template swap re-derives the body; bad templateComponents 400", async () => {
    const { svc, tables } = build();
    tables.whatsAppTemplate.rows.push({ id: "wa-1", organizationId: "org-1", name: "promo_v1", language: "bn", bodyText: "পুরনো Template Body {{1}}" });
    tables.whatsAppTemplate.rows.push({ id: "wa-2", organizationId: "org-1", name: "promo_v2", language: "bn", bodyText: "নতুন Template Body {{1}}" });
    const b = seedBroadcast(tables, { channel: "whatsapp", subject: null, whatsappTemplateId: "wa-1", body: "পুরনো Template Body {{1}}" });
    const eBody = await svc.updateBroadcast("org-1", "user-1", b.id, { body: "free text" }).catch((e) => e);
    expect(statusOf(eBody)).toBe(400);
    const swapped = await svc.updateBroadcast("org-1", "user-1", b.id, { whatsappTemplateId: "wa-2" });
    expect(swapped.whatsappTemplateId).toBe("wa-2");
    expect(swapped.body).toBe("নতুন Template Body {{1}}");
    const eTc = await svc.updateBroadcast("org-1", "user-1", b.id, { templateComponents: { buttonParams: [{ index: -1, subType: "url" }] } }).catch((e) => e);
    expect(statusOf(eTc)).toBe(400);
    const okTc = await svc.updateBroadcast("org-1", "user-1", b.id, { templateComponents: { headerMediaUrl: "https://cdn.example.com/x.jpg" } });
    expect(okTc.templateComponents).toEqual({ headerMediaUrl: "https://cdn.example.com/x.jpg" });
  });
});

describe("MS10 PATCH: paused broadcasts render the EDITED body at send (render-at-send proof)", () => {
  it("prepare → pause → edit → resume sends the new body/subject, never the old", async () => {
    const { svc, tables, emailCalls } = build();
    const snapshot = [
      { type: "customer", id: "c-1", name: "Rahim", email: "rahim@example.com", phone: null, status: "pending", attempts: 0, vars: { name: "Rahim" } },
      { type: "customer", id: "c-2", name: "Karim", email: "karim@example.com", phone: null, status: "pending", attempts: 0, vars: { name: "Karim" } },
    ];
    const b = seedBroadcast(tables, { status: "sending", recipientSnapshot: snapshot, totalRecipients: 2 });
    await svc.pauseBroadcast("org-1", "user-1", b.id);
    await svc.updateBroadcast("org-1", "user-1", b.id, { body: "নতুন অফার {{name}}", subject: "নতুন Subject" });
    const resumed: any = await svc.resumeBroadcast("org-1", "user-1", b.id);
    expect(resumed.status).toBe("sent");
    expect(emailCalls).toHaveLength(2);
    for (const call of emailCalls) {
      expect(call.text).toContain("নতুন অফার");
      expect(call.text).not.toContain("পুরনো অফার");
      expect(call.subject).toBe("নতুন Subject");
    }
    expect(emailCalls[0].text).toContain("নতুন অফার Rahim");
  });
});

describe("MS10 clone: purity", () => {
  it("a sent A/B variant clones as a single clean draft — no snapshot, counters, deliveries or pair", async () => {
    const { svc, tables } = build();
    const src = seedBroadcast(tables, {
      status: "sent", name: "ঈদ অফার (A)", abVariant: "A", abGroupId: "grp-1",
      recipientSnapshot: [{ type: "customer", id: "c-1", name: "R", email: "r@x.com", phone: null, status: "sent", attempts: 1 }],
      totalRecipients: 5, sentCount: 5, sentAt: new Date(), audienceSegment: "at_risk",
    });
    tables.messageDelivery.rows.push(
      { id: "d-1", organizationId: "org-1", broadcastId: src.id, channel: "email", status: "sent", createdAt: new Date() },
      { id: "d-2", organizationId: "org-1", broadcastId: src.id, channel: "email", status: "sent", createdAt: new Date() },
    );
    const clone: any = await svc.cloneBroadcast("org-1", "user-9", src.id);
    expect(clone.id).not.toBe(src.id);
    expect(clone.status).toBe("draft");
    expect(clone.name).toBe("ঈদ অফার (A) (কপি)");
    expect(clone.recipientSnapshot ?? null).toBeNull();
    expect(clone.sentCount ?? 0).toBe(0);
    expect(clone.totalRecipients ?? 0).toBe(0);
    expect(clone.sentAt ?? null).toBeNull();
    expect(clone.scheduledAt ?? null).toBeNull();
    expect(clone.abVariant ?? null).toBeNull();
    expect(clone.abGroupId ?? null).toBeNull();
    expect(clone.recurrence ?? null).toBeNull();
    expect(clone.createdById).toBe("user-9");
    expect(clone.audienceSegment).toBe("at_risk");
    expect(clone.body).toBe(src.body);
    expect(clone.clonedFrom).toBe(src.id);
    expect(clone.cloneNote).toContain("A/B");
    expect(tables.messageDelivery.rows).toHaveLength(2);
    expect(tables.broadcast.rows).toHaveLength(2);
  });

  it("a plain broadcast clones without a cloneNote", async () => {
    const { svc, tables } = build();
    const src = seedBroadcast(tables, { status: "draft" });
    const clone: any = await svc.cloneBroadcast("org-1", "user-1", src.id);
    expect(clone.cloneNote).toBeUndefined();
    expect(clone.name).toBe("Test Broadcast (কপি)");
  });
});

describe("MS10 delete + archive", () => {
  it("delete: draft and cancelled go; sent-family refuses and points at archive", async () => {
    const { svc, tables } = build();
    const draft = seedBroadcast(tables, { status: "draft" });
    expect(await svc.deleteBroadcast("org-1", "user-1", draft.id)).toEqual({ deleted: true, id: draft.id });
    expect(tables.broadcast.rows.find((r: any) => r.id === draft.id)).toBeUndefined();
    const cancelled = seedBroadcast(tables, { status: "cancelled" });
    await svc.deleteBroadcast("org-1", "user-1", cancelled.id);
    const sent = seedBroadcast(tables, { status: "sent" });
    const err = await svc.deleteBroadcast("org-1", "user-1", sent.id).catch((e) => e);
    expect(statusOf(err)).toBe(400);
    expect(err.code).toBe("messaging.aBroadcastStatusBroadcastCannotBeDeleted");
    const scheduled = seedBroadcast(tables, { status: "scheduled" });
    const err2 = await svc.deleteBroadcast("org-1", "user-1", scheduled.id).catch((e) => e);
    expect(statusOf(err2)).toBe(400);
  });

  it("archive: hides from both list modes by default, refuses send + schedule, unarchive restores", async () => {
    const { svc, tables } = build();
    const b = seedBroadcast(tables, { status: "draft" });
    const other = seedBroadcast(tables, { status: "draft", name: "অন্য Broadcast" });
    const archived = await svc.setBroadcastArchived("org-1", "user-1", b.id, true);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    const legacy = await svc.listBroadcasts("org-1") as any[];
    expect(legacy.map((r) => r.id)).toEqual([other.id]);
    const paged = await svc.listBroadcasts("org-1", {}) as any;
    expect(paged.items.map((r: any) => r.id)).toEqual([other.id]);
    const withArchived = await svc.listBroadcasts("org-1", { archived: true }) as any;
    expect(withArchived.items.map((r: any) => r.id).sort()).toEqual([b.id, other.id].sort());
    const sendErr = await svc.sendBroadcast("org-1", "user-1", b.id).catch((e) => e);
    expect(statusOf(sendErr)).toBe(400);
    expect(sendErr.code).toBe("messaging.thisBroadcastIsArchivedUnarchiveIt");
    const schedErr = await svc.scheduleBroadcast("org-1", "user-1", b.id, new Date(Date.now() + 3600e3).toISOString()).catch((e) => e);
    expect(statusOf(schedErr)).toBe(400);
    const restored = await svc.setBroadcastArchived("org-1", "user-1", b.id, false);
    expect(restored.archivedAt).toBeNull();
    const legacy2 = await svc.listBroadcasts("org-1") as any[];
    expect(legacy2).toHaveLength(2);
  });

  it("archive: a sending broadcast refuses", async () => {
    const { svc, tables } = build();
    const b = seedBroadcast(tables, { status: "sending", recipientSnapshot: [] });
    const err = await svc.setBroadcastArchived("org-1", "user-1", b.id, true).catch((e) => e);
    expect(statusOf(err)).toBe(400);
  });
});

describe("MS10 list: cursor pagination + server filters", () => {
  function seedMany(tables: any, n: number) {
    const base = Date.now() - n * 60000;
    for (let i = 0; i < n; i++) {
      seedBroadcast(tables, {
        id: `bc-page-${String(i).padStart(3, "0")}`,
        name: `Broadcast ${i}`,
        createdAt: new Date(base + i * 60000),
        // A createdAt tie at the page boundary (rows 10 and 11
        // share a timestamp) — the cursor must not lose or
        // repeat either.
        ...(i === 11 ? { createdAt: new Date(base + 10 * 60000) } : {}),
      });
    }
  }

  it("cursor walk covers all 60 rows exactly once, across a createdAt tie", async () => {
    const { svc, tables } = build();
    seedMany(tables, 60);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await svc.listBroadcasts("org-1", { cursor }) as any;
      seen.push(...res.items.map((r: any) => r.id));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    const first = await svc.listBroadcasts("org-1", {}) as any;
    expect(first.items).toHaveLength(50);
    expect(first.items[0].recipientSnapshot).toBeUndefined();
    expect(first.items[0].progress).toBeTruthy();
  });

  it("q and status filters apply server-side in paged mode", async () => {
    const { svc, tables } = build();
    seedBroadcast(tables, { name: "ঈদ অফার ১", status: "sent" });
    seedBroadcast(tables, { name: "ঈদ অফার ২", status: "draft" });
    seedBroadcast(tables, { name: "দৈনিক খবর", status: "sent" });
    const byQ = await svc.listBroadcasts("org-1", { q: "ঈদ" }) as any;
    expect(byQ.items.map((r: any) => r.name).sort()).toEqual(["ঈদ অফার ১", "ঈদ অফার ২"]);
    const byStatus = await svc.listBroadcasts("org-1", { status: "sent" }) as any;
    expect(byStatus.items.map((r: any) => r.name).sort()).toEqual(["ঈদ অফার ১", "দৈনিক খবর"]);
    const both = await svc.listBroadcasts("org-1", { q: "ঈদ", status: "sent" }) as any;
    expect(both.items.map((r: any) => r.name)).toEqual(["ঈদ অফার ১"]);
  });

  it("legacy mode stays the bare array (take 50, newest first)", async () => {
    const { svc, tables } = build();
    seedMany(tables, 55);
    const legacy = await svc.listBroadcasts("org-1") as any;
    expect(Array.isArray(legacy)).toBe(true);
    expect(legacy).toHaveLength(50);
    expect(legacy[0].name).toBe("Broadcast 54");
  });
});
