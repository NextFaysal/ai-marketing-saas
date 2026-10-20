import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { SocialService } from "./social.service";
import { SocialQueueService } from "./social-queue.service";
import { computeNextSlot } from "./social-queue-helpers";

/**
 * SU2 — Queue slots + best-time + evergreen:
 * - slot CRUD: duplicate (account+weekday+time) → Conflict,
 *   invalid time → Bengali 400, foreign account → 404.
 * - computeNextSlot (pure, Asia/Dhaka): exact UTC instant for a
 *   local weekday+time, occupied minute skipped to the next
 *   occurrence, disabled slots ignored, none → null.
 * - addToQueue end-to-end on the fake DB.
 * - scheduleBestTime: <10 scored posts → 400 carrying the count;
 *   ≥10 → scheduled at the computed weekday+hour.
 * - evergreen sweep: gap not reached → 0; gap reached → 1 draft +
 *   source cyclesUsed 1 + notification; second sweep → no more;
 *   max cycles reached → 0.
 */
const ORG = "org-1";
const ORG2 = "org-2";
const ACTOR = "owner-1";
type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("lte" in v) return row[k] != null && new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      if ("lt" in v) return row[k] != null && new Date(row[k]).getTime() < new Date((v as any).lt).getTime();
      return true;
    }
    if (v instanceof Date) return row[k] != null && new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => {
      let rows = store.filter((r) => matches(r, args.where));
      const ob = args.orderBy ?? {};
      const key = Object.keys(ob)[0];
      if (key) {
        const dir = ob[key] === "desc" ? -1 : 1;
        rows = [...rows].sort((a, b) => dir * (new Date(a[key] ?? 0).getTime() - new Date(b[key] ?? 0).getTime()));
      }
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r) => ({ ...r }));
    }),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = store.find((r) => matches(r, args.where));
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row ? { ...row } : null;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of store) if (matches(row, where)) { Object.assign(row, data, { updatedAt: new Date() }); count++; }
      return { count };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const idx = store.findIndex((r) => matches(r, where));
      if (idx >= 0) store.splice(idx, 1);
      return {};
    }),
    deleteMany: jest.fn(async ({ where }: any = {}) => {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) if (matches(store[i], where)) store.splice(i, 1);
      return { count: before - store.length };
    }),
  };
}

let seq = 0;
function fakeDb() {
  const db: any = {
    socialAccounts: [] as Row[], socialPosts: [] as Row[], slots: [] as Row[],
    memberships: [] as Row[], notifications: [] as Row[], auditRows: [] as Row[],
    organizations: [{ id: ORG, timezone: "Asia/Dhaka" }] as Row[],
  };
  db.socialAccount = table(db.socialAccounts);
  db.membership = table(db.memberships);
  db.organization = table(db.organizations);
  db.socialPostingSlot = table(db.slots);
  db.agentNotification = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `notif-${++seq}`, createdAt: new Date(), ...data };
      db.notifications.push(row);
      return { ...row };
    }),
  };
  db.socialPost = {
    ...table(db.socialPosts),
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: `post-${++seq}`, createdAt: new Date(), updatedAt: new Date(),
        linkUrl: null, scheduledAt: null, publishedAt: null, platformPostId: null,
        platformUrl: null, error: null, attempts: 0, mediaRefs: [], ...data,
      };
      db.socialPosts.push(row);
      return { ...row };
    }),
  };
  return db;
}

function services(db: any) {
  const audit = { log: jest.fn(async (input: any) => { db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, ...input }); }) };
  const social = new SocialService(db as any, audit as any);
  const queue = new SocialQueueService(db as any, audit as any, social);
  return { social, queue, audit };
}

function seedAccount(db: any, over: Row = {}) {
  const row = {
    id: `sacc-${db.socialAccounts.length + 1}`, organizationId: ORG, platform: "meta_page",
    externalId: "page-1", name: "Shop One", username: null, pictureUrl: null,
    status: "connected", lastError: null, integrationId: "int-1", createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialAccounts.push(row);
  return row;
}

function seedPost(db: any, over: Row = {}) {
  const row = {
    id: `post-seed-${db.socialPosts.length + 1}-${Math.random().toString(36).slice(2, 6)}`, organizationId: ORG, socialAccountId: "sacc-1",
    caption: "ক্যাপশন", linkUrl: null, mediaRefs: [], status: "draft",
    scheduledAt: null, publishedAt: null, platformPostId: null, platformUrl: null,
    error: null, attempts: 0, createdById: ACTOR,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
  db.socialPosts.push(row);
  return row;
}

function seedMemberships(db: any) {
  db.memberships.push(
    { id: "m-owner", organizationId: ORG, userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "m-admin", organizationId: ORG, userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
    { id: "m-mm", organizationId: ORG, userId: "mm-1", role: "MARKETING_MANAGER", status: "ACTIVE" },
  );
}

describe("SU2 slot CRUD", () => {
  it("create + list + update + delete with audits", async () => {
    const db = fakeDb(); seedAccount(db);
    const { queue } = services(db);
    const slot = await queue.createSlot(ORG, ACTOR, { socialAccountId: "sacc-1", weekday: 5, time: "10:30" } as any);
    expect(slot.weekday).toBe(5);
    expect(slot.time).toBe("10:30");
    expect(slot.enabled).toBe(true);
    expect(await queue.listSlots(ORG)).toHaveLength(1);
    const updated = await queue.updateSlot(ORG, ACTOR, slot.id, { time: "11:00", enabled: false } as any);
    expect(updated.time).toBe("11:00");
    expect(updated.enabled).toBe(false);
    const del = await queue.deleteSlot(ORG, ACTOR, slot.id);
    expect(del.deleted).toBe(true);
    expect(await queue.listSlots(ORG)).toHaveLength(0);
    expect(db.auditRows.map((r: Row) => r.action)).toEqual(expect.arrayContaining([
      "social.posting_slot_created", "social.posting_slot_updated", "social.posting_slot_deleted",
    ]));
  });

  it("duplicate account+weekday+time → Conflict (even against a disabled slot)", async () => {
    const db = fakeDb(); seedAccount(db);
    const { queue } = services(db);
    await queue.createSlot(ORG, ACTOR, { socialAccountId: "sacc-1", weekday: 1, time: "09:00", enabled: false } as any);
    const err = await queue.createSlot(ORG, ACTOR, { socialAccountId: "sacc-1", weekday: 1, time: "09:00" } as any).catch((e) => e);
    expect(err).toMatchObject({ code: "social.aSlotAlreadyExistsForThis" });
  });

  it("invalid time → Bengali 400; foreign account → 404", async () => {
    const db = fakeDb(); seedAccount(db);
    seedAccount(db, { id: "sacc-foreign", organizationId: ORG2 });
    const { queue } = services(db);
    const bad = await queue.createSlot(ORG, ACTOR, { socialAccountId: "sacc-1", weekday: 1, time: "25:99" } as any).catch((e) => e);
    expect(bad).toMatchObject({ code: "social.slotHhMm1030" });
    expect(bad.message).toContain("HH:MM");
    const foreign = await queue.createSlot(ORG, ACTOR, { socialAccountId: "sacc-foreign", weekday: 1, time: "09:00" } as any).catch((e) => e);
    expect(foreign).toMatchObject({ code: "social.socialAccountNotFoundInThis" });
  });
});

describe("SU2 computeNextSlot (pure)", () => {
  // 2026-10-13 is a Tuesday; 02:00Z = 08:00 in Asia/Dhaka (UTC+6).
  const now = new Date("2026-10-13T02:00:00.000Z");
  it("same-day slot later today → exact UTC instant (10:30 Dhaka = 04:30Z)", () => {
    const next = computeNextSlot([{ weekday: 2, time: "10:30", enabled: true }], [], now, "Asia/Dhaka");
    expect(next?.toISOString()).toBe("2026-10-13T04:30:00.000Z");
  });
  it("occupied minute is skipped to the next week's occurrence", () => {
    const occupied = [new Date("2026-10-13T04:30:00.000Z")];
    const next = computeNextSlot([{ weekday: 2, time: "10:30", enabled: true }], occupied, now, "Asia/Dhaka");
    expect(next?.toISOString()).toBe("2026-10-20T04:30:00.000Z");
  });
  it("a slot earlier today rolls to its next day occurrence (different weekday slot)", () => {
    const next = computeNextSlot(
      [{ weekday: 2, time: "07:00", enabled: true }, { weekday: 3, time: "07:00", enabled: true }],
      [], now, "Asia/Dhaka",
    );
    // Tuesday 07:00 Dhaka is already past at 08:00; Wednesday's wins.
    expect(next?.toISOString()).toBe("2026-10-14T01:00:00.000Z");
  });
  it("disabled slots are ignored; no enabled slot → null", () => {
    expect(computeNextSlot([{ weekday: 2, time: "10:30", enabled: false }], [], now, "Asia/Dhaka")).toBeNull();
    expect(computeNextSlot([], [], now, "Asia/Dhaka")).toBeNull();
  });
});

describe("SU2 addToQueue", () => {
  it("no slots → Bengali 400 naming the missing slot", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db);
    const { queue } = services(db);
    const err = await queue.addToQueue(ORG, ACTOR, post.id).catch((e) => e);
    expect(err).toMatchObject({ code: "social.thereIsNoPostingSlotFor" });
    expect(err.message).toContain("কোনো Posting Slot নেই");
  });

  it("with slots for every weekday → the post is scheduled at the slot time (delegates to schedulePost)", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db);
    const { queue } = services(db);
    // A slot time safely in the future today-or-later: Dhaka now +3h, :00 minutes.
    const dhakaNow = new Date(Date.now() + 6 * 3600_000);
    const hour = (dhakaNow.getUTCHours() + 3) % 24;
    const time = `${String(hour).padStart(2, "0")}:00`;
    for (let weekday = 0; weekday < 7; weekday++) {
      await queue.createSlot(ORG, ACTOR, { socialAccountId: "sacc-1", weekday, time } as any);
    }
    const res = await queue.addToQueue(ORG, ACTOR, post.id);
    expect(res.status).toBe("scheduled");
    expect(new Date(res.scheduledAt).getTime()).toBeGreaterThan(Date.now());
    const dhaka = new Date(new Date(res.scheduledAt).getTime() + 6 * 3600_000);
    expect(dhaka.getUTCHours()).toBe(hour);
    expect(dhaka.getUTCMinutes()).toBe(0);
  });

  it("published post → Conflict", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { status: "published", publishedAt: new Date() });
    const { queue } = services(db);
    const err = await queue.addToQueue(ORG, ACTOR, post.id).catch((e) => e);
    expect(err).toMatchObject({ code: "social.thePostCannotBeQueuedIn" });
  });
});

describe("SU2 scheduleBestTime", () => {
  const monday15Dhaka = new Date("2026-10-05T09:00:00.000Z"); // Monday 15:00 Asia/Dhaka
  function seedScored(db: any, count: number) {
    for (let i = 0; i < count; i++) {
      seedPost(db, {
        status: "published", publishedAt: monday15Dhaka, platformPostId: `fb-${i}`,
        insights: { platform: "meta_page", reactions: 5, comments: 1, shares: 0 },
      });
    }
  }

  it("fewer than 10 scored posts → 400 carrying the actual count", async () => {
    const db = fakeDb(); seedAccount(db);
    seedScored(db, 9);
    const target = seedPost(db);
    const { queue } = services(db);
    const err = await queue.scheduleBestTime(ORG, ACTOR, target.id).catch((e) => e);
    expect(err).toMatchObject({ code: "social.thereIsNotEnoughDataTo" });
    expect(err.message).toContain("৯টি");
    expect(err.message).toContain("১০টি");
  });

  it("10 scored posts (all Monday 15:00 Dhaka) → scheduled at the next Monday 15:00 Dhaka", async () => {
    const db = fakeDb(); seedAccount(db);
    seedScored(db, 10);
    const target = seedPost(db);
    const { queue } = services(db);
    const res = await queue.scheduleBestTime(ORG, ACTOR, target.id);
    expect(res.status).toBe("scheduled");
    const at = new Date(res.scheduledAt);
    expect(at.getTime()).toBeGreaterThan(Date.now());
    const dhaka = new Date(at.getTime() + 6 * 3600_000);
    expect(dhaka.getUTCDay()).toBe(1); // Monday
    expect(dhaka.getUTCHours()).toBe(15);
    expect(dhaka.getUTCMinutes()).toBe(0);
  });
});

describe("SU2 evergreen sweep", () => {
  it("gap not reached → nothing recycled", async () => {
    const db = fakeDb(); seedAccount(db); seedMemberships(db);
    seedPost(db, {
      status: "published", publishedAt: new Date(Date.now() - 2 * 86400_000),
      isEvergreen: true, evergreenMinGapDays: 7, evergreenCyclesUsed: 0, evergreenLastRecycledAt: null,
    });
    const { queue } = services(db);
    const out = await queue.runEvergreenSweep(ORG);
    expect(out).toEqual({ scanned: 1, recycled: 0, skipped: 1 });
    expect(db.socialPosts).toHaveLength(1);
  });

  it("gap reached → 1 draft clone, source cyclesUsed 1, notification sent; second sweep recycles no more", async () => {
    const db = fakeDb(); seedAccount(db); seedMemberships(db);
    const source = seedPost(db, {
      status: "published", publishedAt: new Date(Date.now() - 10 * 86400_000),
      caption: "Evergreen অফার", isEvergreen: true, evergreenMinGapDays: 7,
      evergreenMaxCycles: null, evergreenCyclesUsed: 0, evergreenLastRecycledAt: null,
    });
    const { queue } = services(db);
    const out = await queue.runEvergreenSweep(ORG);
    expect(out.recycled).toBe(1);
    expect(db.socialPosts).toHaveLength(2);
    const storedSource = db.socialPosts.find((p: Row) => p.id === source.id);
    expect(storedSource.evergreenCyclesUsed).toBe(1);
    expect(storedSource.evergreenLastRecycledAt).toBeTruthy();
    const draft = db.socialPosts.find((p: Row) => p.id !== source.id);
    expect(draft.status).toBe("draft");
    expect(draft.caption).toBe("Evergreen অফার");
    expect(draft.isEvergreen).toBe(true);
    expect(draft.evergreenCyclesUsed).toBe(1);
    expect(db.notifications.map((n: Row) => n.userId).sort()).toEqual(["admin-1", "owner-1"]);
    expect(db.notifications[0].type).toBe("social_evergreen_recycled");
    expect(db.auditRows.some((r: Row) => r.action === "social.evergreen_recycled")).toBe(true);

    const again = await queue.runEvergreenSweep(ORG);
    expect(again.recycled).toBe(0);
    expect(db.socialPosts).toHaveLength(2);
  });

  it("max cycles reached → nothing recycled", async () => {
    const db = fakeDb(); seedAccount(db); seedMemberships(db);
    seedPost(db, {
      status: "published", publishedAt: new Date(Date.now() - 30 * 86400_000),
      isEvergreen: true, evergreenMinGapDays: 7, evergreenMaxCycles: 3,
      evergreenCyclesUsed: 3, evergreenLastRecycledAt: null,
    });
    const { queue } = services(db);
    const out = await queue.runEvergreenSweep(ORG);
    expect(out.recycled).toBe(0);
    expect(db.socialPosts).toHaveLength(1);
  });

  it("setEvergreen sets the config on any post and audits", async () => {
    const db = fakeDb(); seedAccount(db);
    const post = seedPost(db, { status: "published", publishedAt: new Date() });
    const { queue } = services(db);
    const res = await queue.setEvergreen(ORG, ACTOR, post.id, {
      isEvergreen: true, evergreenMinGapDays: 14, evergreenMaxCycles: 5,
    } as any);
    expect(res.isEvergreen).toBe(true);
    expect(res.evergreenMinGapDays).toBe(14);
    expect(res.evergreenMaxCycles).toBe(5);
    expect(db.auditRows.some((r: Row) => r.action === "social.post_evergreen_updated")).toBe(true);
  });
});
