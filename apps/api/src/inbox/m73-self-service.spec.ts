import { InboxService, appendSignature } from "./inbox.service";

/**
 * Milestone 73 (Team T4): agent self-service.
 * - appendSignature joins body + signature with a blank line.
 * - updateMySignature stores trimmed text; enabling with an
 *   empty signature can never turn on (nothing to append).
 * - withSignature returns the plain body when disabled/absent.
 * - myPerformance surfaces ONLY the caller's own rows.
 */
describe("M73 signature", () => {
  function svcWith(state: any) {
    const store = { row: state };
    const fake: any = {
      agentState: {
        findUnique: jest.fn(async () => store.row),
        upsert: jest.fn(async ({ create, update }: any) => {
          store.row = store.row ? { ...store.row, ...update } : { ...create };
          return store.row;
        }),
      },
    };
    const svc = new InboxService(fake, {} as any, {} as any, {} as any);
    return { svc, store };
  }

  it("appendSignature is a pure join", () => {
    expect(appendSignature("ধন্যবাদ!", "— রাফি, সাপোর্ট টিম")).toBe("ধন্যবাদ!\n\n— রাফি, সাপোর্ট টিম");
    expect(appendSignature("ধন্যবাদ!", "   ")).toBe("ধন্যবাদ!");
  });

  it("save trims, caps, and refuses to enable an empty signature", async () => {
    const { svc } = svcWith(null);
    const saved = await svc.updateMySignature("org", "agent", { signature: "  — রাফি, সাপোর্ট  ", enabled: true });
    expect(saved).toEqual({ signature: "— রাফি, সাপোর্ট", enabled: true });
    const empty = await svc.updateMySignature("org", "agent", { signature: "   ", enabled: true });
    expect(empty.enabled).toBe(false);
  });

  it("withSignature appends only when enabled", async () => {
    const on = svcWith({ signature: "— রাফি", signatureEnabled: true });
    expect(await on.svc.withSignature("org", "agent", "হ্যালো")).toBe("হ্যালো\n\n— রাফি");
    const off = svcWith({ signature: "— রাফি", signatureEnabled: false });
    expect(await off.svc.withSignature("org", "agent", "হ্যালো")).toBe("হ্যালো");
    const none = svcWith(null);
    expect(await none.svc.withSignature("org", "agent", "হ্যালো")).toBe("হ্যালো");
  });
});

describe("M73 my performance", () => {
  it("returns only the caller's rows", async () => {
    const svc: any = new InboxService({} as any, {} as any, {} as any, {} as any);
    svc.teamScorecard = async () => ({ agents: [
      { userId: "boss", rank: 1 }, { userId: "agent", rank: 2 },
    ] });
    // Real teamActivity shape: { members: [{ activityState, today: {...} }] }.
    svc.teamActivity = async () => ({ members: [
      { userId: "boss", activityState: "active", today: { repliesSent: 9, closedToday: 2, openNow: 1 } },
      { userId: "agent", activityState: "idle", onShift: true, today: { repliesSent: 3, closedToday: 0, openNow: 4 } },
    ] });
    const out = await svc.myPerformance("org", "agent", 7);
    expect(out.me.userId).toBe("agent");
    expect(out.rank).toBe(2);
    expect(out.totalAgents).toBe(2);
    expect(out.today).toEqual({ state: "idle", onShift: true, repliesToday: 3, closedToday: 0, openNow: 4 });
    const nobody = await svc.myPerformance("org", "viewer", 7);
    expect(nobody.me).toBeNull();
    expect(nobody.today).toBeNull();
  });
});
