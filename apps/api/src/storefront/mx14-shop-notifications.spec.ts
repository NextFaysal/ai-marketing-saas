import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ShopAccountService } from "./shop-account.service";
import { hashShopSecret } from "./shop-auth.util";

/**
 * MX14 — the shop-side on-site notification center: the
 * signed-in customer (EC25 phone-OTP session) lists ONLY their
 * own notifications, and opening one stamps readAt on the
 * notification AND readAt / deliveryStatus "read" on the
 * linked MessageDelivery — the row the broadcast report funnel
 * counts as its real "read" stage.
 *
 * Fake-prisma style like ec25-accounts.spec.ts (self-contained).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) return row[k] !== v.not;
      if ("in" in v) return v.in.includes(row[k]);
      return matches(row[k] ?? {}, v);
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
        const cmp = new Date(av).getTime() < new Date(bv).getTime() ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
  return out;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) =>
      sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let out = sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (take) out = out.slice(0, take);
      return out;
    },
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let n = 0;
      for (const row of rows) if (matches(row, where ?? {})) { Object.assign(row, data); n++; }
      return { count: n };
    },
  };
}

function build() {
  const prisma: any = {
    organization: makeTable("org"),
    storefrontSetting: makeTable("set"),
    shopSession: makeTable("sess"),
    customer: makeTable("cust"),
    onsiteNotification: makeTable("onsite"),
    messageDelivery: makeTable("dlv"),
  };
  prisma.organization.rows.push({ id: "org-1", slug: "my-shop", name: "My Shop" });
  prisma.storefrontSetting.rows.push({ id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "My Shop" });
  prisma.customer.rows.push(
    { id: "customer-1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman", phone: "01712345671", email: null },
    { id: "customer-2", organizationId: "org-1", firstName: "Tanvir", lastName: null, phone: "01712345672", email: null },
  );
  const future = new Date(Date.now() + 3600_000);
  prisma.shopSession.rows.push(
    { id: "sess-1", organizationId: "org-1", customerId: "customer-1", tokenHash: hashShopSecret("tok-1"), expiresAt: future, revokedAt: null },
    { id: "sess-2", organizationId: "org-1", customerId: "customer-2", tokenHash: hashShopSecret("tok-2"), expiresAt: future, revokedAt: null },
  );
  prisma.messageDelivery.rows.push(
    { id: "dlv-1", organizationId: "org-1", broadcastId: "bc-1", channel: "onsite", recipientId: "customer-1", address: "customer-1", status: "sent", deliveryStatus: "delivered", deliveredAt: new Date(), readAt: null },
    { id: "dlv-2", organizationId: "org-1", broadcastId: "bc-1", channel: "onsite", recipientId: "customer-1", address: "customer-1", status: "sent", deliveryStatus: "delivered", deliveredAt: new Date(), readAt: null },
    { id: "dlv-3", organizationId: "org-1", broadcastId: "bc-1", channel: "onsite", recipientId: "customer-2", address: "customer-2", status: "sent", deliveryStatus: "delivered", deliveredAt: new Date(), readAt: null },
  );
  prisma.onsiteNotification.rows.push(
    { id: "n-1", organizationId: "org-1", customerId: "customer-1", broadcastId: "bc-1", deliveryId: "dlv-1", title: "প্রথম", body: "b1", url: "/sale", readAt: null, createdAt: new Date(Date.now() - 2000) },
    { id: "n-2", organizationId: "org-1", customerId: "customer-1", broadcastId: "bc-1", deliveryId: "dlv-2", title: "দ্বিতীয়", body: "b2", url: null, readAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 1000) },
    { id: "n-3", organizationId: "org-1", customerId: "customer-2", broadcastId: "bc-1", deliveryId: "dlv-3", title: "অন্যের", body: "b3", url: null, readAt: null, createdAt: new Date() },
  );
  const svc = new ShopAccountService(prisma as any);
  return { svc, prisma };
}

describe("MX14 shop notification center", () => {
  it("list: a customer sees ONLY their own notifications, newest first, with the unread count", async () => {
    const { svc } = build();
    const out: any = await svc.listNotifications("my-shop", "tok-1");
    expect(out.items.map((n: any) => n.id)).toEqual(["n-2", "n-1"]);
    expect(out.unreadCount).toBe(1);
    expect(out.items[1]).toMatchObject({ title: "প্রথম", url: "/sale", isRead: false });
    const other: any = await svc.listNotifications("my-shop", "tok-2");
    expect(other.items.map((n: any) => n.id)).toEqual(["n-3"]);
    expect(other.unreadCount).toBe(1);
  });

  it("no session → 401 for list, mark-read and mark-all (nothing is readable unauthenticated)", async () => {
    const { svc } = build();
    await expect(svc.listNotifications("my-shop", "bogus")).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.markNotificationRead("my-shop", null, "n-1")).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.markAllNotificationsRead("my-shop", undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("mark-read stamps readAt on the notification AND readAt + deliveryStatus=read on the linked delivery; a second mark keeps the first stamp", async () => {
    const { svc, prisma } = build();
    const saved: any = await svc.markNotificationRead("my-shop", "tok-1", "n-1");
    expect(saved.isRead).toBe(true);
    expect(saved.readAt).toBeTruthy();
    const dlv = prisma.messageDelivery.rows.find((d: any) => d.id === "dlv-1");
    expect(dlv.deliveryStatus).toBe("read");
    expect(dlv.readAt).toBeTruthy();
    const again: any = await svc.markNotificationRead("my-shop", "tok-1", "n-1");
    expect(again.readAt).toBe(saved.readAt);
    const out: any = await svc.listNotifications("my-shop", "tok-1");
    expect(out.unreadCount).toBe(0);
  });

  it("a customer CANNOT read or mark another customer's notification — the same 404 as a missing one, and nothing is stamped", async () => {
    const { svc, prisma } = build();
    await expect(svc.markNotificationRead("my-shop", "tok-1", "n-3")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.markNotificationRead("my-shop", "tok-1", "n-404")).rejects.toBeInstanceOf(NotFoundException);
    const n3 = prisma.onsiteNotification.rows.find((n: any) => n.id === "n-3");
    expect(n3.readAt).toBeNull();
    const dlv3 = prisma.messageDelivery.rows.find((d: any) => d.id === "dlv-3");
    expect(dlv3.deliveryStatus).toBe("delivered");
    expect(dlv3.readAt).toBeNull();
  });

  it("mark-all stamps every unread notification of the session customer (and their deliveries) — other customers untouched", async () => {
    const { svc, prisma } = build();
    const res: any = await svc.markAllNotificationsRead("my-shop", "tok-1");
    expect(res).toEqual({ marked: 1, unreadCount: 0 });
    expect(prisma.messageDelivery.rows.find((d: any) => d.id === "dlv-1")?.deliveryStatus).toBe("read");
    // customer-2's notification + delivery are untouched.
    expect(prisma.onsiteNotification.rows.find((n: any) => n.id === "n-3")?.readAt).toBeNull();
    expect(prisma.messageDelivery.rows.find((d: any) => d.id === "dlv-3")?.deliveryStatus).toBe("delivered");
    const again: any = await svc.markAllNotificationsRead("my-shop", "tok-1");
    expect(again.marked).toBe(0);
  });
});
