import { NOTIFICATION_CATEGORY_KEYS, categoryOfType, createAgentNotification } from "./agent-notify";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * GB6 (GC16): notification categories + mute preferences.
 * A muted category suppresses creation entirely; a broken
 * preference lookup never swallows a notification; unmapped
 * types fall into the "general" catch-all.
 */
function fakePrisma(pref: any, opts: { prefThrows?: boolean } = {}) {
  const created: any[] = [];
  const prisma: any = {
    notificationPreference: {
      findUnique: jest.fn(async () => {
        if (opts.prefThrows) throw new Error("preference table unavailable");
        return pref;
      }),
    },
    agentNotification: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `n-${created.length + 1}`, ...data }; created.push(row); return row; }),
    },
  };
  return { prisma, created };
}
const data = (type: string) => ({ organizationId: "org", userId: "u-1", type, title: "t", body: "b", conversationId: null });

describe("GB6 categoryOfType", () => {
  it("maps known types to their categories and everything else to general", () => {
    expect(categoryOfType("low_stock")).toBe("inventory");
    expect(categoryOfType("out_of_stock")).toBe("inventory");
    expect(categoryOfType("urgent")).toBe("orders");
    expect(categoryOfType("mention")).toBe("inbox");
    expect(categoryOfType("billing")).toBe("billing");
    expect(categoryOfType("ad_account_sync_failed")).toBe("marketing");
    expect(categoryOfType("social_post_failed")).toBe("marketing");
    expect(categoryOfType("workflow_failed")).toBe("automation");
    expect(categoryOfType("job_dead_letter")).toBe("automation");
    expect(categoryOfType("lead_followup")).toBe("leads");
    expect(categoryOfType("referral")).toBe("leads");
    expect(categoryOfType("something_new")).toBe("general");
    expect(NOTIFICATION_CATEGORY_KEYS).toContain("general");
  });
});

describe("GB6 createAgentNotification", () => {
  it("a muted category returns null and the row is NOT created", async () => {
    const { prisma, created } = fakePrisma({ mutedCategories: ["inventory"] });
    const out = await createAgentNotification(prisma, data("low_stock"));
    expect(out).toBeNull();
    expect(created).toHaveLength(0);
    expect(prisma.agentNotification.create).not.toHaveBeenCalled();
  });

  it("muting a DIFFERENT category does not suppress creation", async () => {
    const { prisma, created } = fakePrisma({ mutedCategories: ["orders"] });
    const out = await createAgentNotification(prisma, data("low_stock"));
    expect(out).toMatchObject({ type: "low_stock" });
    expect(created).toHaveLength(1);
  });

  it("no preference row means the notification is created", async () => {
    const { prisma, created } = fakePrisma(null);
    await expect(createAgentNotification(prisma, data("billing"))).resolves.toMatchObject({ type: "billing" });
    expect(created).toHaveLength(1);
  });

  it("a failing preference lookup still creates the notification", async () => {
    const { prisma, created } = fakePrisma(null, { prefThrows: true });
    await expect(createAgentNotification(prisma, data("urgent"))).resolves.toMatchObject({ type: "urgent" });
    expect(created).toHaveLength(1);
  });

  it("create errors propagate to the caller exactly as a direct create did", async () => {
    const { prisma } = fakePrisma(null);
    prisma.agentNotification.create = jest.fn(async () => { throw new Error("insert failed"); });
    await expect(createAgentNotification(prisma, data("billing"))).rejects.toThrow(/insert failed/);
  });

  it("muting 'general' suppresses unmapped types only", async () => {
    const { prisma, created } = fakePrisma({ mutedCategories: ["general"] });
    await expect(createAgentNotification(prisma, data("brand_new_type"))).resolves.toBeNull();
    await expect(createAgentNotification(prisma, data("billing"))).resolves.toMatchObject({ type: "billing" });
    expect(created).toHaveLength(1);
  });
});

describe("GB6 notification preference endpoints (service)", () => {
  function db() {
    let pref: any = null;
    const fake: any = {
      notificationPreference: {
        findUnique: jest.fn(async () => pref),
        upsert: jest.fn(async ({ create, update }: any) => { pref = pref ? { ...pref, ...update } : { id: "np-1", ...create }; return pref; }),
      },
    };
    const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
    return { svc: new OrganizationsService(fake, audit as any), audit, getPref: () => pref };
  }

  it("defaults to nothing muted, then round-trips an upsert with an audit entry", async () => {
    const { svc, audit } = db();
    const before: any = await svc.getMyNotificationPreferences("org", "u-1");
    expect(before.mutedCategories).toEqual([]);
    expect(before.categories.map((c: any) => c.key)).toEqual(NOTIFICATION_CATEGORY_KEYS);

    const after: any = await svc.updateMyNotificationPreferences("org", "u-1", { mutedCategories: ["inventory", "orders", "inventory"] });
    expect(after.mutedCategories).toEqual(["inventory", "orders"]); // deduped
    expect(audit.calls[0]).toMatchObject({ action: "org.notification_preferences_updated", metadata: { count: 2 } });
  });

  it("unknown category keys are a 400", async () => {
    const { svc } = db();
    const err = await svc.updateMyNotificationPreferences("org", "u-1", { mutedCategories: ["mars"] }).catch((e: any) => e);
    expect(err).toMatchObject({ code: "organizations.unknownNotificationCategories", status: 400 });
    expect(err.params?.list).toContain("mars");
  });
});
