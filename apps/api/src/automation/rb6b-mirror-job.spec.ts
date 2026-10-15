import { AutomationService, JOB_TEMPLATES, JOB_TYPES } from "./automation.service";

/**
 * RB6b — the product_image_mirror_sweep job registration +
 * dispatch. The mirror service itself is stubbed here (its real
 * behaviour, incl. the opt-out skip, is spec-covered in
 * products/rb6b-auto-mirror.spec.ts); this file pins the job
 * catalogue entry and that executeJob passes (orgId, actor)
 * through and returns the service's result verbatim.
 */

const ORG = "org-1";

function service(mirror?: any) {
  // Positional construction in the a4/cx3 style: every optional
  // dependency is undefined except the mirror, which is the LAST
  // constructor parameter (RB6b appended it on purpose).
  return new AutomationService(
    {} as any, { log: async () => undefined } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined,
    mirror,
  );
}

describe("RB6b product_image_mirror_sweep job", () => {
  it("is registered in JOB_TYPES with an org template (daily)", () => {
    expect(JOB_TYPES as readonly string[]).toContain("product_image_mirror_sweep");
    const tpl = JOB_TEMPLATES.find((t) => t.type === "product_image_mirror_sweep");
    expect(tpl).toBeTruthy();
    expect(tpl!.key).toBe("product_image_mirror_sweep");
    expect(tpl!.targetKind).toBe("org");
    expect(tpl!.intervalMinutes).toBe(1440);
    expect(tpl!.descriptionBn.length).toBeGreaterThan(10);
  });

  it("executeJob dispatches to runAutoMirror(orgId, actor) and returns its summary verbatim", async () => {
    const summary = { scanned: 3, mirrored: 2, deduped: 1, failed: 0, reviews: { scanned: 1, mirrored: 1, failed: 0 } };
    const mirror = { runAutoMirror: jest.fn(async () => summary) };
    const svc = service(mirror);
    const out: any = await svc.executeJob({ organizationId: ORG, createdById: "owner-1", type: "product_image_mirror_sweep", targetId: ORG });
    expect(mirror.runAutoMirror).toHaveBeenCalledWith(ORG, "owner-1");
    expect(out).toEqual(summary);
  });

  it("an opted-out org's skip marker becomes the job result", async () => {
    const mirror = { runAutoMirror: jest.fn(async () => ({ skipped: "opted-out" })) };
    const svc = service(mirror);
    const out: any = await svc.executeJob({ organizationId: ORG, createdById: "owner-1", type: "product_image_mirror_sweep", targetId: ORG });
    expect(out).toEqual({ skipped: "opted-out" });
  });

  it("without the mirror service the job reports itself unavailable instead of throwing", async () => {
    const svc = service(undefined);
    const out: any = await svc.executeJob({ organizationId: ORG, createdById: "owner-1", type: "product_image_mirror_sweep", targetId: ORG });
    expect(out).toEqual({ skipped: "product image mirror unavailable" });
  });
});
