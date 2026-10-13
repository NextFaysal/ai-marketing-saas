import { MessagingService } from "./messaging.service";

/**
 * MS1 — broadcast async send engine: recipient snapshot, chunked
 * processing, schedule / pause / resume / cancel / retry-failed,
 * and the sweep (due scheduled + stale-sending recovery).
 * Fake-prisma style like messaging.spec.ts, with a `matches` that
 * honours the operators the engine uses (not / lte / lt) and an
 * update that bumps updatedAt like Prisma's @updatedAt.
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
    findMany: async ({ where, take }: any = {}) => {
      const out = rows.filter((r) => matches(r, where ?? {}));
      return take ? out.slice(0, take) : out;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) { Object.assign(row, data); row.updatedAt = new Date(); } return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

const CUSTOMERS = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `c${n}`, organizationId: "org-1", firstName: `User${n}`, lastName: null,
  email: `user${n}@example.com`, phone: `0171234567${n}`,
}));

function build(opts?: { failFor?: Set<string>; capOverride?: number | null; killSwitch?: boolean; onSend?: (to: string, tables: any) => void }) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
  };
  for (const c of CUSTOMERS) tables.customer.rows.push({ ...c });
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

describe("MS1 prepare + snapshot", () => {
  it("prepare stamps the snapshot (all pending), totalRecipients and status sending", async () => {
    const { svc, tables } = build();
    const bc = await draftEmailBroadcast(svc);
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    expect(prepared.status).toBe("sending");
    expect(prepared.totalRecipients).toBe(6);
    expect(prepared.recipientSnapshot).toHaveLength(6);
    expect(prepared.recipientSnapshot.every((e: any) => e.status === "pending" && e.attempts === 0)).toBe(true);
    expect(tables.broadcast.rows[0].recipientSnapshot[0]).toMatchObject({ type: "customer", id: "c1", email: "user1@example.com" });
  });

  it("the A/B hash split is respected: variants are disjoint and cover the audience", async () => {
    const { svc } = build();
    const created: any = await svc.createBroadcast("org-1", "owner", {
      name: "AB", channel: "email", subject: "s", body: "A body", audienceType: "customers",
      abTest: true, abBody: "B body",
    });
    const [a, b] = created.variants;
    const pa: any = await svc.prepareBroadcast("org-1", a.id);
    const pb: any = await svc.prepareBroadcast("org-1", b.id);
    const idsA = pa.recipientSnapshot.map((e: any) => e.id);
    const idsB = pb.recipientSnapshot.map((e: any) => e.id);
    expect(idsA.filter((id: string) => idsB.includes(id))).toEqual([]);
    expect([...idsA, ...idsB].sort()).toEqual(CUSTOMERS.map((c) => c.id).sort());
    expect(idsA.length).toBeGreaterThan(0);
    expect(idsB.length).toBeGreaterThan(0);
  });

  it("kill-switch and plan cap still block prepare (no snapshot is stamped)", async () => {
    const ks = build({ killSwitch: true });
    const bc1 = await draftEmailBroadcast(ks.svc);
    await expect(ks.svc.prepareBroadcast("org-1", bc1.id)).rejects.toThrow(/paused platform-wide/);
    expect(ks.tables.broadcast.rows[0].recipientSnapshot ?? null).toBeNull();

    const capped = build({ capOverride: 2 });
    const bc2 = await draftEmailBroadcast(capped.svc);
    await expect(capped.svc.prepareBroadcast("org-1", bc2.id)).rejects.toThrow(/per-send cap of 2/);
    expect(capped.tables.broadcast.rows[0].recipientSnapshot ?? null).toBeNull();
  });
});

describe("MS1 chunked processing", () => {
  it("processes in chunks and finalizes counts from the snapshot", async () => {
    const { svc, tables } = build({ failFor: new Set(["user3@example.com"]) });
    const bc = await draftEmailBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const result = await svc.processBroadcast("org-1", bc.id, { chunkSize: 2 });
    expect(result.finalized).toBe(true);
    expect(result.status).toBe("partial");
    expect(result.sent).toBe(5);
    expect(result.failed).toBe(1);
    const row = tables.broadcast.rows[0];
    expect(row.status).toBe("partial");
    expect(row.sentCount).toBe(5);
    expect(row.failedCount).toBe(1);
    expect(row.recipientSnapshot.filter((e: any) => e.status === "sent")).toHaveLength(5);
    expect(row.recipientSnapshot.find((e: any) => e.id === "c3")).toMatchObject({ status: "failed", error: "SMTP rejected recipient", attempts: 1 });
    // Counters never claim more than the deliveries recorded.
    expect(tables.messageDelivery.rows).toHaveLength(6);
  });

  it("pause between chunks leaves the remaining entries pending and untouched; resume completes", async () => {
    let sent = 0;
    const { svc, tables } = build({
      onSend: (_to, t) => {
        sent++;
        if (sent === 2) {
          // Another request pauses the broadcast mid-send.
          const row = t.broadcast.rows[0];
          row.status = "paused";
        }
      },
    });
    const bc = await draftEmailBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const result = await svc.processBroadcast("org-1", bc.id, { chunkSize: 2 });
    expect(result.stopped).toBe("paused");
    expect(result.finalized).toBe(false);
    const row = tables.broadcast.rows[0];
    expect(row.status).toBe("paused");
    const pending = row.recipientSnapshot.filter((e: any) => e.status === "pending");
    expect(pending).toHaveLength(4);
    expect(pending.every((e: any) => e.attempts === 0)).toBe(true);

    const resumed: any = await svc.resumeBroadcast("org-1", "owner", bc.id);
    expect(resumed.status).toBe("sent");
    expect(resumed.progress).toMatchObject({ total: 6, sent: 6, pending: 0 });
  });

  it("cancel marks the remaining entries skipped and a later send refuses", async () => {
    const { svc, tables } = build();
    const bc = await draftEmailBroadcast(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    // External cancel lands on the row (status only, as the cancel
    // endpoint would set before the loop's next chunk re-read).
    tables.broadcast.rows[0].status = "cancelled";
    const result = await svc.processBroadcast("org-1", bc.id, { chunkSize: 2 });
    expect(result.stopped).toBe("cancelled");
    const row = tables.broadcast.rows[0];
    expect(row.status).toBe("cancelled");
    expect(row.recipientSnapshot.every((e: any) => e.status === "skipped" && e.error === "cancelled")).toBe(true);
    await expect(svc.sendBroadcast("org-1", "owner", bc.id)).rejects.toThrow(/cancelled/);
  });

  it("cancelBroadcast is terminal from draft and refuses afterwards", async () => {
    const { svc } = build();
    const bc = await draftEmailBroadcast(svc);
    const cancelled: any = await svc.cancelBroadcast("org-1", "owner", bc.id);
    expect(cancelled.status).toBe("cancelled");
    await expect(svc.sendBroadcast("org-1", "owner", bc.id)).rejects.toThrow(/cancelled/);
    await expect(svc.cancelBroadcast("org-1", "owner", bc.id)).rejects.toThrow(/cannot be cancelled/);
  });
});

describe("MS1 retry-failed", () => {
  it("resends ONLY the failed entries; attempts accumulate", async () => {
    const failFor = new Set(["user2@example.com", "user5@example.com"]);
    const { svc, tables, calls } = build({ failFor });
    const bc = await draftEmailBroadcast(svc);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("partial");
    expect(sent.progress).toMatchObject({ sent: 4, failed: 2 });

    failFor.clear();
    calls.length = 0;
    const retried: any = await svc.retryFailedBroadcast("org-1", "owner", bc.id);
    expect(calls.map((c) => c.to).sort()).toEqual(["user2@example.com", "user5@example.com"]);
    expect(retried.status).toBe("sent");
    const row = tables.broadcast.rows[0];
    expect(row.recipientSnapshot.find((e: any) => e.id === "c2").attempts).toBe(2);
    expect(row.recipientSnapshot.find((e: any) => e.id === "c1").attempts).toBe(1);
  });

  it("a fully-sent broadcast refuses retry (double-send guard preserved)", async () => {
    const { svc } = build();
    const bc = await draftEmailBroadcast(svc);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    await expect(svc.retryFailedBroadcast("org-1", "owner", bc.id)).rejects.toThrow(/no failed recipients/);
    await expect(svc.sendBroadcast("org-1", "owner", bc.id)).rejects.toThrow(/already sent/);
  });
});

describe("MS1 scheduling", () => {
  it("a scheduled broadcast refuses an early manual send; cancelling the schedule frees it", async () => {
    const { svc } = build();
    const bc = await draftEmailBroadcast(svc);
    const future = new Date(Date.now() + 3600_000).toISOString();
    const scheduled: any = await svc.scheduleBroadcast("org-1", "owner", bc.id, future);
    expect(scheduled.status).toBe("scheduled");
    await expect(svc.sendBroadcast("org-1", "owner", bc.id)).rejects.toThrow(/scheduled for/);
    const back: any = await svc.scheduleBroadcast("org-1", "owner", bc.id, null);
    expect(back.status).toBe("draft");
    expect(back.scheduledAt).toBeNull();
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("sent");
  });

  it("create accepts a future scheduledAt (status scheduled) and rejects a past one", async () => {
    const { svc } = build();
    const future = new Date(Date.now() + 3600_000).toISOString();
    const bc: any = await svc.createBroadcast("org-1", "owner", {
      name: "Later", channel: "email", subject: "s", body: "b", audienceType: "customers", scheduledAt: future,
    });
    expect(bc.status).toBe("scheduled");
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "Past", channel: "email", subject: "s", body: "b", audienceType: "customers",
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
    })).rejects.toThrow(/must be in the future/);
  });
});

describe("MS1 sweep (runDueBroadcasts)", () => {
  it("starts a due scheduled broadcast and sends it", async () => {
    const { svc, tables } = build();
    const bc = await draftEmailBroadcast(svc);
    await svc.scheduleBroadcast("org-1", "owner", bc.id, new Date(Date.now() + 3600_000).toISOString());
    tables.broadcast.rows[0].scheduledAt = new Date(Date.now() - 60_000); // now due
    const out = await svc.runDueBroadcasts("org-1");
    expect(out.started).toBe(1);
    expect(out.processed).toBe(6);
    expect(out.finalized).toBe(1);
    expect(tables.broadcast.rows[0].status).toBe("sent");
  });

  it("recovers a stale sending broadcast but leaves a fresh one alone", async () => {
    const { svc, tables } = build();
    const staleBc = await draftEmailBroadcast(svc, "Stale");
    await svc.prepareBroadcast("org-1", staleBc.id);
    const freshBc = await draftEmailBroadcast(svc, "Fresh");
    await svc.prepareBroadcast("org-1", freshBc.id);
    // The stale row was last touched 15 minutes ago (crashed send).
    tables.broadcast.rows.find((r: any) => r.id === staleBc.id).updatedAt = new Date(Date.now() - 15 * 60_000);
    const out = await svc.runDueBroadcasts("org-1");
    expect(out.recovered).toBe(1);
    expect(tables.broadcast.rows.find((r: any) => r.id === staleBc.id).status).toBe("sent");
    expect(tables.broadcast.rows.find((r: any) => r.id === freshBc.id).status).toBe("sending");
  });

  it("a not-yet-due scheduled broadcast is untouched", async () => {
    const { svc, tables } = build();
    const bc = await draftEmailBroadcast(svc);
    await svc.scheduleBroadcast("org-1", "owner", bc.id, new Date(Date.now() + 3600_000).toISOString());
    const out = await svc.runDueBroadcasts("org-1");
    expect(out).toMatchObject({ started: 0, recovered: 0, processed: 0 });
    expect(tables.broadcast.rows[0].status).toBe("scheduled");
  });
});
