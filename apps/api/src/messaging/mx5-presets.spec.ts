process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.DISABLE_SCHEDULER = "true";

import { MessagingService } from "./messaging.service";
import { JOURNEY_PRESETS } from "./journey-presets";
import {
  JOURNEY_PRESETS_V2, UNAVAILABLE_JOURNEY_PRESETS,
  PRESET_VARIABLE_ALLOWLIST, PRESET_V2_TRIGGERS,
} from "./journey-presets-v2";
import { WORKFLOW_TRIGGERS } from "../workflows/workflows.service";

/**
 * MX5 — v2 preset catalogue integrity + install path.
 * The install tests use a STUB workflow-creator port that
 * records its payloads verbatim (the real-engine install is
 * proven end-to-end in mx5-scan-enrollment.spec.ts and by the
 * unmodified ms8-bridge suite); here the point is the exact
 * payload messaging hands the engine.
 */

function build(withPort = true) {
  const templateRows: any[] = [];
  let seq = 0;
  const prisma = {
    messageTemplate: {
      create: async ({ data }: any) => {
        const row = { id: `tpl-${++seq}`, createdAt: new Date(), ...data };
        templateRows.push(row);
        return row;
      },
      findFirst: async ({ where }: any) => templateRows.find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null,
    },
  } as any;
  const auditCalls: any[] = [];
  const audit = { log: async (e: any) => { auditCalls.push(e); } } as any;
  const email = { isConfigured: () => true, send: async () => ({ providerMessageId: "x" }) } as any;
  const sms = { isConfigured: () => true, send: async () => ({ providerMessageId: "y" }) } as any;
  const svc = new MessagingService(prisma, audit, email, sms);
  const creates: any[] = [];
  const updates: any[] = [];
  const store: any[] = [];
  if (withPort) {
    svc.registerWorkflowCreator({
      create: async (orgId: string, actorId: string, dto: any) => {
        creates.push({ orgId, actorId, dto });
        const wf = { id: `wf-${store.length + 1}`, organizationId: orgId, enabled: true, ...dto };
        store.push(wf);
        return wf;
      },
      update: async (orgId: string, workflowId: string, dto: any) => {
        updates.push({ orgId, workflowId, dto });
        const wf = store.find((w) => w.id === workflowId);
        Object.assign(wf, dto);
        return wf;
      },
    } as any);
  }
  return { svc, templateRows, auditCalls, creates, updates, store };
}

const varsOf = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

describe("MX5 v2 catalogue integrity", () => {
  it("has exactly the five MX5 presets plus browse_abandoned, with unique keys + slots", () => {
    expect(JOURNEY_PRESETS_V2.map((p) => p.key)).toEqual([
      "welcome_series", "post_purchase_care", "replenishment_reminder",
      "win_back", "anniversary", "browse_abandoned",
    ]);
    for (const p of JOURNEY_PRESETS_V2) {
      const slots = p.templates.map((t) => t.slot);
      expect(new Set(slots).size).toBe(slots.length);
      expect(p.templates.length).toBeGreaterThanOrEqual(1);
    }
    // No collision with the MS8 catalogue (cart recovery stays MS8-only).
    const v1Keys = JOURNEY_PRESETS.map((p) => p.key);
    for (const p of JOURNEY_PRESETS_V2) expect(v1Keys).not.toContain(p.key);
  });

  it("every step references an existing template slot; every wait is within 1..43200; triggers are engine triggers", () => {
    for (const p of JOURNEY_PRESETS_V2) {
      expect(PRESET_V2_TRIGGERS).toContain(p.trigger);
      expect(WORKFLOW_TRIGGERS as readonly string[]).toContain(p.trigger);
      const ids = Object.fromEntries(p.templates.map((t) => [t.slot, `id:${t.slot}`]));
      const steps = p.steps(ids);
      expect(steps.length).toBeGreaterThanOrEqual(1);
      for (const s of steps as any[]) {
        if (s.type === "wait") {
          expect(Number(s.minutes)).toBeGreaterThanOrEqual(1);
          expect(Number(s.minutes)).toBeLessThanOrEqual(43200);
        } else if (s.type === "send_email" || s.type === "send_sms") {
          expect(Object.values(ids)).toContain(s.templateId);
          // The step's channel must match the template slot's channel.
          const slot = Object.keys(ids).find((k) => ids[k] === s.templateId)!;
          const tpl = p.templates.find((t) => t.slot === slot)!;
          expect(s.type).toBe(tpl.channel === "email" ? "send_email" : "send_sms");
        } else {
          throw new Error(`unexpected step type ${s.type} in ${p.key}`);
        }
      }
    }
  });

  it("templates use ONLY variables the real context supplies (per-trigger allowlist)", () => {
    for (const p of JOURNEY_PRESETS_V2) {
      const allowed = PRESET_VARIABLE_ALLOWLIST[p.trigger];
      expect(allowed).toBeTruthy();
      for (const t of p.templates) {
        for (const v of [...varsOf(t.body), ...varsOf(t.subject ?? "")]) {
          expect(allowed).toContain(v);
        }
      }
    }
  });

  it("preset shapes match the MX5 spec (waits, conditions, exit flags)", () => {
    const byKey = Object.fromEntries(JOURNEY_PRESETS_V2.map((p) => [p.key, p]));
    const ids = (p: any) => Object.fromEntries(p.templates.map((t: any) => [t.slot, t.slot]));
    // welcome_series: send → 1440 → send → 2880 → send, 3 templates.
    expect(byKey.welcome_series.templates).toHaveLength(3);
    expect(byKey.welcome_series.steps(ids(byKey.welcome_series)).map((s: any) => s.type))
      .toEqual(["send_email", "wait", "send_email", "wait", "send_email"]);
    expect(byKey.welcome_series.steps(ids(byKey.welcome_series)).filter((s: any) => s.type === "wait").map((s: any) => s.minutes))
      .toEqual([1440, 2880]);
    // post_purchase_care: wait 60 → sms → wait 2880 → sms, no review link invented.
    expect(byKey.post_purchase_care.steps(ids(byKey.post_purchase_care)).map((s: any) => s.type))
      .toEqual(["wait", "send_sms", "wait", "send_sms"]);
    for (const t of byKey.post_purchase_care.templates) expect(t.body).not.toMatch(/https?:\/\//);
    // replenishment: 21d + 7d waits, sms then email slots, exitOnPurchase.
    expect(byKey.replenishment_reminder.exitOnPurchase).toBe(true);
    expect(byKey.replenishment_reminder.steps(ids(byKey.replenishment_reminder)).filter((s: any) => s.type === "wait").map((s: any) => s.minutes))
      .toEqual([30240, 10080]);
    expect(byKey.replenishment_reminder.descriptionBn).toContain("হিসাব করা নয়");
    // win_back: schedule-style condition + exitOnPurchase.
    expect(byKey.win_back.journeyConditions).toEqual([{ field: "inactiveDays", op: "gte", value: 60 }]);
    expect(byKey.win_back.exitOnPurchase).toBe(true);
    // anniversary: one email step, no exit, description names createdAt honestly.
    expect(byKey.anniversary.exitOnPurchase).toBe(false);
    expect(byKey.anniversary.steps(ids(byKey.anniversary))).toHaveLength(1);
    expect(byKey.anniversary.descriptionBn).toContain("createdAt");
  });

  it("unavailable contains birthday with the no-DOB reason; birthday is NOT installable anywhere", () => {
    const b = build();
    const un = b.svc.listUnavailableJourneyPresets();
    expect(un.map((u: any) => u.key)).toContain("birthday");
    const birthday = un.find((u: any) => u.key === "birthday")!;
    expect(birthday.reasonBn).toContain("জন্মতারিখ");
    expect(UNAVAILABLE_JOURNEY_PRESETS.map((u) => u.key)).toContain("birthday");
    expect(b.svc.listJourneyPresets().map((p: any) => p.key)).not.toContain("birthday");
  });
});

describe("MX5 listing", () => {
  it("includes both catalogues with version markers + v2 stepsCount/templates", () => {
    const b = build();
    const list = b.svc.listJourneyPresets() as any[];
    const v1 = list.filter((p: any) => p.version === 1);
    const v2 = list.filter((p: any) => p.version === 2);
    expect(v1.map((p: any) => p.key)).toEqual(JOURNEY_PRESETS.map((p) => p.key));
    expect(v2.map((p: any) => p.key)).toEqual(JOURNEY_PRESETS_V2.map((p) => p.key));
    const welcome = v2.find((p: any) => p.key === "welcome_series")!;
    expect(welcome.stepsCount).toBe(5);
    expect(welcome.templates).toHaveLength(3);
    const winback = v2.find((p: any) => p.key === "win_back")!;
    expect(winback.exitOnPurchase).toBe(true);
  });
});

describe("MX5 v2 install through the port", () => {
  it("welcome_series: creates 3 templates + ONE workflow with journey meta, disabled, audited", async () => {
    const b = build();
    const res: any = await b.svc.installJourneyPreset("org-1", "owner", "welcome_series");
    expect(res.enabled).toBe(false);
    expect(res.templates).toHaveLength(3);
    expect(b.templateRows).toHaveLength(3);
    expect(b.creates).toHaveLength(1);
    const dto = b.creates[0].dto;
    expect(dto.trigger).toBe("lead_created");
    expect(dto.journey).toEqual({ origin: "messaging", preset: "welcome_series", exitOnPurchase: false });
    // Steps reference the CREATED template ids, in slot order.
    const createdIds = b.templateRows.map((t) => t.id);
    expect(dto.steps.filter((s: any) => s.templateId).map((s: any) => s.templateId)).toEqual(createdIds);
    expect(dto.conditions).toBeUndefined();
    expect(b.updates).toEqual([{ orgId: "org-1", workflowId: res.workflow.id, dto: { enabled: false } }]);
    expect(res.workflow.enabled).toBe(false);
    const audit = b.auditCalls.find((c) => c.action === "messaging.journey_preset_install");
    expect(audit.metadata).toMatchObject({ preset: "welcome_series", version: 2 });
    expect(audit.metadata.templateIds).toEqual(createdIds);
    // MS8 response shape kept + extended.
    expect(res.template.id).toBe(createdIds[0]);
  });

  it("win_back: conditions ride the create; replenishment/anniversary exit flags differ honestly", async () => {
    const b = build();
    await b.svc.installJourneyPreset("org-1", "owner", "win_back");
    expect(b.creates[0].dto.conditions).toEqual([{ field: "inactiveDays", op: "gte", value: 60 }]);
    expect(b.creates[0].dto.journey).toEqual({ origin: "messaging", preset: "win_back", exitOnPurchase: true });
    expect(b.templateRows.map((t) => t.channel)).toEqual(["email", "sms"]);

    const b2 = build();
    await b2.svc.installJourneyPreset("org-1", "owner", "replenishment_reminder");
    expect(b2.creates[0].dto.journey.exitOnPurchase).toBe(true);
    expect(b2.templateRows.map((t) => t.channel)).toEqual(["sms", "email"]);

    const b3 = build();
    await b3.svc.installJourneyPreset("org-1", "owner", "anniversary");
    expect(b3.creates[0].dto.journey.exitOnPurchase).toBe(false);
    expect(b3.templateRows).toHaveLength(1);
  });

  it("refuses honestly: unknown key → 404 (even v2-shaped), known v2 key without engine → engine error", async () => {
    const b = build();
    await expect(b.svc.installJourneyPreset("org-1", "owner", "birthday")).rejects.toThrow("Journey preset not found");
    const noPort = build(false);
    await expect(noPort.svc.installJourneyPreset("org-1", "owner", "welcome_series")).rejects.toThrow("Workflow engine is not available");
    await expect(noPort.svc.installJourneyPreset("org-1", "owner", "nope")).rejects.toThrow("Journey preset not found");
  });
});

describe("MX5 MS8 parity", () => {
  it("an MS8 install hands the engine exactly the MS8 steps/trigger/name (journey meta is the one documented addition)", async () => {
    const b = build();
    const preset = JOURNEY_PRESETS.find((p) => p.key === "post_purchase_thanks")!;
    const res: any = await b.svc.installJourneyPreset("org-1", "owner", "post_purchase_thanks");
    expect(b.templateRows).toHaveLength(1);
    expect(b.creates).toHaveLength(1);
    const dto = b.creates[0].dto;
    expect(dto.name).toBe(preset.name);
    expect(dto.trigger).toBe(preset.trigger);
    expect(dto.conditions).toBeUndefined();
    expect(dto.steps).toEqual(preset.steps(b.templateRows[0].id));
    expect(dto.journey).toEqual({ origin: "messaging", preset: "post_purchase_thanks" });
    expect(res.template.id).toBe(b.templateRows[0].id);
    expect(res.enabled).toBe(false);
    expect(b.auditCalls.find((c) => c.action === "messaging.journey_preset_install").metadata)
      .toEqual({ preset: "post_purchase_thanks", templateId: b.templateRows[0].id });
  });

  it("EVERY MS8 preset's installed steps deep-equal its definition", async () => {
    const b = build();
    for (const preset of JOURNEY_PRESETS) {
      const before = b.templateRows.length;
      await b.svc.installJourneyPreset("org-1", "owner", preset.key);
      const dto = b.creates[b.creates.length - 1].dto;
      expect(dto.trigger).toBe(preset.trigger);
      expect(dto.steps).toEqual(preset.steps(b.templateRows[before].id));
    }
    expect(b.creates).toHaveLength(JOURNEY_PRESETS.length);
  });
});
