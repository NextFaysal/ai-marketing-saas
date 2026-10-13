import { MessagingService, maskEmailAddress, maskPhoneAddress } from "./messaging.service";

/**
 * CX10 — broadcast previous-recipient exclusion + preview.
 * Fake-prisma style like messaging.spec.ts, but with a `matches`
 * that honours the operators the CX10 resolver uses
 * (broadcastId { not: null }, status, organizationId).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
  };
}

const CUSTOMERS = [
  { id: "c1", firstName: "Ayesha", lastName: "Rahman", email: "ayesha@example.com", phone: "01712345678" },
  { id: "c2", firstName: "Tanvir", lastName: "Hasan", email: "tanvir@example.com", phone: "01812345678" },
  { id: "c3", firstName: "Nusrat", lastName: "Jahan", email: "nusrat@example.com", phone: "01912345678" },
  { id: "c4", firstName: "Rahim", lastName: "Uddin", email: "rahim@example.com", phone: "01612345678" },
  { id: "c5", firstName: "Farhana", lastName: "Akter", email: "farhana@example.com", phone: "01512345678" },
];

function build() {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
  };
  for (const c of CUSTOMERS) tables.customer.rows.push({ organizationId: "org-1", ...c });
  // Delivery history (org-1 unless noted):
  //  c1 — confirmed email broadcast send      → EXCLUDED
  //  c2 — FAILED email broadcast, then a confirmed SMS broadcast → EXCLUDED (any channel counts)
  //  c3 — confirmed send, but for ORG-2       → kept (other orgs never exclude)
  //  c4 — confirmed send, but a WORKFLOW send (broadcastId null) → kept
  //  c5 — only a FAILED broadcast delivery    → kept (never received it)
  tables.messageDelivery.rows.push(
    { id: "d1", organizationId: "org-1", broadcastId: "old-bc-1", channel: "email", recipientType: "customer", recipientId: "c1", address: "ayesha@example.com", status: "sent", providerMessageId: "m1" },
    { id: "d2", organizationId: "org-1", broadcastId: "old-bc-1", channel: "email", recipientType: "customer", recipientId: "c2", address: "tanvir@example.com", status: "failed", providerMessageId: null },
    { id: "d3", organizationId: "org-1", broadcastId: "old-bc-2", channel: "sms", recipientType: "customer", recipientId: "c2", address: "8801812345678", status: "sent", providerMessageId: "m3" },
    { id: "d4", organizationId: "org-2", broadcastId: "other-org-bc", channel: "email", recipientType: "customer", recipientId: "c3", address: "nusrat@example.com", status: "sent", providerMessageId: "m4" },
    { id: "d5", organizationId: "org-1", broadcastId: null, workflowRunId: "run-1", channel: "email", recipientType: "customer", recipientId: "c4", address: "rahim@example.com", status: "sent", providerMessageId: "m5" },
    { id: "d6", organizationId: "org-1", broadcastId: "old-bc-3", channel: "email", recipientType: "customer", recipientId: "c5", address: "farhana@example.com", status: "failed", providerMessageId: null },
  );
  const sentTo: string[] = [];
  const email = { isConfigured: () => true, send: async ({ to }: any) => { sentTo.push(to); return { providerMessageId: `<id-${to}>` }; } } as any;
  const sms = { isConfigured: () => false, send: async () => { throw new Error("SMS is not configured"); } } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables, sentTo };
}

const FINAL_IDS = ["c3", "c4", "c5"];
const FINAL_EMAILS = ["nusrat@example.com", "rahim@example.com", "farhana@example.com"];

describe("CX10 masking shapes", () => {
  it("email → first char + ***@ + domain; phone → first 3 + *** + last 2", () => {
    expect(maskEmailAddress("ayesha@example.com")).toBe("a***@example.com");
    expect(maskPhoneAddress("01712345678")).toBe("017***78");
    expect(maskPhoneAddress("123")).toBe("***");
    expect(maskEmailAddress("no-at-sign")).toBe("***");
  });
});

describe("CX10 preview + exclusion", () => {
  it("counts arithmetic: audienceTotal − excluded = total, with the documented exclusion rules", async () => {
    const { svc } = build();
    const preview = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers", excludePreviousRecipients: true });
    expect(preview.audienceTotal).toBe(5);
    expect(preview.excludedPreviousCount).toBe(2); // c1 (sent) + c2 (sent on another channel)
    expect(preview.total).toBe(3);
    expect(preview.audienceTotal - preview.excludedPreviousCount).toBe(preview.total);
    expect(preview.sample.map((s) => s.name).sort()).toEqual(["Farhana Akter", "Nusrat Jahan", "Rahim Uddin"]);
  });

  it("flag off (or absent) → zero exclusion, full audience", async () => {
    const { svc } = build();
    for (const flag of [false, undefined]) {
      const preview = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers", excludePreviousRecipients: flag });
      expect(preview).toMatchObject({ audienceTotal: 5, excludedPreviousCount: 0, total: 5 });
    }
  });

  it("the sample is capped at 20 and NEVER carries a full address or an id", async () => {
    const { svc, tables } = build();
    for (let i = 6; i <= 25; i++) {
      tables.customer.rows.push({ id: `cx${i}`, organizationId: "org-1", firstName: `Bulk${i}`, lastName: null, email: `bulk${i}@example.com`, phone: null });
    }
    const preview = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers" });
    expect(preview.total).toBe(25);
    expect(preview.sample).toHaveLength(20);
    const payload = JSON.stringify(preview);
    for (const c of tables.customer.rows) {
      if (c.email) expect(payload).not.toContain(c.email);
      expect(payload).not.toContain(`"${c.id}"`);
    }
    for (const s of preview.sample) {
      expect(Object.keys(s).sort()).toEqual(["address", "name", "type"]);
      expect(s.address).toMatch(/^[^@]\*\*\*@/); // exactly one visible char before ***@
    }
  });

  it("phone-channel samples are masked phones", async () => {
    const { svc } = build();
    const preview = await svc.previewBroadcast("org-1", { channel: "sms", audienceType: "customers", excludePreviousRecipients: true });
    expect(preview.total).toBe(3);
    expect(preview.sample.map((s) => s.address).sort()).toEqual(["015***78", "016***78", "019***78"]);
  });
});

describe("CX10 shared resolver: preview set == send set", () => {
  it("sendBroadcast with the flag on delivers to exactly the preview's final set", async () => {
    const { svc, tables, sentTo } = build();
    const preview = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers", excludePreviousRecipients: true });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "Follow-up blast", channel: "email", subject: "আবারও অফার", body: "Hello {{name}}",
      audienceType: "customers", excludePreviousRecipients: true,
    });
    expect(bc.excludePreviousRecipients).toBe(true);
    const sent = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.totalRecipients).toBe(preview.total); // totalRecipients = FINAL post-exclusion count
    expect(sent.sentCount).toBe(3);
    expect(sentTo.sort()).toEqual([...FINAL_EMAILS].sort());
    const deliveredIds = tables.messageDelivery.rows.filter((d: any) => d.broadcastId === bc.id).map((d: any) => d.recipientId).sort();
    expect(deliveredIds).toEqual(FINAL_IDS);
    // The preview sample (names + masked addresses) describes the same people.
    expect(preview.sample.map((s) => s.address).sort()).toEqual(FINAL_EMAILS.map(maskEmailAddress).sort());
  });

  it("a broadcast WITHOUT the flag sends to the whole audience (pre-CX10 behaviour)", async () => {
    const { svc, sentTo } = build();
    const bc = await svc.createBroadcast("org-1", "owner", { name: "All", channel: "email", subject: "s", body: "b", audienceType: "customers" });
    expect(bc.excludePreviousRecipients).toBe(false);
    const sent = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.totalRecipients).toBe(5);
    expect(sentTo).toHaveLength(5);
  });

  it("A/B variants inherit the flag and their splits still sum to the final set", async () => {
    const { svc, tables } = build();
    const res: any = await svc.createBroadcast("org-1", "owner", {
      name: "AB blast", channel: "email", subject: "s", body: "A body", audienceType: "customers",
      excludePreviousRecipients: true, abTest: true, abBody: "B body",
    });
    expect(res.variants).toHaveLength(2);
    for (const v of res.variants) expect(v.excludePreviousRecipients).toBe(true);
    const [a, b] = res.variants;
    await svc.sendBroadcast("org-1", "owner", a.id);
    await svc.sendBroadcast("org-1", "owner", b.id);
    const idsA = tables.messageDelivery.rows.filter((d: any) => d.broadcastId === a.id).map((d: any) => d.recipientId);
    const idsB = tables.messageDelivery.rows.filter((d: any) => d.broadcastId === b.id).map((d: any) => d.recipientId);
    expect([...idsA, ...idsB].sort()).toEqual(FINAL_IDS); // union = the final set
    expect(idsA.filter((id: string) => idsB.includes(id))).toEqual([]); // disjoint
    const rows = tables.broadcast.rows.filter((r: any) => r.abGroupId === res.abGroupId);
    expect(rows.reduce((n: number, r: any) => n + r.totalRecipients, 0)).toBe(3);
  });

  it("tenant isolation: org-2's preview/send are unaffected by org-1's history", async () => {
    const { svc, tables } = build();
    tables.customer.rows.push({ id: "z1", organizationId: "org-2", firstName: "Zed", lastName: null, email: "zed@example.com", phone: null });
    const preview = await svc.previewBroadcast("org-2", { channel: "email", audienceType: "customers", excludePreviousRecipients: true });
    // org-2 audience = z1 + c3 (c3's row is org-1, so only z1) — and
    // org-2's own sent delivery was addressed to recipientId c3,
    // which is not in org-2's audience, so nothing is excluded.
    expect(preview).toMatchObject({ audienceTotal: 1, excludedPreviousCount: 0, total: 1 });
  });
});
