import { isValidWindows, isWithinSchedule } from "./working-hours";
import { InboxService } from "./inbox.service";

/**
 * Milestone 68 (Team T2): working-hours math + the assignment
 * engine's off-shift skip. Times are pinned in Asia/Dhaka
 * (UTC+6, no DST) so the expectations are exact.
 * 2026-10-11 is a Sunday. 09:00 Dhaka = 03:00 UTC.
 */
const sun = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 11, h - 6, m)); // Sunday, Dhaka time h:m
const mon = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 12, h - 6, m)); // Monday

describe("M68 working-hours math", () => {
  const schedule = { timezone: "Asia/Dhaka", windows: { sun: [["09:00", "18:00"]], mon: [["09:00", "18:00"]] } as any };

  it("inside / outside a normal window, boundaries are [start, end)", () => {
    expect(isWithinSchedule(schedule, sun(10, 30))).toBe(true);
    expect(isWithinSchedule(schedule, sun(9, 0))).toBe(true);
    expect(isWithinSchedule(schedule, sun(18, 0))).toBe(false);
    expect(isWithinSchedule(schedule, sun(8, 59))).toBe(false);
    expect(isWithinSchedule(schedule, mon(12, 0))).toBe(true);
  });

  it("a day with no windows is a day off", () => {
    const tue = new Date(Date.UTC(2026, 9, 13, 6, 0)); // Tuesday 12:00 Dhaka
    expect(isWithinSchedule(schedule, tue)).toBe(false);
  });

  it("overnight windows belong to the day they start", () => {
    const night = { timezone: "Asia/Dhaka", windows: { sun: [["22:00", "06:00"]] } as any };
    expect(isWithinSchedule(night, sun(23, 15))).toBe(true);  // Sunday night
    expect(isWithinSchedule(night, mon(3, 30))).toBe(true);   // Monday 03:30 — Sunday's window
    expect(isWithinSchedule(night, mon(7, 0))).toBe(false);   // Monday 07:00 — window over
    expect(isWithinSchedule(night, mon(23, 0))).toBe(false);  // Monday has no window of its own
  });

  it("validation rejects bad shapes and zero-length windows", () => {
    expect(isValidWindows({ mon: [["09:00", "18:00"]] })).toBe(true);
    expect(isValidWindows({ mon: [["09:00", "09:00"]] })).toBe(false);
    expect(isValidWindows({ funday: [["09:00", "18:00"]] })).toBe(false);
    expect(isValidWindows({ mon: [["9am", "18:00"]] })).toBe(false);
    expect(isValidWindows({ mon: "09-18" })).toBe(false);
    expect(isValidWindows(null)).toBe(false);
  });
});

describe("M68 assignment skips off-shift agents", () => {
  // Pin "now": Wednesday 2026-10-14, 12:00 Dhaka (06:00 UTC).
  const NOW = new Date(Date.UTC(2026, 9, 14, 6, 0));
  beforeAll(() => { jest.useFakeTimers({ now: NOW.getTime() }); });
  afterAll(() => { jest.useRealTimers(); });

  function fakeDb(schedules: any[]) {
    const memberships = [
      { userId: "agent-off", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE", createdAt: new Date(1) },
      { userId: "agent-on", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE", createdAt: new Date(2) },
    ];
    const db: any = {
      membership: { findMany: jest.fn(async () => memberships), findUnique: jest.fn(async () => null) },
      inboxTeam: { findMany: jest.fn(async () => []) },
      agentState: { findMany: jest.fn(async () => []), upsert: jest.fn(async () => ({})) },
      agentSchedule: {
        findMany: jest.fn(async () => schedules),
        upsert: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      channelConversation: {
        findMany: jest.fn(async () => []),
        update: jest.fn(async ({ data }: any) => ({ id: "conv-1", ...data, contactName: "Cust" })),
      },
      inboxSetting: {
        findUnique: jest.fn(async () => ({ organizationId: "org-1", smartAssign: "least_busy" })),
        update: jest.fn(async () => ({})),
        create: jest.fn(async () => ({})),
      },
    };
    return db;
  }
  function service(db: any) {
    const svc = new InboxService(db as any, { log: jest.fn(async () => undefined) } as any, {} as any);
    (svc as any).getSettings = jest.fn(async () => ({ smartAssign: "least_busy" }));
    (svc as any).notify = jest.fn(async () => undefined);
    return svc;
  }
  const fridayOnly = { organizationId: "org-1", userId: "agent-off", timezone: "Asia/Dhaka", windows: { fri: [["09:00", "18:00"]] } };

  it("Wednesday noon: the Friday-only agent is skipped; the schedule-less agent wins", async () => {
    const svc = service(fakeDb([fridayOnly]));
    const out: any = await (svc as any).maybeSmartAssign("org-1", { id: "conv-1", channel: "webchat" });
    expect(out.assignedUserId).toBe("agent-on");
  });

  it("when every candidate is off-shift the conversation stays unassigned", async () => {
    const bothOff = [fridayOnly, { ...fridayOnly, userId: "agent-on" }];
    const svc = service(fakeDb(bothOff));
    const conv = { id: "conv-1", channel: "webchat" };
    const out: any = await (svc as any).maybeSmartAssign("org-1", conv);
    expect(out.assignedUserId).toBeUndefined();
  });

  it("schedule CRUD: agents edit only their own; managers edit anyone; bad windows refused", async () => {
    const memberships = [
      { userId: "boss", organizationId: "org-1", role: "OWNER", status: "ACTIVE" },
      { userId: "agent-on", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE" },
    ];
    const saved: any[] = [];
    const db: any = {
      membership: {
        findUnique: jest.fn(async ({ where }: any) => memberships.find((m) => m.userId === where.userId_organizationId.userId) ?? null),
        findMany: jest.fn(async () => memberships),
      },
      agentSchedule: {
        findMany: jest.fn(async () => saved),
        upsert: jest.fn(async ({ create }: any) => { saved.push(create); return create; }),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const svc = new InboxService(db as any, { log: jest.fn(async () => undefined) } as any, {} as any);
    await expect(svc.setAgentSchedule("org-1", "agent-on", "boss", { windows: { mon: [["09:00", "17:00"]] } }))
      .rejects.toMatchObject({ code: "inbox.agentsCanOnlySetTheirOwn" });
    await expect(svc.setAgentSchedule("org-1", "boss", "agent-on", { windows: { mon: [["09:00", "09:00"]] } }))
      .rejects.toMatchObject({ code: "inbox.invalidWindowsUseWeekdayKeysMon" });
    const ok: any = await svc.setAgentSchedule("org-1", "boss", "agent-on", { windows: { wed: [["09:00", "18:00"]] } });
    expect(ok.userId).toBe("agent-on");
    expect(ok.onShift).toBe(true); // Wednesday noon is inside 09–18
  });
});
