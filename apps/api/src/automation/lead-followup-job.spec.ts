import { AutomationService, JOB_TYPES } from "./automation.service";

process.env.DISABLE_SCHEDULER = "true";

/** CRM C1: the lead_followup_sweep job type is registered and its
 * execution routes to LeadsService.sweepFollowUpReminders(orgId) —
 * the same executeJob path the in-process scheduler and the M57
 * BullMQ worker callback (executeScheduledJobById) both use. */
describe("lead_followup_sweep job", () => {
  it("is a registered job type", () => {
    expect((JOB_TYPES as readonly string[]).includes("lead_followup_sweep")).toBe(true);
  });

  it("executeJob routes to the leads sweep with the job's organization", async () => {
    const calls: string[] = [];
    const leadsStub = {
      sweepFollowUpReminders: async (orgId: string) => { calls.push(orgId); return { candidates: 2, notified: 2, notifications: 2, deduped: 0, noRecipient: 0 }; },
    };
    const svc = new AutomationService(
      {} as any, { log: async () => undefined } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      undefined, undefined, undefined, undefined, undefined, leadsStub as any,
    );
    const result: any = await svc.executeJob({ organizationId: "org-9", createdById: "owner", type: "lead_followup_sweep" });
    expect(calls).toEqual(["org-9"]);
    expect(result.notified).toBe(2);
  });

  it("fails honestly when the leads service is unavailable", async () => {
    const svc = new AutomationService(
      {} as any, { log: async () => undefined } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    await expect(svc.executeJob({ organizationId: "org-9", createdById: "owner", type: "lead_followup_sweep" }))
      .rejects.toThrow("Leads service is not available");
  });
});
