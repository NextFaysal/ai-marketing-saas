import { MessagingService, BROADCAST_RECIPIENT_WRITE_CHUNK } from "./messaging.service";

/**
 * MX1 — recipient table & scale engine v2: chunked writes from
 * the shared resolver into BroadcastRecipient, dedupe by
 * (broadcastId, dedupeKey), chunked processing with counters
 * derived from the rows, pause/cancel/retry/resume on rows, and
 * the dual path (pre-MX1 snapshot broadcasts keep the legacy
 * behaviour byte-for-byte, including the stuck-sending refusal).
 * Fake-prisma style like ms1-broadcast-engine.spec.ts, extended
 * with cursor/sortIndex-aware findMany, count, createMany (with
 * the unique constraint enforced), updateMany and deleteMany —
 * the exact surface the MX1 engine uses.
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

/** The BroadcastRecipient fake: a generic table PLUS createMany
 * that enforces the (broadcastId, dedupeKey) unique constraint
 * exactly like the migration (skipDuplicates skips, a plain
 * duplicate throws), and records every chunk size it is fed. */
function makeRecipientTable() {
  const table: any = makeTable("bcr");
  const createManyCalls: number[] = [];
  table.createManyCalls = createManyCalls;
  table.createMany = async ({ data, skipDuplicates }: any) => {
    createManyCalls.push(data.length);
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
  const baseCreate = table.create;
  table.create = async (args: any) => {
    const dupe = table.rows.some((r: any) => r.broadcastId === args.data.broadcastId && r.dedupeKey === args.data.dedupeKey);
    if (dupe) throw new Error("Unique constraint failed on the fields: (`broadcastId`,`dedupeKey`)");
    return baseCreate(args);
  };
  return table;
}

const CUSTOMERS = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `c${n}`, organizationId: "org-1", firstName: `User${n}`, lastName: null,
  email: `user${n}@example.com`, phone: `0171234567${n}`,
}));

function build(opts?: { failFor?: Set<string>; capOverride?: number | null; killSwitch?: boolean; onSend?: (to: string, tables: any) => void; extraCustomers?: any[] }) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    broadcastRecipient: makeRecipientTable(),
    order: makeTable("ord"),
  };
  for (const c of CUSTOMERS) tables.customer.rows.push({ ...c });
  for (const c of opts?.extraCustomers ?? []) tables.customer.rows.push({ ...c });
  tables.systemSetting = {
    findUnique: async ({ where }: any) => (where.key === "killSwitches" && opts?.killSwitch ? { key: where.key, value: { broadcastsPaused: true } } : null),
  };
  tables.organization = {
    findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: opts?.capOverride ?? null, seatLimit: null }),
  };
  const calls: { to: string; subject: string; text: string }[] = [];
  const email = {
    isConfigured: () => true,
    send: async ({ to, subject, text }: any) => {
      calls.push({ to, subject, text });
      opts?.onSend?.(to, tables);
      if (opts?.failFor?.has(to)) throw new Error("SMTP rejected recipient");
      return { providerMessageId: `<id-${to}>` };
    },
  } as any;
  const sms = { isConfigured: () => false, send: async () => { throw new Error("SMS is not configured"); } } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables, calls };
}

async function draftEmailBroadcast(svc: MessagingService, name = "Eid mail") {
  return svc.createBroadcast("org-1", "owner", { name, channel: "email", subject: "Eid offer", body: "Hello {{name}}", audienceType: "customers" });
}

const recipientRows = (tables: any, broadcastId: string) =>
  tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === broadcastId)
    .sort((a: any, b: any) => a.sortIndex - b.sortIndex);

describe("MX1 prepare — chunked recipient-table writes", () => {
  it("writes rows in chunks, stamps NO Json snapshot, and freezes the set in sort order", async () => {
    const { svc, tables } = build();
    const bc = await draftEmailBroadcast(svc);
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id, { recipientChunkSize: 2 });
    expect(prepared.status).toBe("sending");
    expect(prepared.totalRecipients).toBe(6);
    // The MX1 choice: new broadcasts stamp no snapshot at all.
    expect(prepared.recipientSnapshot ?? null).toBeNull();
    expect(tables.broadcast.rows[0].recipientSnapshot ?? null).toBeNull();
    // Multi-chunk proof: three createMany calls of 2, none larger.
    expect(tables.broadcastRecipient.createManyCalls).toEqual([2, 2, 2]);
    const rows = recipientRows(tables, bc.id);
    expect(rows).toHaveLength(6);
    expect(rows.map((r: any) => r.sortIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.every((r: any) => r.status === "pending" && r.attempts === 0)).toBe(true);
    expect(rows[0]).toMatchObject({
      recipientType: "customer", recipientId: "c1", dedupeKey: "customer:c1",
      email: "user1@example.com", phone: "01712345671", organizationId: "org-1",
    });
    // MS5 vars were built per chunk and stored on the row.
    expect(rows[0].vars).toMatchObject({ name: "User1" });
    // A second prepare refuses — the recipient set is frozen.
    await expect(svc.prepareBroadcast("org-1", bc.id)).rejects.toMatchObject({ code: "messaging.thisBroadcastWasAlreadySentOr" });
    expect(recipientRows(tables, bc.id)).toHaveLength(6);
  });

  it("dedupes a recipient produced twice by overlapping audience sources (written once)", async () => {
    const { svc, tables } = build();
    // The same customer row scanned twice (overlapping source).
    tables.customer.rows.push({ ...CUSTOMERS[0] });
    tables.customer.rows.push({ ...CUSTOMERS[2] });
    const bc = await draftEmailBroadcast(svc);
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    expect(prepared.totalRecipients).toBe(6);
    const rows = recipientRows(tables, bc.id);
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r: any) => r.dedupeKey)).size).toBe(6);
    // And the table-level unique constraint itself refuses a
    // second row for the same (broadcastId, dedupeKey).
    await expect(tables.broadcastRecipient.create({
      data: {
        organizationId: "org-1", broadcastId: bc.id, recipientType: "customer", recipientId: "c1",
        dedupeKey: "customer:c1", name: "User1", email: "user1@example.com", phone: null, status: "pending", attempts: 0, sortIndex: 99,
      },
    })).rejects.toThrow(/Unique constraint/);
  });

  it("preview and prepare agree exactly (the ONE shared resolver, suppression included)", async () => {
    const { svc, tables } = build();
    for (const n of [2, 5]) {
      tables.messagePreference.rows.push({
        id: `pref-${n}`, organizationId: "org-1", channel: "email",
        address: `user${n}@example.com`, status: "opted_out", source: "manual",
      });
    }
    const preview: any = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers" });
    expect(preview.total).toBe(4);
    expect(preview.excludedSuppressedCount).toBe(2);
    const bc = await draftEmailBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const ids = recipientRows(tables, bc.id).map((r: any) => r.recipientId).sort();
    expect(ids).toEqual(["c1", "c3", "c4", "c6"]);
  });

  it("plan cap is a POLICY refusal with the exact message and NO recipient rows left behind", async () => {
    const { svc, tables } = build({ capOverride: 2 });
    const bc = await draftEmailBroadcast(svc);
    await expect(svc.prepareBroadcast("org-1", bc.id, { recipientChunkSize: 2 }))
      .rejects.toMatchObject({ code: "messaging.audienceHasTotalRecipientsOverThe" });
    expect(recipientRows(tables, bc.id)).toHaveLength(0);
    expect(tables.broadcast.rows[0].status).toBe("draft");
    expect(tables.broadcast.rows[0].recipientSnapshot ?? null).toBeNull();
  });

  it("kill-switch refusal happens before any recipient row is written", async () => {
    const { svc, tables } = build({ killSwitch: true });
    const bc = await draftEmailBroadcast(svc);
    await expect(svc.prepareBroadcast("org-1", bc.id)).rejects.toMatchObject({ code: "messaging.broadcastsAreTemporarilyPausedPlatformWide" });
    expect(recipientRows(tables, bc.id)).toHaveLength(0);
    expect(tables.broadcastRecipient.createManyCalls).toEqual([]);
  });

  it("an audience emptied by suppression refuses with the honest message and writes nothing", async () => {
    const { svc, tables } = build();
    for (const c of CUSTOMERS) {
      tables.messagePreference.rows.push({
        id: `pref-${c.id}`, organizationId: "org-1", channel: "email",
        address: c.email, status: "opted_out", source: "manual",
      });
    }
    const bc = await draftEmailBroadcast(svc);
    await expect(svc.prepareBroadcast("org-1", bc.id)).rejects.toMatchObject({ code: "messaging.audienceEmptyAfterExclusions" });
    expect(recipientRows(tables, bc.id)).toHaveLength(0);
  });
});

describe("MX1 process — chunked, counters derived from rows", () => {
  it("processes in chunks and finalizes counters that never exceed the recorded deliveries", async () => {
    const { svc, tables } = build({ failFor: new Set(["user3@example.com"]) });
    const bc = await draftEmailBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const result = await svc.processBroadcast("org-1", bc.id, { chunkSize: 2 });
    expect(result).toMatchObject({ finalized: true, status: "partial", processed: 6, sent: 5, failed: 1, skipped: 0, pending: 0 });
    const row = tables.broadcast.rows[0];
    expect(row.status).toBe("partial");
    expect(row).toMatchObject({ totalRecipients: 6, sentCount: 5, failedCount: 1, skippedCount: 0 });
    const rows = recipientRows(tables, bc.id);
    expect(rows.filter((r: any) => r.status === "sent")).toHaveLength(5);
    expect(rows.find((r: any) => r.recipientId === "c3")).toMatchObject({ status: "failed", error: "SMTP rejected recipient", attempts: 1 });
    expect(rows.find((r: any) => r.recipientId === "c1")).toMatchObject({ status: "sent", providerMessageId: "<id-user1@example.com>", address: "user1@example.com" });
    expect(tables.messageDelivery.rows).toHaveLength(6);
    // Progress (the web's source) derives truthfully with no snapshot.
    const listed: any = await svc.listBroadcasts("org-1");
    expect(listed[0].progress).toMatchObject({ total: 6, sent: 5, failed: 1, skipped: 0, pending: 0 });
  });

  it("pause between chunks leaves pending rows untouched; resume completes without re-sends", async () => {
    let sent = 0;
    const { svc, tables, calls } = build({
      onSend: (_to, t) => {
        sent++;
        if (sent === 2) t.broadcast.rows[0].status = "paused";
      },
    });
    const bc = await draftEmailBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const result = await svc.processBroadcast("org-1", bc.id, { chunkSize: 2 });
    expect(result.stopped).toBe("paused");
    expect(result.finalized).toBe(false);
    const pending = recipientRows(tables, bc.id).filter((r: any) => r.status === "pending");
    expect(pending).toHaveLength(4);
    expect(pending.every((r: any) => r.attempts === 0)).toBe(true);

    const resumed: any = await svc.resumeBroadcast("org-1", "owner", bc.id);
    expect(resumed.status).toBe("sent");
    expect(resumed.progress).toMatchObject({ total: 6, sent: 6, pending: 0 });
    // Exactly one provider call per recipient across pause+resume.
    expect(calls).toHaveLength(6);
    expect(new Set(calls.map((c) => c.to)).size).toBe(6);
  });

  it("resume after a simulated interruption (partial chunks, then the sweep) never re-sends a confirmed recipient", async () => {
    const { svc, tables, calls } = build();
    const bc = await draftEmailBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    // Process only the first chunks, then "crash".
    const partial = await svc.processBroadcast("org-1", bc.id, { chunkSize: 2, maxEntries: 4 });
    expect(partial).toMatchObject({ processed: 4, finalized: false, sent: 4, pending: 2 });
    expect(calls).toHaveLength(4);
    // The row goes stale, as a crashed process would leave it.
    tables.broadcast.rows[0].updatedAt = new Date(Date.now() - 15 * 60_000);
    const out = await svc.runDueBroadcasts("org-1");
    expect(out.recovered).toBe(1);
    expect(out.finalized).toBe(1);
    expect(tables.broadcast.rows[0].status).toBe("sent");
    // The provider saw each recipient exactly once, total.
    expect(calls).toHaveLength(6);
    expect(new Set(calls.map((c) => c.to)).size).toBe(6);
    expect(tables.messageDelivery.rows).toHaveLength(6);
    expect(recipientRows(tables, bc.id).every((r: any) => r.status === "sent" && r.attempts === 1)).toBe(true);
  });

  it("cancelBroadcast marks pending rows skipped (reason cancelled) and a later send refuses", async () => {
    const { svc, tables } = build();
    const bc = await draftEmailBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const cancelled: any = await svc.cancelBroadcast("org-1", "owner", bc.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.skippedCount).toBe(6);
    const rows = recipientRows(tables, bc.id);
    expect(rows.every((r: any) => r.status === "skipped" && r.error === "cancelled" && r.attempts === 0)).toBe(true);
    await expect(svc.sendBroadcast("org-1", "owner", bc.id)).rejects.toMatchObject({ code: "messaging.thisBroadcastWasCancelledAndCan" });
  });

  it("a mid-process external cancel marks the remaining rows skipped and stays cancelled", async () => {
    const { svc, tables } = build({
      onSend: (_to, t) => { t.broadcast.rows[0].status = "cancelled"; },
    });
    const bc = await draftEmailBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const result = await svc.processBroadcast("org-1", bc.id, { chunkSize: 2 });
    expect(result.stopped).toBe("cancelled");
    const rows = recipientRows(tables, bc.id);
    expect(rows.filter((r: any) => r.status === "sent")).toHaveLength(2);
    expect(rows.filter((r: any) => r.status === "skipped" && r.error === "cancelled")).toHaveLength(4);
    expect(tables.broadcast.rows[0]).toMatchObject({ status: "cancelled", sentCount: 2, skippedCount: 4 });
  });

  it("retry-failed resends ONLY the failed rows; attempts accumulate on the rows", async () => {
    const failFor = new Set(["user2@example.com", "user5@example.com"]);
    const { svc, tables, calls } = build({ failFor });
    const bc = await draftEmailBroadcast(svc);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("partial");
    expect(sent.progress).toMatchObject({ sent: 4, failed: 2 });
    expect(sent.recipientSnapshot).toBeUndefined();

    failFor.clear();
    calls.length = 0;
    const retried: any = await svc.retryFailedBroadcast("org-1", "owner", bc.id);
    expect(calls.map((c) => c.to).sort()).toEqual(["user2@example.com", "user5@example.com"]);
    expect(retried.status).toBe("sent");
    const rows = recipientRows(tables, bc.id);
    expect(rows.find((r: any) => r.recipientId === "c2").attempts).toBe(2);
    expect(rows.find((r: any) => r.recipientId === "c1").attempts).toBe(1);
    expect(tables.broadcast.rows[0]).toMatchObject({ sentCount: 6, failedCount: 0 });
    // A fully-sent broadcast still refuses retry (double-send guard).
    await expect(svc.retryFailedBroadcast("org-1", "owner", bc.id)).rejects.toMatchObject({ code: "messaging.thisBroadcastHasNoFailedRecipients" });
  });
});

describe("MX1 scale — beyond snapshot scale through the chunked path", () => {
  it("3000 recipients: chunked writes, no snapshot, chunked processing, exact counters", async () => {
    const extraCustomers = Array.from({ length: 2994 }, (_, i) => ({
      id: `x${i + 1}`, organizationId: "org-1", firstName: `Bulk${i + 1}`, lastName: null,
      email: `bulk${i + 1}@example.com`, phone: `0171000${String(i + 1).padStart(4, "0")}`,
    }));
    const { svc, tables, calls } = build({ capOverride: 5000, extraCustomers });
    const bc = await draftEmailBroadcast(svc, "Bulk mail");
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id, { recipientChunkSize: 250 });
    expect(prepared.totalRecipients).toBe(3000);
    expect(prepared.recipientSnapshot ?? null).toBeNull();
    // 12 chunk writes of at most 250 — never one giant write.
    expect(tables.broadcastRecipient.createManyCalls).toHaveLength(12);
    expect(Math.max(...tables.broadcastRecipient.createManyCalls)).toBeLessThanOrEqual(250);
    expect(tables.broadcastRecipient.rows).toHaveLength(3000);

    const result = await svc.processBroadcast("org-1", bc.id, { chunkSize: 100 });
    expect(result).toMatchObject({ finalized: true, status: "sent", processed: 3000, sent: 3000, failed: 0, pending: 0 });
    expect(calls).toHaveLength(3000);
    expect(tables.messageDelivery.rows).toHaveLength(3000);
    expect(tables.broadcast.rows[0]).toMatchObject({ totalRecipients: 3000, sentCount: 3000, failedCount: 0, skippedCount: 0 });
    expect(BROADCAST_RECIPIENT_WRITE_CHUNK).toBe(500);
  }, 120000);
});

describe("MX1 dual path — legacy snapshot broadcasts are byte-for-byte", () => {
  it("a pre-MX1 broadcast with ONLY a recipientSnapshot processes through the snapshot and writes no recipient rows", async () => {
    const { svc, tables, calls } = build();
    tables.broadcast.rows.push({
      id: "bc-legacy", organizationId: "org-1", name: "Legacy", channel: "email",
      subject: "s", body: "Hi {{name}}", htmlBody: null,
      audienceType: "customers", audienceStage: null, audienceSegment: null,
      status: "sending", totalRecipients: 2, sentCount: 0, failedCount: 0,
      createdById: "owner", createdAt: new Date(), updatedAt: new Date(),
      recipientSnapshot: [
        { type: "customer", id: "c1", name: "User1", email: "user1@example.com", phone: null, status: "pending", attempts: 0 },
        { type: "customer", id: "c2", name: "User2", email: "user2@example.com", phone: null, status: "pending", attempts: 0 },
      ],
    });
    const result = await svc.processBroadcast("org-1", "bc-legacy");
    expect(result).toMatchObject({ finalized: true, status: "sent", sent: 2 });
    expect(calls).toHaveLength(2);
    const row = tables.broadcast.rows.find((r: any) => r.id === "bc-legacy");
    expect(row.recipientSnapshot).toHaveLength(2);
    expect(row.recipientSnapshot.every((e: any) => e.status === "sent" && e.providerMessageId)).toBe(true);
    expect(row.sentCount).toBe(2);
    // The recipient table was never touched for the legacy row.
    expect(tables.broadcastRecipient.rows).toHaveLength(0);
    expect(tables.broadcastRecipient.createManyCalls).toEqual([]);
  });

  it("a stuck 'sending' row with neither snapshot nor recipient rows refuses with the historical message", async () => {
    const { svc, tables, calls } = build();
    tables.broadcast.rows.push({
      id: "bc-stuck", organizationId: "org-1", name: "Stuck", channel: "email",
      subject: "s", body: "Hi", htmlBody: null,
      audienceType: "customers", audienceStage: null, audienceSegment: null,
      status: "sending", totalRecipients: 3, sentCount: 0, failedCount: 0,
      createdById: "owner", createdAt: new Date(), updatedAt: new Date(),
      recipientSnapshot: null,
    });
    await expect(svc.processBroadcast("org-1", "bc-stuck"))
      .rejects.toMatchObject({ code: "messaging.thisBroadcastWasAlreadySentOr" });
    await expect(svc.sendBroadcast("org-1", "owner", "bc-stuck"))
      .rejects.toMatchObject({ code: "messaging.thisBroadcastWasAlreadySentOr" });
    expect(calls).toHaveLength(0);
    expect(tables.messageDelivery.rows).toHaveLength(0);
  });
});
