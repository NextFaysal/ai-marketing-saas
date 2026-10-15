import "reflect-metadata";
import { InboxService } from "./inbox.service";
import { CustomersService } from "../customers/customers.service";
import { AuditService } from "../audit/audit.service";

/**
 * IN2 — identity in the inbox context panel.
 *
 *  - Duplicates are detected ONLY on real identifiers: a shared
 *    phone (last-10-digit key, the risk.service rule — so
 *    "01711-111111" and "+880 1711-111111" match) or a shared
 *    email (case-insensitive). A Messenger conversation whose
 *    only identity is a PSID honestly yields NO candidates.
 *  - linkedConversations is the IN2c unified view: the same
 *    customer's threads on other channels.
 *  - Merge/unmerge from a conversation delegate to the ONE
 *    canonical CustomersService implementation and are tied to
 *    the thread (an unrelated pair cannot be merged through
 *    the inbox route); link-conversation fills an empty link
 *    and never overwrites one.
 */

type Row = Record<string, any>;

function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (k === "OR") return (v as any[]).some((sub) => match(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => match(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      if ("has" in v) return Array.isArray(row[k]) && row[k].includes(v.has);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date(v.lte).getTime();
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      return true;
    }
    return row[k] === v;
  });
}
function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  let out = [...rows];
  for (const e of [...entries].reverse()) {
    const [key, dir] = Object.entries(e)[0] as [string, string];
    out = out.sort((a, b) => {
      const av = a[key] instanceof Date ? new Date(a[key]).getTime() : a[key];
      const bv = b[key] instanceof Date ? new Date(b[key]).getTime() : b[key];
      const cmp = (av ?? 0) < (bv ?? 0) ? -1 : (av ?? 0) > (bv ?? 0) ? 1 : 0;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return out;
}
function table(store: Row[]) {
  return {
    rows: store,
    findMany: jest.fn(async ({ where, take, orderBy }: any = {}) => {
      const rows = sortRows(store.filter((r) => match(r, where)), orderBy);
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any = {}) => sortRows(store.filter((r) => match(r, where)), orderBy)[0] ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id || match(r, where));
      if (!row) throw new Error("nf");
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any = {}) => {
      let count = 0;
      for (const r of store) if (match(r, where)) { Object.assign(r, data); count++; }
      return { count };
    }),
    count: jest.fn(async ({ where }: any = {}) => store.filter((r) => match(r, where)).length),
  };
}

const ORG = "org-1";

function setup() {
  const customers: Row[] = [
    { id: "cust-a", organizationId: ORG, firstName: "Rahim", lastName: null, phone: "01711111111", email: "a@x.com", mergedIntoId: null, createdAt: new Date(1) },
    { id: "cust-b", organizationId: ORG, firstName: "Rahim", lastName: "Uddin", phone: "+880 1711-111111", email: null, mergedIntoId: null, createdAt: new Date(2) },
    { id: "cust-c", organizationId: ORG, firstName: "Rina", lastName: null, phone: null, email: "A@x.com", mergedIntoId: null, createdAt: new Date(3) },
    { id: "cust-foreign", organizationId: "org-2", firstName: "Other", lastName: null, phone: "01711111111", email: null, mergedIntoId: null, createdAt: new Date(4) },
  ];
  const conversations: Row[] = [
    { id: "conv-wa", organizationId: ORG, channel: "whatsapp", externalContactId: "01711111111", contactName: "Rahim", contactPhone: "01711111111", customerId: "cust-a", leadId: null, status: "open", tags: [], unreadCount: 0, lastMessageAt: new Date(100), createdAt: new Date(90), updatedAt: new Date(100) },
    { id: "conv-wa2", organizationId: ORG, channel: "whatsapp", externalContactId: "01711111111-b", contactName: "Rahim", contactPhone: "01711111111", customerId: "cust-a", leadId: null, status: "closed", tags: [], unreadCount: 0, lastMessageAt: new Date(80), createdAt: new Date(70), updatedAt: new Date(80) },
    { id: "conv-fb", organizationId: ORG, channel: "messenger", externalContactId: "psid-1", contactName: "Rahim Uddin", contactPhone: null, customerId: "cust-b", leadId: null, status: "open", tags: [], unreadCount: 1, lastMessageAt: new Date(95), createdAt: new Date(85), updatedAt: new Date(95) },
    { id: "conv-web", organizationId: ORG, channel: "webchat", externalContactId: "sess-1", contactName: "Rina", contactPhone: null, customerId: "cust-c", leadId: null, status: "open", tags: [], unreadCount: 0, lastMessageAt: new Date(92), createdAt: new Date(82), updatedAt: new Date(92) },
    { id: "conv-psid", organizationId: ORG, channel: "messenger", externalContactId: "psid-9", contactName: "অজানা", contactPhone: null, customerId: null, leadId: "lead-9", status: "open", tags: [], unreadCount: 0, lastMessageAt: new Date(93), createdAt: new Date(83), updatedAt: new Date(93) },
  ];
  const leads: Row[] = [
    { id: "lead-9", organizationId: ORG, name: "অজানা", phone: null, email: null, stage: "new", source: "messenger", tags: [], valueMinor: null },
  ];
  const auditRows: Row[] = [];
  const db: any = {
    channelConversation: table(conversations),
    channelMessage: table([]),
    messageDraft: table([]),
    botSession: table([]),
    customer: table(customers),
    lead: table(leads),
    order: table([]),
    courierShipment: table([]),
    customerMergeRecord: table([]),
    auditLog: table(auditRows),
    inboxSetting: table([]),
    organization: table([{ id: ORG, name: "টেস্ট শপ", timezone: "Asia/Dhaka" }]),
    membership: table([]),
    businessProfile: table([]),
  };
  const audit = new AuditService(db as any);
  const customersSvc = new CustomersService(db as any, audit as any);
  const llm = { getProvider: () => ({ name: "dev-template", isRealLlm: false }) };
  const service = new InboxService(
    db as any, audit as any, llm as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    customersSvc as any,
  );
  return { service, customersSvc, db, customers, conversations, auditRows };
}
const row = (rows: Row[], id: string): Row => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`missing ${id}`);
  return r;
};

describe("IN2a/2c — identity in getConversation", () => {
  it("flags phone matches (last-10 rule) and email matches (case-insensitive), org-scoped", async () => {
    const s = setup();
    const out = await s.service.getConversation(ORG, "conv-wa");
    const dups = out.context.identity.duplicates as any[];
    const fb = dups.find((d) => d.conversationId === "conv-fb");
    expect(fb).toBeTruthy();
    expect(fb.customerId).toBe("cust-b");
    expect(fb.matchReasons).toContain("phone");
    const web = dups.find((d) => d.conversationId === "conv-web");
    expect(web).toBeTruthy();
    expect(web.customerId).toBe("cust-c");
    expect(web.matchReasons).toContain("email");
    // The other org's identical phone never appears.
    expect(dups.some((d) => d.customerId === "cust-foreign")).toBe(false);
  });

  it("linkedConversations is the unified cross-channel view of the same customer", async () => {
    const s = setup();
    const out = await s.service.getConversation(ORG, "conv-wa");
    const linked = out.context.identity.linkedConversations as any[];
    expect(linked.map((c) => c.id)).toEqual(["conv-wa2"]);
  });

  it("a PSID-only conversation honestly yields no duplicate candidates", async () => {
    const s = setup();
    const out = await s.service.getConversation(ORG, "conv-psid");
    expect(out.context.identity.duplicates).toEqual([]);
    expect(out.context.identity.customerId).toBeNull();
  });
});

describe("IN2b — merge / unmerge from a conversation", () => {
  it("merges through the canonical service, shows in identity.merges, and unmerges back", async () => {
    const s = setup();
    await s.service.mergeCustomerFromConversation(ORG, "agent-1", "conv-wa", { sourceCustomerId: "cust-b", targetCustomerId: "cust-a" });
    expect(row(s.customers, "cust-b").mergedIntoId).toBe("cust-a");
    expect(row(s.conversations, "conv-fb").customerId).toBe("cust-a");
    const out = await s.service.getConversation(ORG, "conv-wa");
    expect((out.context.identity.merges as any[]).map((m) => m.sourceCustomerId)).toEqual(["cust-b"]);
    // After the merge the threads are one customer's: conv-fb is linked now.
    expect((out.context.identity.linkedConversations as any[]).map((c) => c.id).sort()).toEqual(["conv-fb", "conv-wa2"]);
    const un = await s.service.unmergeCustomerFromConversation(ORG, "agent-1", "conv-wa", { sourceCustomerId: "cust-b" });
    expect(un.ordersRestored).toBe(0);
    expect(un.conversationsRestored).toBe(1);
    expect(row(s.customers, "cust-b").mergedIntoId).toBeNull();
    expect(row(s.conversations, "conv-fb").customerId).toBe("cust-b");
  });

  it("refuses a merge unrelated to this conversation", async () => {
    const s = setup();
    await expect(
      s.service.mergeCustomerFromConversation(ORG, "agent-1", "conv-psid", { sourceCustomerId: "cust-b", targetCustomerId: "cust-a" }),
    ).rejects.toThrow();
    expect(row(s.customers, "cust-b").mergedIntoId).toBeNull();
  });
});

describe("IN2 — link an unlinked conversation to a customer", () => {
  it("links an empty conversation, audits it, and never overwrites a link", async () => {
    const s = setup();
    const updated = await s.service.linkConversationCustomer(ORG, "agent-1", "conv-psid", { customerId: "cust-a" });
    expect(updated.customerId).toBe("cust-a");
    expect(s.auditRows.some((r) => r.action === "inbox.conversation.customer_linked" && r.entityId === "conv-psid")).toBe(true);
    await expect(s.service.linkConversationCustomer(ORG, "agent-1", "conv-psid", { customerId: "cust-b" })).rejects.toThrow(/ইতিমধ্যে/);
  });

  it("refuses to link to a merged-away shell or a foreign customer", async () => {
    const s = setup();
    await s.service.mergeCustomerFromConversation(ORG, "agent-1", "conv-wa", { sourceCustomerId: "cust-b", targetCustomerId: "cust-a" });
    await expect(s.service.linkConversationCustomer(ORG, "agent-1", "conv-psid", { customerId: "cust-b" })).rejects.toThrow(/মার্জ/);
    await expect(s.service.linkConversationCustomer(ORG, "agent-1", "conv-psid", { customerId: "cust-foreign" })).rejects.toThrow();
  });
});
