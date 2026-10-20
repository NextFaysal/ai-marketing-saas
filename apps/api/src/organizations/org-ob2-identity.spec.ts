import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { OrganizationsService } from "./organizations.service";

/**
 * Organization Next OB2 — ORG5 org identity edit:
 * PATCH /organizations/:id/identity service semantics —
 * partial update of name / currency / timezone / country with
 * shape validation (ISO currency form, IANA timezone via Intl,
 * 2-letter country), OWNER/ADMIN-only, audit org.identity_updated
 * carrying field NAMES only (never old values), no write and no
 * audit when nothing actually changes, and the subscription row
 * never touched (currency change is default-only going forward).
 */
type Row = Record<string, any>;
function match(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "userId_organizationId" && v && typeof v === "object") {
      return row.userId === (v as any).userId && row.organizationId === (v as any).organizationId;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return ((v as any).in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      if ("gt" in v) return row[k] > (v as any).gt;
      return true;
    }
    return row[k] === v;
  });
}
function table(rows: Row[]) {
  return {
    rows,
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id) return rows.find((r) => r.id === where.id) ?? null;
      return rows.find((r) => match(r, where)) ?? null;
    }),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where))),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where)).length),
    update: jest.fn(async ({ where, data }: any) => {
      const r = rows.find((x) => (where.id ? x.id === where.id : match(x, where)));
      if (r) Object.assign(r, data);
      return r;
    }),
  };
}

function setup() {
  const org: Row = {
    id: "org-1", name: "Acme Trading", slug: "acme", status: "ACTIVE", archivedAt: null,
    currency: "BDT", timezone: "Asia/Dhaka", country: "BD", creditMinor: 0n,
  };
  const memberships: Row[] = [
    { id: "m-owner", userId: "owner-1", organizationId: "org-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", name: "Owner", email: "o@x.com" } },
    { id: "m-admin", userId: "admin-1", organizationId: "org-1", role: "ADMIN", status: "ACTIVE", user: { id: "admin-1", name: "Admin", email: "a@x.com" } },
    { id: "m-agent", userId: "agent-1", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE", user: { id: "agent-1", name: "Agent", email: "s@x.com" } },
  ];
  const subscriptions: Row[] = [
    { id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", currency: "BDT" },
  ];
  const db: any = {
    membership: table(memberships),
    organization: table([org]),
    subscription: table(subscriptions),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const svc = new OrganizationsService(db, audit as any);
  return { svc, db, audit, org, subscriptions };
}

describe("ORG5 — updateIdentity", () => {
  it("partial update: only the provided field changes; audit carries the field name only", async () => {
    const { svc, audit, org } = setup();
    const out = await svc.updateIdentity("org-1", "owner-1", { currency: "USD" }, "1.2.3.4");
    expect(out.currency).toBe("USD");
    expect(out.changedFields).toEqual(["currency"]);
    expect(org.name).toBe("Acme Trading");
    expect(org.timezone).toBe("Asia/Dhaka");
    expect(org.country).toBe("BD");
    const entry = audit.calls.find((c) => c.action === "org.identity_updated");
    expect(entry).toBeTruthy();
    expect(entry.organizationId).toBe("org-1");
    expect(entry.userId).toBe("owner-1");
    expect(entry.metadata).toEqual({ fields: ["currency"] });
    // no values anywhere in the audit metadata — field names only
    expect(JSON.stringify(entry.metadata)).not.toContain("BDT");
    expect(JSON.stringify(entry.metadata)).not.toContain("USD");
  });

  it("currency change never touches the subscription row (default-only semantics)", async () => {
    const { svc, db, subscriptions } = setup();
    await svc.updateIdentity("org-1", "owner-1", { currency: "EUR" });
    expect(subscriptions[0].currency).toBe("BDT");
    expect(db.subscription.update).not.toHaveBeenCalled();
  });

  it("updates several fields at once and trims the name", async () => {
    const { svc, audit, org } = setup();
    const out = await svc.updateIdentity("org-1", "admin-1", { name: "  Acme Global Ltd  ", timezone: "Asia/Kolkata", country: "IN" });
    expect(out.name).toBe("Acme Global Ltd");
    expect(org.timezone).toBe("Asia/Kolkata");
    expect(org.country).toBe("IN");
    expect(out.changedFields).toEqual(expect.arrayContaining(["name", "timezone", "country"]));
    const entry = audit.calls.find((c) => c.action === "org.identity_updated");
    expect(entry.metadata.fields).toEqual(expect.arrayContaining(["name", "timezone", "country"]));
  });

  it("lowercase currency/country are normalized to the canonical upper-case form", async () => {
    const { svc, org } = setup();
    const out = await svc.updateIdentity("org-1", "owner-1", { currency: "usd", country: "us" });
    expect(out.currency).toBe("USD");
    expect(org.country).toBe("US");
  });

  it("rejects a bad currency shape (too short, too long, digits)", async () => {
    const { svc, audit, org } = setup();
    await expect(svc.updateIdentity("org-1", "owner-1", { currency: "US" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.updateIdentity("org-1", "owner-1", { currency: "USDD" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.updateIdentity("org-1", "owner-1", { currency: "U1D" })).rejects.toBeInstanceOf(ApiException);
    expect(org.currency).toBe("BDT");
    expect(audit.calls).toHaveLength(0);
  });

  it("rejects a timezone Intl cannot resolve", async () => {
    const { svc, audit, org } = setup();
    await expect(svc.updateIdentity("org-1", "owner-1", { timezone: "Mars/Olympus_Mons" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.updateIdentity("org-1", "owner-1", { timezone: "" })).rejects.toBeInstanceOf(ApiException);
    expect(org.timezone).toBe("Asia/Dhaka");
    expect(audit.calls).toHaveLength(0);
  });

  it("rejects a bad country code and an empty name", async () => {
    const { svc } = setup();
    await expect(svc.updateIdentity("org-1", "owner-1", { country: "BGD" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.updateIdentity("org-1", "owner-1", { country: "B1" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.updateIdentity("org-1", "owner-1", { name: "   " })).rejects.toBeInstanceOf(ApiException);
  });

  it("rejects an empty submission (no fields provided)", async () => {
    const { svc } = setup();
    await expect(svc.updateIdentity("org-1", "owner-1", {})).rejects.toBeInstanceOf(ApiException);
  });

  it("non-admin member is refused (403); a non-member is not found", async () => {
    const { svc, audit, org } = setup();
    await expect(svc.updateIdentity("org-1", "agent-1", { name: "Nope" })).rejects.toBeInstanceOf(ApiException);
    await expect(svc.updateIdentity("org-1", "ghost-1", { name: "Nope" })).rejects.toBeInstanceOf(ApiException);
    expect(org.name).toBe("Acme Trading");
    expect(audit.calls).toHaveLength(0);
  });

  it("values equal to the current ones write nothing and audit nothing", async () => {
    const { svc, audit, db } = setup();
    const out = await svc.updateIdentity("org-1", "owner-1", { currency: "BDT", country: "BD" });
    expect(out.unchanged).toBe(true);
    expect(out.changedFields).toEqual([]);
    expect(db.organization.update).not.toHaveBeenCalled();
    expect(audit.calls).toHaveLength(0);
  });
});
