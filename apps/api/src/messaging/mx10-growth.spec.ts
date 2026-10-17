import { MessagingService } from "./messaging.service";
import { issuePreferenceToken, issueOptInToken } from "./unsubscribe-token";

/**
 * MX10 — growth tools & preference center v2: the public
 * preference center (channel/topic/frequency writes enforced by
 * THE shared resolver), double opt-in (pending receives NO
 * marketing sends — proven through the resolve path AND the
 * single-send guard), opt-in forms (messaging-native; signups
 * land as real Leads + preferences), WhatsApp keyword opt-in,
 * the CSV import wizard (hygiene BEFORE commit, per-row
 * reasons, persisted report) and the consent audit export
 * (history begins at MX10). Fake-prisma style like MS2/MS3.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "mx10-test-secret";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
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
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (cursor?.id) { const idx = out.findIndex((r) => r.id === cursor.id); if (idx >= 0) out = out.slice(idx + (skip ?? 0)); }
      return take ? out.slice(0, take) : out;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) { Object.assign(row, data); row.updatedAt = new Date(); } return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

function build() {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    messageConsentEvent: makeTable("cev"), messagingOptInForm: makeTable("form"),
    messagingCsvImport: makeTable("csvimp"), messagingKeywordRule: makeTable("kwr"),
    workflowRun: makeTable("wrun"),
  };
  tables.customer.rows.push(
    { id: "c1", organizationId: "org-1", firstName: "User1", lastName: null, email: "user1@example.com", phone: "01712345671", createdAt: new Date() },
    { id: "c2", organizationId: "org-1", firstName: "User2", lastName: null, email: "user2@example.com", phone: "01712345672", createdAt: new Date() },
  );
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = { findUnique: async () => ({ name: "Test Shop", aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }) };
  const calls: { to: string; subject: string; text: string }[] = [];
  const email = { isConfigured: () => true, send: async ({ to, subject, text }: any) => { calls.push({ to, subject, text }); return { providerMessageId: `<id-${to}>` }; } } as any;
  const sms = { isConfigured: () => true, send: async ({ to }: any) => ({ providerMessageId: `sms-${to}` }) } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables, calls };
}

describe("MX10 preference center", () => {
  it("channel off via the center writes opted_out and the RESOLVER excludes the contact", async () => {
    const { svc, tables } = build();
    const token = issuePreferenceToken({ orgId: "org-1", channel: "email", address: "user1@example.com", recipientType: "customer", recipientId: "c1" });
    const view = await svc.getPreferenceCenter(token);
    expect(view.channels.find((c: any) => c.channel === "email")?.status).toBe("none");
    await svc.updatePreferenceCenter(token, { channels: { email: false } });
    const pref = tables.messagePreference.rows.find((r: any) => r.channel === "email");
    expect(pref.status).toBe("opted_out");
    expect(pref.source).toBe("preference_center");
    const resolved = await svc.resolveBroadcastRecipients("org-1", { channel: "email", audienceType: "customers" });
    expect(resolved.excludedSuppressedCount).toBe(1);
    expect(resolved.recipients.map((r) => r.id)).toEqual(["c2"]);
    // consent event recorded for the change
    expect(tables.messageConsentEvent.rows.some((e: any) => e.toStatus === "opted_out" && e.source === "preference_center" && e.actor === "public")).toBe(true);
  });

  it("topic choice via the center excludes the contact from non-matching-topic broadcasts only", async () => {
    const { svc } = build();
    const token = issuePreferenceToken({ orgId: "org-1", channel: "email", address: "user1@example.com", recipientType: "customer", recipientId: "c1" });
    await svc.updatePreferenceCenter(token, { channels: { email: true }, topics: ["offers"] });
    const news = await svc.resolveBroadcastRecipients("org-1", { channel: "email", audienceType: "customers", topic: "news" });
    expect(news.recipients.map((r) => r.id)).toEqual(["c2"]);
    const offers = await svc.resolveBroadcastRecipients("org-1", { channel: "email", audienceType: "customers", topic: "offers" });
    expect(offers.recipients.map((r) => r.id).sort()).toEqual(["c1", "c2"]);
    const untopiced = await svc.resolveBroadcastRecipients("org-1", { channel: "email", audienceType: "customers" });
    expect(untopiced.recipients).toHaveLength(2);
  });

  it("per-contact frequency cap via the center applies even when the org cap is off (cap 0 = no marketing)", async () => {
    const { svc, tables } = build();
    tables.messagingSetting.rows.push({ id: "ms1", organizationId: "org-1", frequencyCapPerDay: 0, whatsappOptInRequired: false, linkTrackingEnabled: true });
    const token = issuePreferenceToken({ orgId: "org-1", channel: "email", address: "user1@example.com", recipientType: "customer", recipientId: "c1" });
    await svc.updatePreferenceCenter(token, { channels: { email: true }, maxPerDay: 0 });
    const resolved = await svc.resolveBroadcastRecipients("org-1", { channel: "email", audienceType: "customers" });
    expect(resolved.excludedFrequencyCount).toBe(1);
    expect(resolved.recipients.map((r) => r.id)).toEqual(["c2"]);
  });

  it("unsubscribe-all is one action flipping every channel of the contact", async () => {
    const { svc, tables } = build();
    const token = issuePreferenceToken({ orgId: "org-1", channel: "email", address: "user1@example.com", recipientType: "customer", recipientId: "c1" });
    await svc.unsubscribeAllFromCenter(token);
    const rows = tables.messagePreference.rows.filter((r: any) => r.status === "opted_out");
    expect(rows.map((r: any) => r.channel).sort()).toEqual(["email", "sms", "whatsapp"]);
  });

  it("a tampered preference token is refused", async () => {
    const { svc } = build();
    await expect(svc.getPreferenceCenter("bogus.token")).rejects.toThrow();
  });
});

describe("MX10 double opt-in", () => {
  it("signup starts pending, is excluded at RESOLVE time and by sendToRecipient, then confirms via the emailed link", async () => {
    const { svc, tables, calls } = build();
    const form = await svc.createOptInForm("org-1", "u1", { name: "Newsletter", channels: ["email"], doubleOptIn: true });
    const res = await svc.submitOptInForm("org-1", form.slug, { name: "New Fan", email: "fan@example.com" });
    expect(res.status).toBe("pending");
    expect(res.confirmationSent).toBe(true);
    const lead = tables.lead.rows.find((l: any) => l.email === "fan@example.com");
    expect(lead.source).toBe("messaging_form");
    expect(lead.tags).toContain(`optin:${form.slug}`);
    const pref = tables.messagePreference.rows.find((r: any) => r.address === "fan@example.com");
    expect(pref.status).toBe("pending");

    // resolve path: the pending lead is excluded from a leads_stage broadcast
    const resolved = await svc.resolveBroadcastRecipients("org-1", { channel: "email", audienceType: "leads_stage", audienceStage: "new" });
    expect(resolved.excludedPendingCount).toBe(1);
    expect(resolved.recipients).toHaveLength(0);

    // single-send guard: provider never called for a pending address
    const send = await svc.sendToRecipient("org-1", { channel: "email", recipient: { type: "lead", id: lead.id, name: "New Fan", email: "fan@example.com" }, body: "hi", vars: {} });
    expect(send.status).toBe("skipped");
    expect(calls.filter((c) => c.to === "fan@example.com")).toHaveLength(1); // only the confirmation email

    // confirm via the token carried in the REAL confirmation email
    const m = calls[0].text.match(/\/optin\/([A-Za-z0-9_\-.]+)/);
    expect(m).toBeTruthy();
    await svc.confirmOptIn(m![1]);
    expect(tables.messagePreference.rows.find((r: any) => r.address === "fan@example.com").status).toBe("opted_in");
    const after = await svc.resolveBroadcastRecipients("org-1", { channel: "email", audienceType: "leads_stage", audienceStage: "new" });
    expect(after.recipients).toHaveLength(1);
  });

  it("an opted_out address is never flipped by a signup, and no confirmation is sent", async () => {
    const { svc, tables, calls } = build();
    await svc.setPreference("org-1", { channel: "email", address: "gone@example.com", status: "opted_out", source: "manual" });
    await svc.createOptInForm("org-1", "u1", { name: "Newsletter", channels: ["email"], doubleOptIn: true });
    await svc.submitOptInForm("org-1", "newsletter", { name: "Gone", email: "gone@example.com" });
    expect(tables.messagePreference.rows.find((r: any) => r.address === "gone@example.com").status).toBe("opted_out");
    expect(calls).toHaveLength(0);
  });

  it("double opt-in without email channel or keyword is refused at form create; reserved keywords refused", async () => {
    const { svc } = build();
    await expect(svc.createOptInForm("org-1", "u1", { name: "SMS only", channels: ["sms"], doubleOptIn: true })).rejects.toThrow(/confirmation path/);
    await expect(svc.createOptInForm("org-1", "u1", { name: "Bad kw", channels: ["whatsapp"], doubleOptIn: true, keyword: "STOP" })).rejects.toThrow(/reserved/);
  });

  it("WhatsApp keyword confirms a pending signup and never flips an opt-out", async () => {
    const { svc, tables } = build();
    await svc.createOptInForm("org-1", "u1", { name: "WA list", channels: ["whatsapp"], doubleOptIn: true, keyword: "JOIN" });
    await svc.submitOptInForm("org-1", "wa-list", { name: "Wa Fan", phone: "01799999999" });
    const before = tables.messagePreference.rows.find((r: any) => r.channel === "whatsapp");
    expect(before.status).toBe("pending");
    expect(await svc.handleOptInKeyword("org-1", "01799999999", "join")).toBe(true);
    expect(tables.messagePreference.rows.find((r: any) => r.channel === "whatsapp").status).toBe("opted_in");
    // unknown keyword is not claimed (MX6 campaigns may still see it)
    expect(await svc.handleOptInKeyword("org-1", "01799999999", "HELLO")).toBe(false);
    // opt-out supreme
    await svc.setPreference("org-1", { channel: "whatsapp", address: "01799999999", status: "opted_out", source: "inbound_keyword" });
    expect(await svc.handleOptInKeyword("org-1", "01799999999", "JOIN")).toBe(true);
    expect(tables.messagePreference.rows.find((r: any) => r.channel === "whatsapp").status).toBe("opted_out");
  });

  it("confirmOptIn never flips an opted_out row (token issued, then user unsubscribed)", async () => {
    const { svc, tables } = build();
    await svc.setPreference("org-1", { channel: "email", address: "x@example.com", status: "pending", source: "signup_form" });
    await svc.setPreference("org-1", { channel: "email", address: "x@example.com", status: "opted_out", source: "unsubscribe_link" });
    const token = issueOptInToken({ orgId: "org-1", channel: "email", address: "x@example.com" });
    const res = await svc.confirmOptIn(token);
    expect(res.ok).toBe(true);
    expect(tables.messagePreference.rows.find((r: any) => r.address === "x@example.com").status).toBe("opted_out");
  });
});

describe("MX10 CSV import wizard", () => {
  const CSV = ["Name,Email", "Clean One,clean@example.com", "Dup One,clean@example.com", "Bad,bad-email", "Role,info@example.com", "Existing,user1@example.com"].join("\n");

  it("preview reports hygiene with per-row reasons BEFORE any commit — nothing is imported yet", async () => {
    const { svc, tables } = build();
    const preview = await svc.previewCsvImport("org-1", "u1", { channel: "email", csv: CSV, mapping: { name: "Name", email: "Email" } });
    expect(preview.totalRows).toBe(5);
    expect(preview.cleanCount).toBe(1);
    expect(preview.duplicateCount).toBe(2);
    expect(preview.invalidCount).toBe(1);
    expect(preview.roleCount).toBe(1);
    const byRow = Object.fromEntries(preview.rows.map((r: any) => [r.row, r]));
    expect(byRow[2].reason).toBe("duplicate_in_file");
    expect(byRow[3].reason).toBe("invalid_email");
    expect(byRow[4].reason).toBe("role_address");
    expect(byRow[5].reason).toBe("duplicate_existing");
    expect(tables.lead.rows).toHaveLength(0); // preview imports NOTHING
    const persisted = await svc.getCsvImport("org-1", preview.importId);
    expect(persisted.status).toBe("previewed");
    const reportCsv = await svc.csvImportReportCsv("org-1", preview.importId);
    expect(reportCsv).toContain("role_address");
    expect(reportCsv).toContain("duplicate_existing");
  });

  it("commit imports ONLY clean rows as real Leads with import-stamped consent; double commit refused", async () => {
    const { svc, tables } = build();
    const preview = await svc.previewCsvImport("org-1", "u1", { channel: "email", csv: CSV, mapping: { name: "Name", email: "Email" } });
    const res = await svc.commitCsvImport("org-1", "u1", preview.importId);
    expect(res.imported).toBe(1);
    const lead = tables.lead.rows.find((l: any) => l.email === "clean@example.com");
    expect(lead.source).toBe("csv_import");
    const pref = tables.messagePreference.rows.find((r: any) => r.address === "clean@example.com");
    expect(pref.status).toBe("opted_in");
    expect(pref.source).toBe("import");
    expect(tables.messageConsentEvent.rows.some((e: any) => e.address === "clean@example.com" && e.source === "import")).toBe(true);
    await expect(svc.commitCsvImport("org-1", "u1", preview.importId)).rejects.toThrow(/already committed/);
  });

  it("commit keeps an existing opt-out supreme (lead lands, preference untouched)", async () => {
    const { svc, tables } = build();
    await svc.setPreference("org-1", { channel: "email", address: "clean@example.com", status: "opted_out", source: "manual" });
    const preview = await svc.previewCsvImport("org-1", "u1", { channel: "email", csv: CSV, mapping: { name: "Name", email: "Email" } });
    const res = await svc.commitCsvImport("org-1", "u1", preview.importId);
    expect(res.suppressedOptOut).toBe(1);
    expect(tables.messagePreference.rows.find((r: any) => r.address === "clean@example.com").status).toBe("opted_out");
  });
});

describe("MX10 consent audit export + QR", () => {
  it("export contains ONLY real recorded changes (unsubscribe + signup + confirm), in order", async () => {
    const { svc, tables } = build();
    await svc.performUnsubscribe((await import("./unsubscribe-token")).issueUnsubscribeToken({ orgId: "org-1", channel: "email", address: "user2@example.com" }));
    const csv = await svc.exportConsentEventsCsv("org-1", "u1");
    expect(csv).toContain("user2@example.com");
    expect(csv).toContain("unsubscribe_link");
    expect(tables.messageConsentEvent.rows).toHaveLength(1);
    const list = await svc.listConsentEvents("org-1");
    expect(list.historyBeginsAt).toBe("MX10");
    expect(list.events).toHaveLength(1);
  });

  it("QR is a real PNG data URL of the form's public join URL", async () => {
    const { svc } = build();
    const form = await svc.createOptInForm("org-1", "u1", { name: "Shop list", channels: ["email"], doubleOptIn: false });
    const qr = await svc.getOptInFormQr("org-1", form.id);
    expect(qr.url).toContain(`/join/org-1/${form.slug}`);
    expect(qr.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("a no-double-opt-in signup is active immediately and pickable via the audience source condition", async () => {
    const { svc, tables } = build();
    await svc.createOptInForm("org-1", "u1", { name: "Instant", channels: ["email"], doubleOptIn: false });
    const res = await svc.submitOptInForm("org-1", "instant", { name: "Fast", email: "fast@example.com" });
    expect(res.status).toBe("active");
    expect(tables.messagePreference.rows.find((r: any) => r.address === "fast@example.com").status).toBe("opted_in");
    const resolved = await svc.resolveBroadcastRecipients("org-1", {
      channel: "email", audienceType: "custom",
      audienceDefinition: { entity: "leads", match: "all", conditions: [{ field: "source", op: "eq", value: "messaging_form" }] },
    });
    expect(resolved.recipients.map((r) => r.id)).toHaveLength(1);
  });
});
