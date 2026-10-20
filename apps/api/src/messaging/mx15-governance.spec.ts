process.env.JWT_SECRET = "<MASKED_SECRET_001>";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { MessagingService } from "./messaging.service";
import { aggregateChannelHealth, isHardRecipientFailure, decideBudget } from "./governance";
import { composeCheckV2 } from "./compose-check-v2";

/**
 * MX15 — Deliverability, Reputation & Governance specs.
 *
 * Fake-prisma style like mx12–mx14. Covers: pure health /
 * hard-failure / budget / checklist-v2 helpers, the service
 * health aggregate, WhatsApp hard-failure auto-suppression,
 * the four-eyes approval workflow in both modes, spend-cap
 * budget governance from org-entered rates only, the seed
 * list over the existing test-send path, and checklist v2
 * over a real resolved recipient sample.
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
    findUnique: async ({ where, select }: any = {}) => {
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
    messagingSenderConfig: makeTable("scfg"), membership: makeTable("memb"),
    messagingSeedRecipient: makeTable("seed"), messageConsentEvent: makeTable("consent"),
    broadcastRecipient: makeRecipientTable(),
    order: makeOrderTable(),
    messageLinkClick: makeTable("click"),
  };
  tables.customer.rows.push(
    { id: "customer-1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman", email: "ayesha@example.com", phone: "01712345671" },
    { id: "customer-2", organizationId: "org-1", firstName: "Tanvir", lastName: null, email: "tanvir@example.com", phone: "01712345672" },
  );
  tables.membership.rows.push(
    { id: "memb-1", organizationId: "org-1", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "memb-2", organizationId: "org-1", userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
    { id: "memb-3", organizationId: "org-1", userId: "mm-1", role: "MARKETING_MANAGER", status: "ACTIVE" },
  );
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = {
    findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null, timezone: "Asia/Dhaka" }),
  };
  const email = { isConfigured: () => true, send: async () => ({ providerMessageId: "email-msg-1" }) } as any;
  const sms = { isConfigured: () => false, send: async () => { throw new Error("SMS is not configured"); } } as any;
  const auditCalls: any[] = [];
  const audit = { log: async (x: any) => { auditCalls.push(x); } } as any;
  const svc = new MessagingService(tables as any, audit, email, sms);
  return { svc, tables, auditCalls };
}

const deliveriesOf = (tables: any, broadcastId: string) =>
  tables.messageDelivery.rows.filter((r: any) => r.broadcastId === broadcastId);

async function draftEmail(svc: MessagingService, actor = "owner-1", extra: Record<string, unknown> = {}) {
  return svc.createBroadcast("org-1", actor, {
    name: "Eid email", channel: "email", subject: "ঈদ অফার", body: "হ্যালো {{name}}",
    audienceType: "customers", ...extra,
  } as any);
}

describe("MX15 pure governance — health aggregation", () => {
  it("computes failure rates from real rows; bounce/complaint/delivered stay null where a channel cannot report them", () => {
    const channels = aggregateChannelHealth([
      { channel: "email", status: "sent" }, { channel: "email", status: "sent" },
      { channel: "email", status: "failed", error: "SMTP 550 mailbox unavailable" },
      { channel: "email", status: "skipped" },
      { channel: "whatsapp", status: "sent", deliveryStatus: "read", deliveredAt: new Date(), readAt: new Date() },
      { channel: "whatsapp", status: "sent", deliveryStatus: "delivered", deliveredAt: new Date() },
      { channel: "whatsapp", status: "failed", error: "131026 Message Undeliverable" },
    ] as any);
    const email = channels.find((c) => c.channel === "email")!;
    expect(email.failureRate).toBeCloseTo(1 / 3);
    expect(email.deliveredRate).toBeNull();
    expect(email.readRate).toBeNull();
    expect(email.bounceRate).toBeNull();
    expect(email.complaintRate).toBeNull();
    const wa = channels.find((c) => c.channel === "whatsapp")!;
    expect(wa.deliveredRate).toBe(1);
    expect(wa.readRate).toBeCloseTo(0.5);
    expect(wa.failureReasons[0].count).toBe(1);
  });
  it("an empty window yields no channel rows (never fabricated zeros)", () => {
    expect(aggregateChannelHealth([])).toEqual([]);
  });
});

describe("MX15 pure governance — hard-failure classifier + budget decision", () => {
  it("classifies only recipient-side hard failures", () => {
    expect(isHardRecipientFailure("131026 Message Undeliverable")).toBe(true);
    expect(isHardRecipientFailure("Recipient not in allowed list (131030)")).toBe(true);
    expect(isHardRecipientFailure("132000 Template does not exist")).toBe(false);
    expect(isHardRecipientFailure("130429 Rate limit hit")).toBe(false);
    expect(isHardRecipientFailure("")).toBe(false);
    expect(isHardRecipientFailure(null)).toBe(false);
  });
  it("budget: no caps allow; cannot-estimate allows with warning; caps block with figures", () => {
    const base = { basis: null, monthlySpentMinor: null, monthlyEstimateComplete: true };
    expect(decideBudget({ ...base, estimateMinor: 500, perBroadcastCapMinor: null, monthlyCapMinor: null }).decision).toBe("allow");
    const warn = decideBudget({ ...base, estimateMinor: null, perBroadcastCapMinor: 100, monthlyCapMinor: null });
    expect(warn.decision).toBe("allow_with_warning");
    expect(warn.warning).toMatch(/cannot be estimated/i);
    const block = decideBudget({ ...base, estimateMinor: 200, perBroadcastCapMinor: 150, monthlyCapMinor: null });
    expect(block.decision).toBe("block");
    expect(block.blockReason).toMatch(/2\.00/);
    const monthly = decideBudget({ estimateMinor: 200, basis: null, perBroadcastCapMinor: null, monthlyCapMinor: 300, monthlySpentMinor: 200, monthlyEstimateComplete: true });
    expect(monthly.decision).toBe("block");
    const incomplete = decideBudget({ estimateMinor: 200, basis: null, perBroadcastCapMinor: null, monthlyCapMinor: 300, monthlySpentMinor: 0, monthlyEstimateComplete: false });
    expect(incomplete.decision).toBe("allow_with_warning");
  });
});

describe("MX15 pure checklist v2", () => {
  const baseInput = { channel: "email", subject: "Hi", body: "Hello", linkTrackingEnabled: true, sampleVars: null, imageAssets: [] as any[] };
  it("URL format: a malformed link fails; a valid one passes; no links = not_run", () => {
    const bad = composeCheckV2({ ...baseInput, body: "Go http://:bad now" });
    expect(bad.checks.find((c) => c.code === "URL_FORMAT")?.status).toBe("fail");
    const good = composeCheckV2({ ...baseInput, body: "Go https://shop.example.com/sale now" });
    expect(good.checks.find((c) => c.code === "URL_FORMAT")?.status).toBe("pass");
    expect(good.checks.find((c) => c.code === "LINKS_TRACKED")?.status).toBe("pass");
    const none = composeCheckV2({ ...baseInput, body: "No links here" });
    expect(none.checks.find((c) => c.code === "URL_FORMAT")?.status).toBe("not_run");
  });
  it("tracking off warns instead of claiming links are tracked", () => {
    const r = composeCheckV2({ ...baseInput, linkTrackingEnabled: false, body: "Go https://shop.example.com/sale" });
    expect(r.checks.find((c) => c.code === "LINKS_TRACKED")?.status).toBe("warn");
  });
  it("variables: not_run without a sample; warn on empty sample values; pass when filled", () => {
    const noSample = composeCheckV2({ ...baseInput, body: "Hi {{name}}, order {{lastOrderNumber}}" });
    expect(noSample.checks.find((c) => c.code === "VARIABLES_SAMPLE")?.status).toBe("not_run");
    const empty = composeCheckV2({ ...baseInput, body: "Hi {{name}}, order {{lastOrderNumber}}", sampleVars: [{ name: "Ayesha", lastOrderNumber: "" }] });
    const vc = empty.checks.find((c) => c.code === "VARIABLES_SAMPLE");
    expect(vc?.status).toBe("warn");
    expect(vc?.detail).toMatch(/lastOrderNumber/);
    const filled = composeCheckV2({ ...baseInput, body: "Hi {{name}}", sampleVars: [{ name: "Ayesha" }] });
    expect(filled.checks.find((c) => c.code === "VARIABLES_SAMPLE")?.status).toBe("pass");
  });
  it("image size: not_run when no metadata exists (never a silent pass); spam check is labelled heuristic with the word list", () => {
    const r = composeCheckV2({ ...baseInput, body: "Deal!", htmlBody: '<p><img src="https://cdn.example.com/a.png"></p>' });
    const img = r.checks.find((c) => c.code === "IMAGE_SIZE");
    expect(img?.status).toBe("not_run");
    expect(img?.detail).toMatch(/metadata রাখা হয় না/);
    const spam = composeCheckV2({ ...baseInput, body: "You won a cash prize — act now!" });
    expect(spam.checks.find((c) => c.code === "SPAM_HEURISTIC")?.status).toBe("warn");
    expect(spam.spamWords.en).toContain("cash prize");
    expect(spam.spamWords.label).toMatch(/Heuristic/);
    // The v1 MS5 warnings ride along verbatim (extension, not a duplicate validator).
    expect(spam.warnings.some((w) => w.code === "SPAM_WORD")).toBe(true);
    const withMeta = composeCheckV2({ ...baseInput, body: "x", htmlBody: '<img src="https://cdn.example.com/a.png">', imageAssets: [{ url: "https://cdn.example.com/a.png", sizeBytes: 2 * 1024 * 1024 }] });
    expect(withMeta.checks.find((c) => c.code === "IMAGE_SIZE")?.status).toBe("warn");
  });
});

describe("MX15 service — delivery health", () => {
  it("aggregates only the stated window and reports per-sender as null with the reason", async () => {
    const { svc, tables } = build();
    const now = Date.now();
    tables.messageDelivery.rows.push(
      { id: "d1", organizationId: "org-1", channel: "email", status: "sent", createdAt: new Date(now - 1 * 864e5) },
      { id: "d2", organizationId: "org-1", channel: "email", status: "failed", error: "SMTP 550", createdAt: new Date(now - 2 * 864e5) },
      { id: "d3", organizationId: "org-1", channel: "email", status: "sent", createdAt: new Date(now - 40 * 864e5) },
    );
    const health: any = await svc.getDeliveryHealth("org-1", 30);
    expect(health.available).toBe(true);
    expect(health.windowDays).toBe(30);
    expect(health.totals.deliveries).toBe(2);
    expect(health.totals.failureRate).toBeCloseTo(0.5);
    expect(health.totals.bounceRate).toBeNull();
    expect(health.perSender).toBeNull();
    expect(health.perSenderNote).toMatch(/no sender identity/);
  });
});

describe("MX15 service — auto-suppression on the WhatsApp webhook path", () => {
  it("a hard failure suppresses the address in the preference store; a template failure does not", async () => {
    const { svc, tables } = build();
    tables.messageDelivery.rows.push(
      { id: "d-hard", organizationId: "org-1", broadcastId: "bc-1", channel: "whatsapp", recipientType: "customer", recipientId: "customer-1", address: "8801712345671", status: "sent", providerMessageId: "wamid-hard", deliveryStatus: null },
      { id: "d-tpl", organizationId: "org-1", broadcastId: "bc-1", channel: "whatsapp", recipientType: "customer", recipientId: "customer-2", address: "8801712345672", status: "sent", providerMessageId: "wamid-tpl", deliveryStatus: null },
    );
    const hard = await svc.applyWhatsAppDeliveryStatus("org-1", "wamid-hard", "failed", "131026 Message Undeliverable");
    expect(hard.applied).toBe(true);
    const pref = tables.messagePreference.rows.find((r: any) => r.address === "8801712345671");
    expect(pref?.status).toBe("opted_out");
    expect(pref?.source).toBe("auto_suppression");
    const tpl = await svc.applyWhatsAppDeliveryStatus("org-1", "wamid-tpl", "failed", "132000 Template does not exist");
    expect(tpl.applied).toBe(true);
    expect(tables.messagePreference.rows.find((r: any) => r.address === "8801712345672")).toBeUndefined();
  });
});

describe("MX15 service — approval workflow", () => {
  const withApproval = (tables: any) => {
    tables.messagingSetting.rows.push({ id: "mset-1", organizationId: "org-1", frequencyCapPerDay: 0, whatsappOptInRequired: false, linkTrackingEnabled: true, approvalEnabled: true });
  };
  it("OFF (default): a marketing manager's broadcast is a plain draft and sends — byte-identical behaviour", async () => {
    const { svc, tables } = build();
    const bc: any = await draftEmail(svc, "mm-1");
    expect(bc.status).toBe("draft");
    expect(bc.approvalStatus).toBeUndefined();
    const sent: any = await svc.sendBroadcast("org-1", "mm-1", bc.id);
    expect(sent.status).toBe("sent");
    expect(deliveriesOf(tables, bc.id).filter((d: any) => d.status === "sent").length).toBe(2);
  });
  it("ON: non-approver create enters pending_approval; send + schedule are refused; the sweep never picks it up", async () => {
    const { svc, tables } = build();
    withApproval(tables);
    const bc: any = await draftEmail(svc, "mm-1");
    expect(bc.status).toBe("pending_approval");
    expect(bc.approvalStatus).toBe("pending");
    await expect(svc.sendBroadcast("org-1", "mm-1", bc.id)).rejects.toMatchObject({ code: "messaging.broadcastPendingApprovalCannotBeSent" });
    await expect(svc.scheduleBroadcast("org-1", "mm-1", bc.id, new Date(Date.now() + 3600e3).toISOString())).rejects.toMatchObject({ code: "messaging.broadcastPendingApprovalCannotBeSent" });
    const queue: any[] = await svc.listApprovalQueue("org-1");
    expect(queue.map((q) => q.id)).toContain(bc.id);
    expect(deliveriesOf(tables, bc.id).length).toBe(0);
  });
  it("ON: an approver's own create is NOT gated", async () => {
    const { svc, tables } = build();
    withApproval(tables);
    const bc: any = await draftEmail(svc, "owner-1");
    expect(bc.status).toBe("draft");
  });
  it("four-eyes: a non-approver cannot approve; the creator can never approve their own; a different approver can", async () => {
    const { svc, tables, auditCalls } = build();
    withApproval(tables);
    const bc: any = await draftEmail(svc, "mm-1");
    await expect(svc.approveBroadcast("org-1", "mm-1", bc.id, "self")).rejects.toMatchObject({ code: "messaging.onlyAnOWNEROrADMINMember" });
    // Force the creator to be an approver on the row: even then, self-approval is refused.
    const row = tables.broadcast.rows.find((r: any) => r.id === bc.id);
    row.createdById = "admin-1";
    await expect(svc.approveBroadcast("org-1", "admin-1", bc.id)).rejects.toThrow(/Four-eyes/);
    row.createdById = "mm-1";
    const approved: any = await svc.approveBroadcast("org-1", "admin-1", bc.id, "ঠিক আছে");
    expect(approved.status).toBe("draft");
    expect(approved.approvalStatus).toBe("approved");
    expect(approved.approvedById).toBe("admin-1");
    expect(approved.approvalNote).toBe("ঠিক আছে");
    expect(auditCalls.some((c: any) => c.action === "broadcast.approve")).toBe(true);
    const sent: any = await svc.sendBroadcast("org-1", "mm-1", bc.id);
    expect(sent.status).toBe("sent");
  });
  it("reject keeps the send gate closed until re-submit + approve; approval of a future-scheduled broadcast restores 'scheduled'", async () => {
    const { svc, tables } = build();
    withApproval(tables);
    const future = new Date(Date.now() + 24 * 3600e3).toISOString();
    const bc: any = await draftEmail(svc, "mm-1", { scheduledAt: future });
    expect(bc.status).toBe("pending_approval");
    const rejected: any = await svc.rejectBroadcast("org-1", "owner-1", bc.id, "ছবি বদলান");
    expect(rejected.status).toBe("draft");
    expect(rejected.approvalStatus).toBe("rejected");
    expect(rejected.approvalNote).toBe("ছবি বদলান");
    await expect(svc.sendBroadcast("org-1", "mm-1", bc.id)).rejects.toThrow(/REJECTED/);
    const resubmitted: any = await svc.submitBroadcastForApproval("org-1", "mm-1", bc.id);
    expect(resubmitted.status).toBe("pending_approval");
    // Re-stamp the planned time (rejection cleared it) via edit, then approve.
    await svc.updateBroadcast("org-1", "mm-1", bc.id, { scheduledAt: future });
    const approved: any = await svc.approveBroadcast("org-1", "admin-1", bc.id);
    expect(approved.status).toBe("scheduled");
    expect(deliveriesOf(tables, bc.id).length).toBe(0);
  });
  it("settings write persists the governance fields and the view returns them; a zero cap is refused", async () => {
    const { svc } = build();
    const view: any = await svc.updateMessagingSetting("org-1", "owner-1", { approvalEnabled: true, broadcastCostCapMinor: 5000, monthlySpendCapMinor: 20000 } as any);
    expect(view.approvalEnabled).toBe(true);
    expect(view.broadcastCostCapMinor).toBe(5000);
    expect(view.monthlySpendCapMinor).toBe(20000);
    const read: any = await svc.getMessagingSettingsView("org-1");
    expect(read.approvalEnabled).toBe(true);
    await expect(svc.updateMessagingSetting("org-1", "owner-1", { broadcastCostCapMinor: 0 } as any)).rejects.toThrow(/broadcastCostCapMinor/);
  });
});

describe("MX15 service — budget governance (spend caps from org rates only)", () => {
  const withRate = (tables: any) => {
    tables.messagingSenderConfig.rows.push({ id: "scfg-1", organizationId: "org-1", emailCostPerMessageMinor: 100, smsCostPerPartMinor: null, whatsappCostPerMessageMinor: null });
    tables.messagingSetting.rows.push({ id: "mset-1", organizationId: "org-1", frequencyCapPerDay: 0, whatsappOptInRequired: false, linkTrackingEnabled: true });
  };
  it("per-broadcast cap: estimate 200 > cap 150 blocks queueing with figures and sends nothing; cap 500 allows", async () => {
    const { svc, tables } = build();
    withRate(tables);
    const blocked: any = await draftEmail(svc, "owner-1", { budgetCapMinor: 150 });
    await expect(svc.sendBroadcast("org-1", "owner-1", blocked.id)).rejects.toThrow(/per-broadcast cap/);
    expect(deliveriesOf(tables, blocked.id).length).toBe(0);
    const ok: any = await draftEmail(svc, "owner-1", { budgetCapMinor: 500 });
    const decision: any = await svc.checkBroadcastBudget("org-1", ok, 2);
    expect(decision.estimateMinor).toBe(200);
    expect(decision.decision).toBe("allow");
    const sent: any = await svc.sendBroadcast("org-1", "owner-1", ok.id);
    expect(sent.status).toBe("sent");
  });
  it("org default cap applies when the broadcast carries none", async () => {
    const { svc, tables } = build();
    withRate(tables);
    tables.messagingSetting.rows[0].broadcastCostCapMinor = 150;
    const bc: any = await draftEmail(svc, "owner-1");
    await expect(svc.sendBroadcast("org-1", "owner-1", bc.id)).rejects.toThrow(/per-broadcast cap/);
  });
  it("monthly cap: this month's real sends + this estimate over the cap blocks", async () => {
    const { svc, tables } = build();
    withRate(tables);
    const first: any = await draftEmail(svc, "owner-1");
    await svc.sendBroadcast("org-1", "owner-1", first.id); // spends 2 × 100 = 200
    tables.messagingSetting.rows[0].monthlySpendCapMinor = 300;
    const second: any = await draftEmail(svc, "owner-1");
    await expect(svc.sendBroadcast("org-1", "owner-1", second.id)).rejects.toThrow(/Monthly spend cap/);
    expect(deliveriesOf(tables, second.id).length).toBe(0);
  });
  it("cannot estimate (no org rate): the check reports it and ALLOWS with a warning — nothing is invented", async () => {
    const { svc, tables } = build();
    tables.messagingSetting.rows.push({ id: "mset-1", organizationId: "org-1", frequencyCapPerDay: 0, whatsappOptInRequired: false, linkTrackingEnabled: true, monthlySpendCapMinor: 100 });
    const bc: any = await draftEmail(svc, "owner-1");
    const decision: any = await svc.checkBroadcastBudget("org-1", bc, 2);
    expect(decision.decision).toBe("allow_with_warning");
    expect(decision.estimateMinor).toBeNull();
    expect(decision.warning).toMatch(/cannot be estimated/i);
    const sent: any = await svc.sendBroadcast("org-1", "owner-1", bc.id);
    expect(sent.status).toBe("sent");
  });
});

describe("MX15 service — seed list + checklist v2 over a real sample", () => {
  it("seed CRUD validates addresses, dedupes, and one-click test send uses the existing test-send path", async () => {
    const { svc, tables } = build();
    const seed: any = await svc.addSeedRecipient("org-1", "owner-1", { channel: "email", address: "Boss@Example.com", label: "মালিক" });
    expect(seed.address).toBe("boss@example.com");
    const dupe: any = await svc.addSeedRecipient("org-1", "owner-1", { channel: "email", address: "boss@example.com" });
    expect(dupe.id).toBe(seed.id);
    await expect(svc.addSeedRecipient("org-1", "owner-1", { channel: "email", address: "not-an-email" })).rejects.toMatchObject({ code: "messaging.invalidEmailAddressRaw" });
    await expect(svc.addSeedRecipient("org-1", "owner-1", { channel: "push", address: "https://push.example.com/x" })).rejects.toMatchObject({ code: "messaging.channelMustBeEmailSmsWhatsapp2" });
    const bc: any = await draftEmail(svc, "owner-1");
    const result: any = await svc.testSendBroadcastToSeed("org-1", "owner-1", bc.id, seed.id);
    expect(result.status).toBe("sent");
    const testDeliveries = deliveriesOf(tables, bc.id).filter((d: any) => d.recipientType === "test");
    expect(testDeliveries.length).toBe(1);
    expect(testDeliveries[0].address).toBe("boss@example.com");
    const smsSeed: any = await svc.addSeedRecipient("org-1", "owner-1", { channel: "sms", address: "01712345679" });
    await expect(svc.testSendBroadcastToSeed("org-1", "owner-1", bc.id, smsSeed.id)).rejects.toMatchObject({ code: "messaging.seedRecipientIsAChannelAddress" });
    const removed: any = await svc.removeSeedRecipient("org-1", "owner-1", seed.id);
    expect(removed.deleted).toBe(true);
    expect((await svc.listSeedRecipients("org-1")).map((s: any) => s.id)).not.toContain(seed.id);
  });
  it("checklist v2 over the real audience sample flags the empty lastOrderNumber; without an audience the variable check is not_run", async () => {
    const { svc } = build();
    const withAudience: any = await svc.checkComposeV2("org-1", {
      channel: "email", subject: "Hi", body: "হ্যালো {{name}}, শেষ অর্ডার {{lastOrderNumber}}",
      audienceType: "customers",
    } as any);
    const vc = withAudience.checks.find((c: any) => c.code === "VARIABLES_SAMPLE");
    expect(vc.status).toBe("warn");
    expect(vc.detail).toMatch(/lastOrderNumber/);
    const noAudience: any = await svc.checkComposeV2("org-1", { channel: "email", subject: "Hi", body: "হ্যালো {{name}}" } as any);
    expect(noAudience.checks.find((c: any) => c.code === "VARIABLES_SAMPLE").status).toBe("not_run");
    expect(noAudience.checks.find((c: any) => c.code === "IMAGE_SIZE").status).toBe("not_run");
  });
});
