import { AutomationService, JOB_TYPES, JOB_TEMPLATES } from "./automation.service";

/** Reports Advanced RP4: saved-report email delivery
 *  (recipient union, provider-confirmed sends, honest
 *  failures) + the monthly_report job type. */
function build(over: any = {}) {
  const sent: any[] = [];
  const prisma: any = {
    savedReport: { findFirst: async ({ where }: any) => (where.id === "sr-1" ? { id: "sr-1", name: "সাপ্তাহিক", recipients: ["extra@x.co"], dimension: "day", metrics: ["orders"], rangePreset: "last_7d" } : null) },
    membership: { findMany: async () => [{ user: { email: "owner@x.co" } }] },
    businessProfile: { findUnique: async () => ({ billingEmails: ["billing@x.co", "owner@x.co"] }) },
    ...over.prisma,
  };
  const email: any = { send: async (m: any) => { if (over.failSend) throw new Error("SMTP down"); sent.push(m); return { providerMessageId: "m-1" }; } };
  const exporter: any = { savedEmailParts: async () => ({ subject: "Report: সাপ্তাহিক", text: "t", html: "<b>h</b>" }) };
  const reports: any = { generate: async (_o: string, _a: string, dto: any) => ({ generated: dto.type }) };
  const svc = new AutomationService(
    prisma, { log: async () => undefined } as any,
    {} as any, {} as any, {} as any, reports, {} as any, {} as any,
    email, undefined, undefined, undefined, undefined, undefined, undefined, undefined, exporter,
  );
  return { svc, sent };
}

describe("RP4 report delivery jobs", () => {
  it("job types + the monthly template are registered", () => {
    expect(JOB_TYPES).toContain("monthly_report");
    expect(JOB_TYPES).toContain("saved_report_delivery");
    expect(JOB_TEMPLATES.some((t) => t.type === "monthly_report")).toBe(true);
  });

  it("delivery merges recipients (report ∪ owners ∪ billing, deduped) and sends HTML+text", async () => {
    const { svc, sent } = build();
    const out = await svc.deliverSavedReport("org", "sr-1");
    expect(out).toEqual({ sent: 3, recipients: 3, reportId: "sr-1" });
    expect(sent.map((m) => m.to).sort()).toEqual(["billing@x.co", "extra@x.co", "owner@x.co"]);
    expect(sent[0].html).toContain("<b>h</b>");
    expect(sent[0].subject).toContain("সাপ্তাহিক");
  });

  it("a missing saved report and an empty recipient union both fail the job honestly", async () => {
    const { svc } = build();
    await expect(svc.deliverSavedReport("org", "nope")).rejects.toMatchObject({ code: "automation.savedReportNotFoundForThis" });
    const empty = build({ prisma: {
      savedReport: { findFirst: async () => ({ id: "sr-1", recipients: [] }) },
      membership: { findMany: async () => [] },
      businessProfile: { findUnique: async () => ({ billingEmails: [] }) },
    } });
    await expect(empty.svc.deliverSavedReport("org", "sr-1")).rejects.toMatchObject({ code: "automation.noEmailRecipientsFoundForThis" });
  });

  it("a provider failure propagates (the job fails, nothing counts as sent)", async () => {
    const { svc } = build({ failSend: true });
    await expect(svc.deliverSavedReport("org", "sr-1")).rejects.toThrow(/SMTP down/);
  });

  it("monthly_report executes the AI monthly generation", async () => {
    const { svc } = build();
    const out = await (svc as any).executeJob({ organizationId: "org", createdById: "actor", type: "monthly_report", targetId: "org" });
    expect(out).toEqual({ generated: "monthly" });
  });
});
