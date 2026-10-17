import "reflect-metadata";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { OrganizationsService } from "./organizations.service";
import { OrganizationsController } from "./organizations.controller";
import { InvitationsController } from "./invitations.controller";
import { RolesGuard } from "../common/roles.guard";
import { IS_PUBLIC_KEY, ROLES_KEY } from "../common/decorators";

/**
 * Organization Next OB3 — ORG9 shareable invite links + ORG10
 * join-request approval queue. The load-bearing design rules
 * under test:
 *  - only the SHA-256 hash of a link token is ever stored; the
 *    raw token is returned once, at creation;
 *  - a link NEVER creates a membership — it files a PENDING
 *    OrgJoinRequest; approval (seat-guarded at that moment, via
 *    the same private seatGuard the invitation paths use) is the
 *    only path to an ACTIVE membership;
 *  - the public link endpoint is uniform: unknown, revoked,
 *    expired and exhausted links are the same 404;
 *  - maxUses null (stored or omitted) is never "unlimited" — the
 *    cap reads as the service default 10;
 *  - at most one PENDING request per user+org; a rejected user
 *    may ask again, but every request consumes one link use.
 */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === "userId_organizationId") {
      const c = v as any;
      if (row.userId !== c.userId || row.organizationId !== c.organizationId) return false;
      continue;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const cond = v as any;
      const rv = row[k];
      if ("in" in cond && !cond.in.includes(rv)) return false;
      if ("gt" in cond && !(new Date(rv).getTime() > new Date(cond.gt).getTime())) return false;
      if ("not" in cond && rv === cond.not) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function table(seed: any[] = []) {
  const rows = [...seed];
  let seq = 0;
  return {
    rows,
    findUnique: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findFirst: async ({ where, orderBy }: any) => {
      const found = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt === "desc") found.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return found[0] ?? null;
    },
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let found = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt === "desc") found.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      if (take) found = found.slice(0, take);
      return found;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("row not found");
      Object.assign(row, data);
      return row;
    },
  };
}

function makeService(plan = "GROWTH") {
  const org = { id: "org-1", name: "Demo Shop", slug: "demo", status: "ACTIVE", archivedAt: null, aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null, creditMinor: 0n };
  const p: any = {
    organization: table([org]),
    user: table([
      { id: "u-owner", email: "owner@x.com", name: "Owner" },
      { id: "u-admin", email: "admin@x.com", name: "Admin" },
      { id: "u-agent", email: "agent@x.com", name: "Agent" },
      { id: "u-a", email: "a@x.com", name: "Ayesha" },
      { id: "u-b", email: "b@x.com", name: "Bilal" },
      { id: "u-c", email: "c@x.com", name: "Chitra" },
    ]),
    membership: table([
      { id: "m-owner", userId: "u-owner", organizationId: "org-1", role: "OWNER", status: "ACTIVE", user: { id: "u-owner", name: "Owner", email: "owner@x.com" } },
      { id: "m-admin", userId: "u-admin", organizationId: "org-1", role: "ADMIN", status: "ACTIVE", user: { id: "u-admin", name: "Admin", email: "admin@x.com" } },
      { id: "m-agent", userId: "u-agent", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE", user: { id: "u-agent", name: "Agent", email: "agent@x.com" } },
    ]),
    memberInvitation: table(),
    orgInviteLink: table(),
    orgJoinRequest: table(),
    subscription: table([
      { id: "s-1", organizationId: "org-1", plan, status: "ACTIVE", createdAt: new Date("2026-10-01") },
    ]),
  };
  p.$transaction = async (fn: any) => fn(p);
  const auditEntries: any[] = [];
  const audit: any = { log: async (e: any) => { auditEntries.push(e); } };
  return { svc: new OrganizationsService(p, audit), p, auditEntries };
}

const owner = { userId: "u-owner", email: "owner@x.com" };
const personA = { userId: "u-a", email: "a@x.com" };
const personB = { userId: "u-b", email: "b@x.com" };
const personC = { userId: "u-c", email: "c@x.com" };

function rawOf(inviteUrl: string): string {
  return inviteUrl.split("/join/")[1];
}

async function makeLink(svc: any, dto: any = { role: "VIEWER" }) {
  const out = await svc.createInviteLink("org-1", "u-owner", dto);
  return { ...out, raw: rawOf(out.inviteUrl) };
}

describe("ORG9 — invite link creation & storage", () => {
  it("stores only the token hash, returns the raw URL once, defaults cap 10 / 7 days", async () => {
    const { svc, p, auditEntries } = makeService();
    const out = await svc.createInviteLink("org-1", "u-owner", { role: "SUPPORT_AGENT" });
    expect(out.inviteUrl).toContain("/join/");
    const raw = rawOf(out.inviteUrl);
    expect(raw.length).toBeGreaterThan(10);
    const stored = p.orgInviteLink.rows[0];
    expect(stored.tokenHash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(raw);
    expect(stored.maxUses).toBe(10);
    expect(stored.usedCount).toBe(0);
    const days = (new Date(stored.expiresAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(out.link.status).toBe("active");
    expect(out.link).not.toHaveProperty("tokenHash");
    expect(auditEntries.some((e: any) => e.action === "org.invite_link_created")).toBe(true);
  });

  it("refuses the OWNER role through a link", async () => {
    const { svc } = makeService();
    await expect(svc.createInviteLink("org-1", "u-owner", { role: "OWNER" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createInviteLink("org-1", "u-owner", { role: "SUPER_ADMIN" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses non-admin members and non-members (service-layer guard)", async () => {
    const { svc } = makeService();
    await expect(svc.createInviteLink("org-1", "u-agent", { role: "VIEWER" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.createInviteLink("org-1", "u-a", { role: "VIEWER" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.listInviteLinks("org-1", "u-agent")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.listJoinRequests("org-1", "u-agent")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("list view derives status: revoked / expired / exhausted; stored null cap reads as 10", async () => {
    const { svc, p } = makeService();
    const a = await makeLink(svc, { role: "VIEWER", maxUses: 1 });
    await svc.requestToJoin(personA, a.raw, {});
    const b = await makeLink(svc, { role: "ANALYST" });
    p.orgInviteLink.rows.find((r: any) => r.id === b.link.id).expiresAt = new Date(Date.now() - 1000);
    // Hand-stored legacy-style row: maxUses null must read as cap 10, never unlimited.
    const legacyRaw = "legacyrawtoken123";
    p.orgInviteLink.rows.push({
      id: "link-legacy", organizationId: "org-1", role: "VIEWER",
      tokenHash: createHash("sha256").update(legacyRaw).digest("hex"),
      maxUses: null, usedCount: 10, expiresAt: new Date(Date.now() + 86400000), revokedAt: null,
      createdById: "u-owner", createdAt: new Date(),
    });
    const list = await svc.listInviteLinks("org-1", "u-owner");
    const byId = new Map<string, any>(list.map((l: any) => [l.id, l]));
    expect(byId.get(a.link.id).status).toBe("exhausted");
    expect(byId.get(b.link.id).status).toBe("expired");
    expect(byId.get("link-legacy").status).toBe("exhausted");
    expect(byId.get("link-legacy").maxUses).toBe(10);
    await svc.revokeInviteLink("org-1", "u-owner", a.link.id);
    const after = await svc.listInviteLinks("org-1", "u-owner");
    expect(after.find((l: any) => l.id === a.link.id).status).toBe("revoked");
    await expect(svc.revokeInviteLink("org-1", "u-owner", a.link.id)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("ORG9 — public link information is uniform", () => {
  it("reveals org name + role only for a currently usable link", async () => {
    const { svc } = makeService();
    const { raw } = await makeLink(svc, { role: "ANALYST" });
    const info = await svc.getInviteLinkPublic(raw);
    expect(info).toEqual({ organizationId: "org-1", organizationName: "Demo Shop", role: "ANALYST", valid: true });
    expect(JSON.stringify(info)).not.toContain("u-owner");
  });

  it("unknown, revoked, expired and exhausted links are the SAME 404", async () => {
    const { svc, p } = makeService();
    const grab = async (fn: () => Promise<any>) => {
      try { await fn(); return null; } catch (e: any) { return { cls: e.constructor.name, msg: e.message }; }
    };
    const unknown = await grab(() => svc.getInviteLinkPublic("no-such-token-123"));
    const good = await makeLink(svc, { role: "VIEWER", maxUses: 1 });
    const exhausted = await (async () => {
      await svc.requestToJoin(personA, good.raw, {});
      return grab(() => svc.getInviteLinkPublic(good.raw));
    })();
    const b = await makeLink(svc, { role: "VIEWER" });
    p.orgInviteLink.rows.find((r: any) => r.id === b.link.id).expiresAt = new Date(Date.now() - 5000);
    const expired = await grab(() => svc.getInviteLinkPublic(b.raw));
    const c = await makeLink(svc, { role: "VIEWER" });
    await svc.revokeInviteLink("org-1", "u-owner", c.link.id);
    const revoked = await grab(() => svc.getInviteLinkPublic(c.raw));
    for (const e of [unknown, exhausted, expired, revoked]) {
      expect(e).not.toBeNull();
      expect(e!.cls).toBe("NotFoundException");
      expect(e!.msg).toBe(unknown!.msg);
    }
  });
});

describe("ORG10 — filing a join request", () => {
  it("creates a PENDING request and counts one use — and NO membership", async () => {
    const { svc, p, auditEntries } = makeService();
    const { raw, link } = await makeLink(svc, { role: "SUPPORT_AGENT" });
    const membersBefore = p.membership.rows.length;
    const out = await svc.requestToJoin(personA, raw, { message: "আমি সাপোর্টে কাজ করতে চাই" });
    expect(out.status).toBe("PENDING");
    expect(p.orgJoinRequest.rows).toHaveLength(1);
    expect(p.orgJoinRequest.rows[0].status).toBe("PENDING");
    expect(p.orgJoinRequest.rows[0].inviteLinkId).toBe(link.id);
    expect(p.orgInviteLink.rows[0].usedCount).toBe(1);
    expect(p.membership.rows).toHaveLength(membersBefore);
    expect(auditEntries.some((e: any) => e.action === "org.join_requested")).toBe(true);
  });

  it("refuses when the cap is full, the link is revoked or expired", async () => {
    const { svc, p } = makeService();
    const one = await makeLink(svc, { role: "VIEWER", maxUses: 1 });
    await svc.requestToJoin(personA, one.raw, {});
    await expect(svc.requestToJoin(personB, one.raw, {})).rejects.toBeInstanceOf(BadRequestException);
    const two = await makeLink(svc, { role: "VIEWER" });
    await svc.revokeInviteLink("org-1", "u-owner", two.link.id);
    await expect(svc.requestToJoin(personB, two.raw, {})).rejects.toBeInstanceOf(BadRequestException);
    const three = await makeLink(svc, { role: "VIEWER" });
    p.orgInviteLink.rows.find((r: any) => r.id === three.link.id).expiresAt = new Date(Date.now() - 1000);
    await expect(svc.requestToJoin(personB, three.raw, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.requestToJoin(personB, "unknown-token-999", {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses a second PENDING request and refuses existing members", async () => {
    const { svc } = makeService();
    const { raw } = await makeLink(svc, { role: "VIEWER" });
    await svc.requestToJoin(personA, raw, {});
    await expect(svc.requestToJoin(personA, raw, {})).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.requestToJoin(owner, raw, {})).rejects.toBeInstanceOf(ConflictException);
  });

  it("my-request shows only the caller's own latest request", async () => {
    const { svc } = makeService();
    const { raw } = await makeLink(svc, { role: "VIEWER" });
    await svc.requestToJoin(personA, raw, {});
    const mineA = await svc.getMyJoinRequest(personA, raw);
    expect(mineA.request?.status).toBe("PENDING");
    const mineB = await svc.getMyJoinRequest(personB, raw);
    expect(mineB.request).toBeNull();
    expect(mineB.organizationName).toBe("Demo Shop");
    await expect(svc.getMyJoinRequest(personA, "nope-token-000")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("ORG10 — the approval queue", () => {
  async function queued(svc: any, dto: any = { role: "SUPPORT_AGENT" }) {
    const { raw, link } = await makeLink(svc, dto);
    const out = await svc.requestToJoin(personA, raw, {});
    return { raw, link, requestId: out.requestId };
  }

  it("queue list carries requester identity and the link role", async () => {
    const { svc } = makeService();
    await queued(svc);
    const list = await svc.listJoinRequests("org-1", "u-admin");
    expect(list).toHaveLength(1);
    expect(list[0].user).toEqual({ id: "u-a", name: "Ayesha", email: "a@x.com" });
    expect(list[0].linkRole).toBe("SUPPORT_AGENT");
    expect(list[0].status).toBe("PENDING");
  });

  it("approve creates an ACTIVE membership with the link role, decided fields + audit", async () => {
    const { svc, p, auditEntries } = makeService();
    const { requestId } = await queued(svc);
    const out = await svc.approveJoinRequest("org-1", "u-admin", requestId, {});
    expect(out).toMatchObject({ ok: true, alreadyMember: false, role: "SUPPORT_AGENT" });
    const membership = p.membership.rows.find((m: any) => m.userId === "u-a");
    expect(membership).toMatchObject({ role: "SUPPORT_AGENT", status: "ACTIVE", organizationId: "org-1" });
    const req = p.orgJoinRequest.rows[0];
    expect(req.status).toBe("APPROVED");
    expect(req.decidedById).toBe("u-admin");
    expect(req.decidedAt).toBeTruthy();
    expect(auditEntries.some((e: any) => e.action === "org.join_request_approved")).toBe(true);
    // Decided requests cannot be decided again.
    await expect(svc.approveJoinRequest("org-1", "u-admin", requestId, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.rejectJoinRequest("org-1", "u-admin", requestId, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it("approve honours a role override but never OWNER", async () => {
    const { svc, p } = makeService();
    const { requestId } = await queued(svc);
    await expect(svc.approveJoinRequest("org-1", "u-owner", requestId, { role: "OWNER" })).rejects.toBeInstanceOf(BadRequestException);
    const out = await svc.approveJoinRequest("org-1", "u-owner", requestId, { role: "ANALYST" });
    expect(out.role).toBe("ANALYST");
    expect(p.membership.rows.find((m: any) => m.userId === "u-a").role).toBe("ANALYST");
  });

  it("approve is blocked by the seat guard when the plan is full (FREE = 2 seats)", async () => {
    const { svc, p } = makeService("FREE");
    // org-1 already has OWNER + ADMIN + agent = 3 ACTIVE memberships
    // in the seed; FREE allows 2 — the guard must refuse.
    const { requestId } = await queued(svc);
    await expect(svc.approveJoinRequest("org-1", "u-owner", requestId, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(p.orgJoinRequest.rows[0].status).toBe("PENDING");
    expect(p.membership.rows.find((m: any) => m.userId === "u-a")).toBeUndefined();
  });

  it("approve closes out cleanly when the requester already became a member another way", async () => {
    const { svc, p } = makeService();
    const { requestId } = await queued(svc);
    p.membership.rows.push({ id: "m-a-direct", userId: "u-a", organizationId: "org-1", role: "VIEWER", status: "ACTIVE" });
    const out = await svc.approveJoinRequest("org-1", "u-owner", requestId, {});
    expect(out.alreadyMember).toBe(true);
    expect(p.membership.rows.filter((m: any) => m.userId === "u-a")).toHaveLength(1);
    expect(p.orgJoinRequest.rows[0].status).toBe("APPROVED");
  });

  it("reject records the decision; the requester may ask again (new use consumed)", async () => {
    const { svc, p, auditEntries } = makeService();
    const { raw, link } = await makeLink(svc, { role: "VIEWER" });
    const first = await svc.requestToJoin(personA, raw, {});
    const out = await svc.rejectJoinRequest("org-1", "u-admin", first.requestId, { reason: "এখন টিমে জায়গা নেই" });
    expect(out.ok).toBe(true);
    const req = p.orgJoinRequest.rows[0];
    expect(req.status).toBe("REJECTED");
    expect(req.rejectReason).toContain("জায়গা নেই");
    expect(req.decidedById).toBe("u-admin");
    expect(auditEntries.some((e: any) => e.action === "org.join_request_rejected")).toBe(true);
    const status = await svc.getMyJoinRequest(personA, raw);
    expect(status.request?.status).toBe("REJECTED");
    expect(status.request?.rejectReason).toContain("জায়গা নেই");
    // Asking again is allowed — and consumes a second use of the link.
    const second = await svc.requestToJoin(personA, raw, {});
    expect(second.status).toBe("PENDING");
    expect(p.orgInviteLink.rows.find((r: any) => r.id === link.id).usedCount).toBe(2);
    expect(p.orgJoinRequest.rows.filter((r: any) => r.status === "PENDING")).toHaveLength(1);
  });

  it("queue decisions on unknown ids are 404", async () => {
    const { svc } = makeService();
    await expect(svc.approveJoinRequest("org-1", "u-owner", "missing", {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.rejectJoinRequest("org-1", "u-owner", "missing", {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("ORG9/ORG10 — route metadata + guard layer", () => {
  const reflector = {
    getAllAndOverride: (key: string, targets: any[]) =>
      Reflect.getMetadata(key, targets[0]) ?? Reflect.getMetadata(key, targets[1]),
  } as any;

  function ctxFor(handler: any, req: any) {
    return {
      getHandler: () => handler,
      getClass: () => OrganizationsController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as any;
  }

  it("queue + link routes carry @Roles(OWNER, ADMIN); link info is @Public", () => {
    for (const h of ["createInviteLink", "inviteLinks", "revokeInviteLink", "joinRequests", "approveJoinRequest", "rejectJoinRequest"] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, (OrganizationsController.prototype as any)[h])).toEqual(["OWNER", "ADMIN"]);
    }
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, InvitationsController.prototype.linkInfo)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, InvitationsController.prototype.requestToJoin)).toBeUndefined();
  });

  it("RolesGuard: SUPPORT_AGENT is refused, ADMIN passes, SUPER passes", () => {
    const guard = new RolesGuard(reflector);
    const handler = OrganizationsController.prototype.approveJoinRequest;
    expect(() => guard.canActivate(ctxFor(handler, { user: { userId: "u-agent" }, membership: { role: "SUPPORT_AGENT" } }))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctxFor(handler, { user: { userId: "u-admin" }, membership: { role: "ADMIN" } }))).toBe(true);
    expect(guard.canActivate(ctxFor(handler, { user: { userId: "root", isSuperAdmin: true } }))).toBe(true);
  });
});
