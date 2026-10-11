/**
 * UX1 Q2 — conversationFolderCounts unreadTotal.
 *
 * Dedicated minimal spec (imports only InboxService): the tab badge
 * must show the REAL org-wide unread sum (stored unreadCount), never
 * a sum over the capped loaded list. The full folder-count coverage
 * also lives in nextgen-p2.spec.ts; this file exists so the UX1
 * aggregate is verified even while other inbox suites are mid-flight.
 */
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { InboxService } from "./inbox.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const auditStub = { log: async () => undefined } as any;

const ROWS = [
  { id: "a", organizationId: "org-1", assignedUserId: null, unreadCount: 2, status: "open", firstResponseAt: new Date(), createdAt: new Date() },
  { id: "b", organizationId: "org-1", assignedUserId: "user-1", unreadCount: 5, status: "open", firstResponseAt: new Date(), createdAt: new Date() },
  { id: "c", organizationId: "org-1", assignedUserId: null, unreadCount: 0, status: "closed", firstResponseAt: new Date(), createdAt: new Date() },
  { id: "x", organizationId: "org-2", assignedUserId: null, unreadCount: 9, status: "open", firstResponseAt: new Date(), createdAt: new Date() },
];

function matches(row: any, where: any): boolean {
  for (const [k, v] of Object.entries<any>(where)) {
    if (v === null) { if (row[k] != null) return false; continue; }
    if (typeof v === "object" && !(v instanceof Date)) {
      if (v.in !== undefined && !v.in.includes(row[k])) return false;
      if (v.lt !== undefined && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function fakePrisma() {
  return {
    channelConversation: {
      count: async ({ where }: any) => ROWS.filter((r) => matches(r, where)).length,
      aggregate: async ({ where }: any) => ({
        _sum: { unreadCount: ROWS.filter((r) => matches(r, where)).reduce((s, r) => s + r.unreadCount, 0) },
      }),
    },
    inboxSetting: {
      findUnique: async ({ where }: any) => (where.organizationId === "org-1"
        ? { organizationId: "org-1", slaFirstResponseMinutes: 60, escalationThresholdMinor: null }
        : null),
    },
    order: { findMany: async () => [] },
  } as any;
}

describe("UX1 Q2: folder counts unreadTotal", () => {
  it("sums stored unreadCount org-wide and never leaks another org", async () => {
    const svc = new InboxService(fakePrisma(), auditStub, llmStub);
    const counts = await svc.conversationFolderCounts("org-1", "user-1");
    expect(counts.unreadTotal).toBe(7);
    expect(counts.all).toBe(3);
  });

  it("is 0 (not undefined) when the aggregate comes back empty", async () => {
    const prisma = fakePrisma();
    prisma.channelConversation.aggregate = async () => ({ _sum: { unreadCount: null } });
    const svc = new InboxService(prisma, auditStub, llmStub);
    const counts = await svc.conversationFolderCounts("org-1", "user-1");
    expect(counts.unreadTotal).toBe(0);
  });
});
