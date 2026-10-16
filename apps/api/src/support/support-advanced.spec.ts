import { SupportService } from "./support.service";

function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      if (!(v as any[]).some((w: any) => match(row, w))) return false;
      continue;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in (v as any)) {
        if (!(new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false;
      } else if ("in" in (v as any)) {
        if (!(v as any).in.includes(row[k])) return false;
      } else if ("not" in (v as any)) {
        if (row[k] === (v as any).not) return false;
      } else {
        return false;
      }
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}

let seq = 0;
function table(seed: any[] = []) {
  const rows = [...seed];
  const sortBy = (out: any[], orderBy: any) => {
    if (!orderBy) return out;
    const [key, dir] = Object.entries(orderBy)[0] as [string, string];
    return [...out].sort((a, b) => {
      const d = new Date(a[key]).getTime() - new Date(b[key]).getTime();
      return dir === "desc" ? -d : d;
    });
  };
  return {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => match(r, args.where ?? {}));
      out = sortBy(out, args.orderBy);
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    findFirst: async (args: any = {}) => {
      const out = sortBy(rows.filter((r) => match(r, args.where ?? {})), args.orderBy ?? { createdAt: "desc" });
      return out[0] ?? null;
    },
    findUnique: async ({ where }: any) => {
      return (
        rows.find(
          (r) =>
            (where.id !== undefined && r.id === where.id) ||
            (where.shortcut !== undefined && r.shortcut === where.shortcut) ||
            (where.organizationId !== undefined && r.organizationId === where.organizationId),
        ) ?? null
      );
    },
    count: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), lastMessageAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    createMany: async ({ data }: any) => {
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        rows.push({ id: `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...item });
      }
      return { count: items.length };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
  };
}

const ADMIN_ACTOR: any = { id: "admin-1", email: "admin@platform.local", isSuperAdmin: true };
const AUDIT_MOCK: any = { log: jest.fn(async () => undefined) };

function makePrisma() {
  return {
    organization: table([
      { id: "org-1", name: "Apex Retail", status: "ACTIVE", createdAt: new Date() },
    ]),
    user: table([
      { id: "user-1", email: "support@apex.test", name: "Apex Lead", status: "ACTIVE" },
    ]),
    membership: table([
      { id: "m-1", userId: "user-1", organizationId: "org-1", role: "OWNER", status: "ACTIVE", user: { email: "support@apex.test" } },
    ]),
    integration: table([
      { id: "int-1", organizationId: "org-1", provider: "META", status: "CONNECTED" },
    ]),
    agentNotification: table([]),
    supportTicket: table([]),
    supportTicketMessage: table([]),
    supportCannedResponse: table([]),
  };
}

describe("Advanced Support System — Service & Workflows", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let support: SupportService;

  beforeEach(() => {
    prisma = makePrisma();
    support = new SupportService(prisma as any, AUDIT_MOCK);
  });

  describe("Ticket Creation & SLA assignment", () => {
    it("creates ticket with priority, category, diagnostics and auto-calculates SLA due time", async () => {
      const before = Date.now();
      const ticket: any = await support.createTicket("org-1", "user-1", {
        subject: "Pixel Tracking Issue",
        body: "Meta Pixel is not firing on checkout page",
        category: "technical",
        priority: "urgent",
        diagnostics: { browser: "Chrome 120", currentPath: "/dashboard/settings" },
        attachments: [{ name: "pixel-error.png", url: "https://cdn.test/pixel.png", size: 1024, mimeType: "image/png" }],
      });

      expect(ticket.id).toBeDefined();
      expect(ticket.priority).toBe("urgent");
      expect(ticket.category).toBe("technical");
      expect(ticket.slaDueAt).toBeDefined();
      // Urgent SLA is 4 hours (~ 4 * 3600 * 1000 ms)
      const dueTime = new Date(ticket.slaDueAt).getTime();
      expect(dueTime).toBeGreaterThanOrEqual(before + 3.9 * 3600 * 1000);
      expect(dueTime).toBeLessThanOrEqual(before + 4.1 * 3600 * 1000);

      // Check initial message has attachment
      expect(ticket.messages[0].attachments).toHaveLength(1);
      expect(ticket.messages[0].attachments[0].name).toBe("pixel-error.png");
    });
  });

  describe("AI Deflection Suggestions", () => {
    it("returns smart deflection suggestions for known integration keywords", async () => {
      const res = await support.suggestSolutions("org-1", {
        subject: "Meta Pixel event not tracked",
        category: "integration",
      });

      expect(res.suggestions.length).toBeGreaterThanOrEqual(1);
      const pixelSuggestion = res.suggestions.find((s) => s.title.includes("Pixel") || (s.link && s.link.includes("pixels")));
      expect(pixelSuggestion).toBeDefined();
    });

    it("returns billing solution for payment queries", async () => {
      const res = await support.suggestSolutions("org-1", {
        subject: "bKash পেমেন্ট আটকে গেছে",
        category: "billing",
      });

      expect(res.suggestions.length).toBeGreaterThanOrEqual(1);
      const billingSuggestion = res.suggestions.find((s) => s.link && s.link.includes("billing"));
      expect(billingSuggestion).toBeDefined();
    });
  });

  describe("Internal Whisper Notes vs Tenant Privacy", () => {
    it("hides internal notes from tenant getTicket view but shows them in admin view", async () => {
      const ticket: any = await support.createTicket("org-1", "user-1", {
        subject: "Campaign stopped",
        body: "My campaign budget ran out",
      });

      // Admin adds internal whisper note
      await support.addInternalNote(ADMIN_ACTOR, ticket.id, {
        body: "Check billing status before increasing spend limit.",
      });

      // Admin adds public reply
      await support.replyAsAdmin(ADMIN_ACTOR, ticket.id, {
        body: "We have reviewed your account and restored the campaign.",
      });

      // 1. Tenant view: must NOT see internal whisper note
      const tenantView: any = await support.getTicket("org-1", ticket.id);
      expect(tenantView.messages).toHaveLength(2); // original ticket + public reply
      expect(tenantView.messages.some((m: any) => m.isInternal === true)).toBe(false);

      // 2. Admin view: MUST see all notes including internal whisper notes
      const adminView: any = await support.getTicketAdmin(ticket.id);
      expect(adminView.messages).toHaveLength(3);
      const internalNote = adminView.messages.find((m: any) => m.isInternal === true);
      expect(internalNote).toBeDefined();
      expect(internalNote.body).toContain("Check billing status");
    });
  });

  describe("CSAT Ratings", () => {
    it("allows tenant to rate and leave feedback on a resolved ticket", async () => {
      const ticket: any = await support.createTicket("org-1", "user-1", {
        subject: "Need invoice",
        body: "Send last month invoice",
      });

      // Resolve ticket
      await support.updateAsAdmin(ADMIN_ACTOR, ticket.id, { status: "resolved" });

      // Submit CSAT
      const rated: any = await support.submitCsat("org-1", "user-1", ticket.id, {
        rating: 5,
        feedback: "খুব দ্রুত সমাধান পেয়েছি, ধন্যবাদ!",
      });

      expect(rated.csatRating).toBe(5);
      expect(rated.csatFeedback).toContain("দ্রুত সমাধান");
    });
  });

  describe("Canned Responses", () => {
    it("seeds default canned responses if table is empty", async () => {
      const canned: any[] = await support.listCannedResponses();
      expect(canned.length).toBeGreaterThanOrEqual(4);
      expect(canned.some((c: any) => c.shortcut === "/meta-reauth")).toBe(true);
      expect(canned.some((c: any) => c.shortcut === "/billing-bkash")).toBe(true);
    });

    it("creates custom canned response and saves to library", async () => {
      const created: any = await support.createCannedResponse(ADMIN_ACTOR, {
        shortcut: "/welcome-intro",
        title: "Welcome Intro",
        category: "general",
        body: "নমস্কার! আমাদের সাপোর্ট টিম আপনাকে সাহায্য করতে প্রস্তুত।",
      });

      expect(created.shortcut).toBe("/welcome-intro");
      const list: any[] = await support.listCannedResponses();
      expect(list.some((c: any) => c.shortcut === "/welcome-intro")).toBe(true);
    });
  });

  describe("Support Analytics Calculation", () => {
    it("computes metrics accurately across resolved and open tickets", async () => {
      // Create and resolve ticket 1 with CSAT 5
      const t1: any = await support.createTicket("org-1", "user-1", {
        subject: "Ticket 1",
        body: "Body 1",
        category: "technical",
        priority: "urgent",
      });
      await support.replyAsAdmin(ADMIN_ACTOR, t1.id, { body: "Done" });
      await support.updateAsAdmin(ADMIN_ACTOR, t1.id, { status: "resolved" });
      await support.submitCsat("org-1", "user-1", t1.id, { rating: 5, feedback: "Great" });

      // Create ticket 2 open with category billing
      await support.createTicket("org-1", "user-1", {
        subject: "Ticket 2",
        body: "Body 2",
        category: "billing",
        priority: "normal",
      });

      const metrics: any = await support.getSupportAnalytics();
      expect(metrics.total).toBe(2);
      expect(metrics.statusCounts["open"]).toBe(1);
      expect(metrics.statusCounts["resolved"]).toBe(1);
      expect(metrics.csat.average).toBe(5);
      expect(metrics.csat.breakdown[5]).toBe(1);
      expect(metrics.categoryCounts["technical"]).toBe(1);
      expect(metrics.categoryCounts["billing"]).toBe(1);
    });
  });

  describe("Realtime SSE Streams & Typing Indicators", () => {
    it("pushes public messages to both tenant and admin streams, but hides internal whisper notes from tenant", async () => {
      const ticket: any = await support.createTicket("org-1", "user-1", {
        subject: "Realtime test",
        body: "Testing SSE push",
      });

      const tenantEvents: any[] = [];
      const adminEvents: any[] = [];

      const tenantStream = await support.getTicketStream("org-1", ticket.id, false);
      const adminStream = await support.getTicketStreamAdmin(ticket.id);

      const subTenant = tenantStream.subscribe((e) => tenantEvents.push(e.data));
      const subAdmin = adminStream.subscribe((e) => adminEvents.push(e.data));

      // Admin posts internal whisper note
      await support.addInternalNote(ADMIN_ACTOR, ticket.id, { body: "Internal whisper note" });

      // Admin posts public reply
      await support.replyAsAdmin(ADMIN_ACTOR, ticket.id, { body: "Public resolution reply" });

      // Typing event
      support.emitTyping(ticket.id, "tenant", true);

      subTenant.unsubscribe();
      subAdmin.unsubscribe();

      // Tenant must NOT receive the internal whisper note
      expect(tenantEvents.some((e) => e.isInternal === true)).toBe(false);
      // Tenant MUST receive public reply and typing event
      expect(tenantEvents.some((e) => e.type === "message.created" && e.data?.body === "Public resolution reply")).toBe(true);
      expect(tenantEvents.some((e) => e.type === "typing" && e.who === "tenant")).toBe(true);

      // Admin MUST receive both public reply and internal whisper note
      expect(adminEvents.some((e) => e.isInternal === true && e.data?.body === "Internal whisper note")).toBe(true);
      expect(adminEvents.some((e) => e.type === "message.created" && e.data?.body === "Public resolution reply")).toBe(true);
    });
  });
});

