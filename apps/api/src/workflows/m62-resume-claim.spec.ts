import { WorkflowsService } from "./workflows.service";

/**
 * Milestone 62: resumeRuns claims each waiting run atomically —
 * two service instances over one database resume a run ONCE.
 */
type Row = Record<string, any>;
function match(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "OR" && Array.isArray(v)) return v.some((sub) => match(row, sub));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return ((v as any).in as any[]).includes(row[k]);
      if ("lte" in v) return row[k] <= (v as any).lte;
      if ("lt" in v) return row[k] < (v as any).lt;
      return true;
    }
    return row[k] === v;
  });
}
function fakeDb() {
  const runs: Row[] = [];
  const workflows: Row[] = [];
  const db: any = {
    workflowRun: {
      findMany: jest.fn(async ({ where }: any = {}) => runs.filter((r) => match(r, where))),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of runs) if (match(r, where)) { Object.assign(r, data, { updatedAt: new Date() }); count++; }
        return { count };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = runs.find((x) => x.id === where.id);
        if (r) Object.assign(r, data);
        return r;
      }),
    },
    workflow: { findFirst: jest.fn(async ({ where }: any) => workflows.find((w) => w.id === where.id) ?? null) },
    channelConversation: { findFirst: jest.fn(async () => null) },
    channelMessage: { findFirst: jest.fn(async () => null) },
  };
  return { db, runs, workflows };
}
function service(db: any) {
  const svc = new WorkflowsService(db as any, { log: jest.fn(async () => undefined) } as any, { on: () => undefined } as any, {} as any, undefined);
  return svc;
}

describe("M62 resume claim", () => {
  it("two instances, one waiting run: steps execute exactly once", async () => {
    const { db, runs, workflows } = fakeDb();
    workflows.push({ id: "wf-1", enabled: true, steps: [] });
    runs.push({ id: "run-1", workflowId: "wf-1", status: "waiting", resumeAt: new Date(Date.now() - 1000), context: {}, stepsLog: [], nextStepIndex: 0, updatedAt: new Date() });
    const a = service(db); const b = service(db);
    const execA = jest.spyOn(a as any, "executeSteps").mockResolvedValue(undefined);
    const execB = jest.spyOn(b as any, "executeSteps").mockResolvedValue(undefined);
    await a.resumeRuns();
    await b.resumeRuns();
    expect(execA.mock.calls.length + execB.mock.calls.length).toBe(1);
    expect(runs[0].status).toBe("resuming");
  });

  it("a stale resuming run (crashed claimer) is reclaimed; a fresh one is not", async () => {
    const { db, runs, workflows } = fakeDb();
    workflows.push({ id: "wf-1", enabled: true, steps: [] });
    const past = new Date(Date.now() - 1000);
    runs.push(
      { id: "stale", workflowId: "wf-1", status: "resuming", resumeAt: past, context: {}, stepsLog: [], nextStepIndex: 0, updatedAt: new Date(Date.now() - 20 * 60_000) },
      { id: "fresh", workflowId: "wf-1", status: "resuming", resumeAt: past, context: {}, stepsLog: [], nextStepIndex: 0, updatedAt: new Date() },
    );
    const a = service(db);
    const exec = jest.spyOn(a as any, "executeSteps").mockResolvedValue(undefined);
    await a.resumeRuns();
    expect(exec.mock.calls).toHaveLength(1);
    expect((exec.mock.calls[0] as any[])[1].id).toBe("stale");
  });
});
