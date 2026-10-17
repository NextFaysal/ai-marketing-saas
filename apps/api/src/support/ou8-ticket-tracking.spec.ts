import { SupportService } from "./support.service";
import { issueTicketTrackingToken, verifyTicketTrackingToken } from "./ticket-tracking-token";

/* OU8 — public signed-token ticket tracking. */
(process.env as any).JWT_SECRET = "ou8-test-secret";

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "in" in (v as any)) {
      if (!(v as any).in.includes(row[k])) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findUnique: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))[0] ?? null,
    findMany: async ({ where, orderBy }: any = {}) => {
      const out = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt === "asc") out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return out;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `m-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
  };
}
function makeWorld() {
  const prisma: any = { supportTicket: makeTable(), supportTicketMessage: makeTable() };
  prisma.supportTicket.rows.push({
    id: "t-1", organizationId: "org-1", createdById: "user-9", subject: "পেমেন্ট সমস্যা",
    category: "billing", status: "pending", priority: "normal", diagnostics: { secret: "internal-only" },
    createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-02"), resolvedAt: null, lastMessageAt: new Date("2026-10-02"),
  });
  prisma.supportTicketMessage.rows.push(
    { id: "mm-1", ticketId: "t-1", authorId: "user-9", authorKind: "tenant", isInternal: false, body: "আমার পেমেন্ট আটকে গেছে", createdAt: new Date("2026-10-01T01:00:00Z") },
    { id: "mm-2", ticketId: "t-1", authorId: "admin-1", authorKind: "admin", isInternal: false, body: "যাচাই করা হচ্ছে", createdAt: new Date("2026-10-01T02:00:00Z") },
    { id: "mm-3", ticketId: "t-1", authorId: "admin-1", authorKind: "admin", isInternal: true, body: "INTERNAL: সম্ভবত গেটওয়ে ডাউন, কাস্টমারকে বলা যাবে না", createdAt: new Date("2026-10-01T03:00:00Z") },
  );
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new SupportService(prisma, audit as any);
  return { prisma, svc };
}

describe("OU8 ticket tracking token", () => {
  it("round-trips and rejects tampering / wrong purpose", () => {
    const tok = issueTicketTrackingToken({ ticketId: "t-1", orgId: "org-1" });
    expect(verifyTicketTrackingToken(tok)?.ticketId).toBe("t-1");
    expect(verifyTicketTrackingToken(tok + "x")).toBeNull();
    expect(verifyTicketTrackingToken("garbage")).toBeNull();
  });
});

describe("OU8 public ticket tracking", () => {
  it("public payload shows status + PUBLIC replies only — internal note NEVER leaks", async () => {
    const { svc } = makeWorld();
    const { token } = await svc.issueTrackingToken("org-1", "t-1");
    const view: any = await svc.getPublicTicket(token);
    expect(view.status).toBe("pending");
    expect(view.subject).toBe("পেমেন্ট সমস্যা");
    expect(view.messages).toHaveLength(2);
    expect(JSON.stringify(view)).not.toContain("INTERNAL");
    expect(JSON.stringify(view)).not.toContain("internal-only");
    expect((view as any).diagnostics).toBeUndefined();
  });

  it("bad token and cross-org token both 404", async () => {
    const { svc } = makeWorld();
    await expect(svc.getPublicTicket("bad.token")).rejects.toThrow();
    const foreign = issueTicketTrackingToken({ ticketId: "t-1", orgId: "org-OTHER" });
    await expect(svc.getPublicTicket(foreign)).rejects.toThrow();
  });

  it("public reply lands as a public customer-authored message and reopens a resolved ticket", async () => {
    const { prisma, svc } = makeWorld();
    prisma.supportTicket.rows[0].status = "resolved";
    const { token } = await svc.issueTrackingToken("org-1", "t-1");
    const made: any = await svc.replyPublic(token, "এখনও সমস্যা আছে");
    expect(made.authorKind).toBe("customer");
    const stored = prisma.supportTicketMessage.rows.find((m: any) => m.id === made.id);
    expect(stored.isInternal).toBe(false);
    expect(stored.authorId).toBe("user-9");
    expect(prisma.supportTicket.rows[0].status).toBe("open");
    const view: any = await svc.getPublicTicket(token);
    expect(view.messages.some((m: any) => m.body === "এখনও সমস্যা আছে")).toBe(true);
  });

  it("issue refuses a ticket from another org", async () => {
    const { svc } = makeWorld();
    await expect(svc.issueTrackingToken("org-2", "t-1")).rejects.toThrow();
  });
});
