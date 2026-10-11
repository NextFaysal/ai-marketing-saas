import "reflect-metadata";
import { AutomationService, JOB_TEMPLATES, JOB_TYPES } from "./automation.service";

/**
 * CX3 — job registration for the two reply-debounce sweeps:
 * both types are real JOB_TYPES, both templates exist (org
 * target, 1-minute interval), installing them creates real
 * ScheduledJobs through createJob, and executeJob dispatches
 * each type to the right service method. Fake services only.
 */
const ORG = "org-1";
type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}
function fakeDb() {
  const jobs: Row[] = [];
  const db: any = {
    scheduledJob: {
      findMany: jest.fn(async (args: any = {}) => jobs.filter((r) => matches(r, args.where))),
      findFirst: jest.fn(async (args: any = {}) => jobs.find((r) => matches(r, args.where)) ?? null),
      create: jest.fn(async ({ data }: any) => { const row = { id: `job-${jobs.length + 1}`, createdAt: new Date(), ...data }; jobs.push(row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { const row = jobs.find((r) => matches(r, where)); if (row) Object.assign(row, data); return row; }),
    },
    organization: { findMany: jest.fn(async () => []) },
  };
  return { db, jobs };
}
function service(db: any, inbox?: any, socialComments?: any) {
  // Positional construction mirrors a4-job-templates.spec.ts;
  // CX3's socialComments is the LAST optional parameter.
  return new AutomationService(
    db as any, { log: jest.fn(async () => undefined) } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    undefined, undefined, inbox, undefined, undefined, undefined, undefined, undefined, undefined,
    socialComments,
  );
}

describe("CX3 job registration", () => {
  it("JOB_TYPES and JOB_TEMPLATES contain both sweep types (org, 1 minute)", () => {
    expect(JOB_TYPES as readonly string[]).toContain("inbox_autoreply_sweep");
    expect(JOB_TYPES as readonly string[]).toContain("comment_autoreply_sweep");
    for (const type of ["inbox_autoreply_sweep", "comment_autoreply_sweep"]) {
      const tpl = JOB_TEMPLATES.find((t) => t.type === type);
      expect(tpl).toBeTruthy();
      expect(tpl!.key).toBe(type);
      expect(tpl!.targetKind).toBe("org");
      expect(tpl!.intervalMinutes).toBe(1);
      expect(tpl!.descriptionBn.length).toBeGreaterThan(10);
    }
  });

  it("both templates install as real 1-minute ScheduledJobs through createJob", async () => {
    const { db, jobs } = fakeDb();
    const svc = service(db);
    const a: any = await svc.installJobTemplate(ORG, "owner", "inbox_autoreply_sweep");
    expect(a).toMatchObject({ organizationId: ORG, type: "inbox_autoreply_sweep", targetId: ORG, intervalMinutes: 1, enabled: true });
    const b: any = await svc.installJobTemplate(ORG, "owner", "comment_autoreply_sweep");
    expect(b).toMatchObject({ organizationId: ORG, type: "comment_autoreply_sweep", targetId: ORG, intervalMinutes: 1, enabled: true });
    expect(jobs).toHaveLength(2);
  });

  it("executeJob dispatches inbox_autoreply_sweep to InboxService.runDueAutoReplies(orgId)", async () => {
    const { db } = fakeDb();
    const inbox = { runDueAutoReplies: jest.fn(async () => ({ fired: 2, skipped: 1 })) };
    const svc = service(db, inbox, { runDueCommentReplies: jest.fn(async () => ({ fired: 0, batched: 0, skipped: 0 })) });
    const out: any = await svc.executeJob({ organizationId: ORG, createdById: "owner", type: "inbox_autoreply_sweep", targetId: ORG });
    expect(inbox.runDueAutoReplies).toHaveBeenCalledWith(ORG);
    expect(out).toEqual({ fired: 2, skipped: 1 });
  });

  it("executeJob dispatches comment_autoreply_sweep to SocialCommentsService.runDueCommentReplies(orgId)", async () => {
    const { db } = fakeDb();
    const comments = { runDueCommentReplies: jest.fn(async () => ({ fired: 1, batched: 1, skipped: 0 })) };
    const svc = service(db, { runDueAutoReplies: jest.fn(async () => ({ fired: 0, skipped: 0 })) }, comments);
    const out: any = await svc.executeJob({ organizationId: ORG, createdById: "owner", type: "comment_autoreply_sweep", targetId: ORG });
    expect(comments.runDueCommentReplies).toHaveBeenCalledWith(ORG);
    expect(out).toEqual({ fired: 1, batched: 1, skipped: 0 });
  });

  it("executeJob fails honestly when the sweep service is not wired", async () => {
    const { db } = fakeDb();
    const svc = service(db);
    await expect(svc.executeJob({ organizationId: ORG, createdById: "owner", type: "inbox_autoreply_sweep", targetId: ORG })).rejects.toThrow(/not available/);
    await expect(svc.executeJob({ organizationId: ORG, createdById: "owner", type: "comment_autoreply_sweep", targetId: ORG })).rejects.toThrow(/not available/);
  });
});
