import "reflect-metadata";
import { MessagingService } from "./messaging.service";
import { applyTemplateVariant, validateTemplateVariants } from "./template-variants";

/**
 * MB5 (ML14, CD-3) — MessageTemplate per-locale variants:
 * shape validation (pure), variant-if-exists application
 * (pure), and the template CRUD round-trip through the real
 * MessagingService on a fake-prisma harness.
 */

describe("MB5 validateTemplateVariants (pure)", () => {
  it("accepts null/undefined (no variants) and well-formed shapes", () => {
    expect(validateTemplateVariants(null)).toBeNull();
    expect(validateTemplateVariants(undefined)).toBeNull();
    expect(validateTemplateVariants({ bn: { body: "বাংলা" }, en: { subject: "Hi", body: null, htmlBody: "<p>x</p>" } }))
      .toEqual({ bn: { body: "বাংলা" }, en: { subject: "Hi", body: null, htmlBody: "<p>x</p>" } });
    expect(validateTemplateVariants({})).toEqual({});
  });

  it("rejects unknown locale keys, unknown fields, non-strings and empty strings", () => {
    expect(() => validateTemplateVariants({ fr: { body: "x" } })).toThrow(/unknown locale/);
    expect(() => validateTemplateVariants({ bn: { footer: "x" } })).toThrow(/unknown field/);
    expect(() => validateTemplateVariants({ bn: { body: 42 } })).toThrow(/non-empty string or null/);
    expect(() => validateTemplateVariants({ bn: { body: "   " } })).toThrow(/non-empty string or null/);
    expect(() => validateTemplateVariants(["bn"])).toThrow(/keyed by locale/);
    expect(() => validateTemplateVariants({ bn: "বাংলা" })).toThrow(/must be an object/);
  });
});

describe("MB5 applyTemplateVariant (pure, variant-if-exists)", () => {
  const authored = { subject: "Authored subject", body: "Authored body", htmlBody: "<p>Authored</p>", variants: null as any };

  it("no variants → authored fields verbatim (pre-MB5 behaviour)", () => {
    expect(applyTemplateVariant(authored, "en")).toEqual({
      subject: "Authored subject", body: "Authored body", htmlBody: "<p>Authored</p>",
    });
    expect(applyTemplateVariant({ ...authored, variants: undefined }, "bn").body).toBe("Authored body");
  });

  it("a present non-empty variant field replaces ONLY that field, only in its locale", () => {
    const tpl = { ...authored, variants: { en: { body: "English body" }, bn: { subject: "বাংলা বিষয়", body: "বাংলা বডি", htmlBody: null } } };
    expect(applyTemplateVariant(tpl, "en")).toEqual({
      subject: "Authored subject", body: "English body", htmlBody: "<p>Authored</p>",
    });
    expect(applyTemplateVariant(tpl, "bn")).toEqual({
      subject: "বাংলা বিষয়", body: "বাংলা বডি", htmlBody: "<p>Authored</p>",
    });
  });

  it("empty/garbage stored variants never replace authored text and never throw", () => {
    expect(applyTemplateVariant({ ...authored, variants: { en: { body: "  " } } }, "en").body).toBe("Authored body");
    expect(applyTemplateVariant({ ...authored, variants: "junk" }, "en").body).toBe("Authored body");
    expect(applyTemplateVariant({ ...authored, variants: { en: 42 } }, "en").body).toBe("Authored body");
  });
});

// ---------- CRUD through the real service ----------

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => v === undefined || r[k] === v)),
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      return rows.splice(idx, 1)[0];
    },
  };
}

function buildService() {
  const tables: any = {
    messageTemplate: makeTable("tpl"),
    messageTemplateVersion: makeTable("tplv"),
  };
  const svc = new MessagingService(
    tables as any,
    { log: async () => undefined } as any,
    { isConfigured: () => true, send: async () => ({ providerMessageId: "e1" }) } as any,
    { isConfigured: () => true, send: async () => ({ providerMessageId: "s1" }) } as any,
  );
  return { svc, tables };
}

describe("MB5 template CRUD variants (MessagingService)", () => {
  it("create stores variants; get/list return them; a template without variants returns none", async () => {
    const { svc } = buildService();
    const created: any = await svc.createTemplate("org-1", "u1", {
      name: "Welcome", channel: "email", subject: "Hello", body: "Authored body",
      variants: { en: { subject: "Hello EN", body: "English body" }, bn: { body: "বাংলা বডি" } },
    });
    expect(created.variants).toEqual({ en: { subject: "Hello EN", body: "English body" }, bn: { body: "বাংলা বডি" } });
    const got: any = await svc.getTemplate("org-1", created.id);
    expect(got.variants).toEqual(created.variants);
    const list: any[] = await svc.listTemplates("org-1");
    expect(list[0].variants).toEqual(created.variants);

    const plain: any = await svc.createTemplate("org-1", "u1", { name: "Plain", channel: "sms", body: "SMS body" });
    expect(plain.variants ?? null).toBeNull();
  });

  it("create rejects malformed variants with the catalogued 400 (code messaging.templateVariantsInvalid)", async () => {
    const { svc } = buildService();
    for (const bad of [{ fr: { body: "x" } }, { bn: { body: "" } }, { bn: { body: 7 } }, ["bn"]]) {
      await expect(svc.createTemplate("org-1", "u1", {
        name: "Bad", channel: "email", subject: "S", body: "B", variants: bad,
      })).rejects.toMatchObject({ status: 400, code: "messaging.templateVariantsInvalid" });
    }
  });

  it("update replaces variants, explicit null clears them, malformed update 400s and changes nothing", async () => {
    const { svc } = buildService();
    const created: any = await svc.createTemplate("org-1", "u1", {
      name: "T", channel: "email", subject: "S", body: "B",
      variants: { bn: { body: "বাংলা" } },
    });
    const updated: any = await svc.updateTemplate("org-1", created.id, {
      variants: { en: { subject: "EN subject", body: "EN body", htmlBody: "<p>EN</p>" } },
    });
    expect(updated.variants).toEqual({ en: { subject: "EN subject", body: "EN body", htmlBody: "<p>EN</p>" } });

    await expect(svc.updateTemplate("org-1", created.id, { variants: { bn: { nope: "x" } } }))
      .rejects.toMatchObject({ status: 400, code: "messaging.templateVariantsInvalid" });
    const after: any = await svc.getTemplate("org-1", created.id);
    expect(after.variants).toEqual({ en: { subject: "EN subject", body: "EN body", htmlBody: "<p>EN</p>" } });

    const cleared: any = await svc.updateTemplate("org-1", created.id, { variants: null });
    expect(cleared.variants).toBeNull();
  });
});
