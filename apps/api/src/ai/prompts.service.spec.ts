import { PromptsService, SAVED_PROMPT_CAP } from "./prompts.service";

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  const matches = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let out = rows.filter((r) => matches(r, where));
      if (orderBy?.updatedAt === "desc") out = [...out].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return take ? out.slice(0, take) : out;
    },
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: any) => { const row = { id: `p-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data, { updatedAt: new Date(Date.now() + 10) }); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); const [row] = rows.splice(i, 1); return row; },
  };
}

function makeService() {
  const table = makeTable();
  const prisma = { aiSavedPrompt: table } as any;
  return { svc: new PromptsService(prisma), table };
}

describe("PromptsService (GV3/G4)", () => {
  it("creates and lists prompts scoped to the owner", async () => {
    const { svc } = makeService();
    const a = await svc.create("org-1", "user-1", { title: "সাপ্তাহিক বিক্রি", body: "গত ৭ দিনে বিক্রি কেমন ছিল?" });
    await svc.create("org-1", "user-2", { title: "অন্যের", body: "secret" });
    await svc.create("org-2", "user-1", { title: "অন্য org", body: "secret" });
    const mine = await svc.list("org-1", "user-1");
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(a.id);
    expect(mine[0].title).toBe("সাপ্তাহিক বিক্রি");
  });

  it("rejects empty title/body", async () => {
    const { svc } = makeService();
    await expect(svc.create("org-1", "user-1", { title: "  ", body: "x" })).rejects.toThrow();
    await expect(svc.create("org-1", "user-1", { title: "x", body: "" })).rejects.toThrow();
  });

  it("enforces the per-user cap of 50", async () => {
    const { svc } = makeService();
    for (let i = 0; i < SAVED_PROMPT_CAP; i++) {
      await svc.create("org-1", "user-1", { title: `t${i}`, body: `b${i}` });
    }
    await expect(svc.create("org-1", "user-1", { title: "one-more", body: "b" })).rejects.toThrow(/50/);
    // A different user is unaffected by the first user's cap.
    await expect(svc.create("org-1", "user-2", { title: "ok", body: "b" })).resolves.toBeTruthy();
  });

  it("updates and deletes only the owner's rows — foreign ids are 404", async () => {
    const { svc } = makeService();
    const mine = await svc.create("org-1", "user-1", { title: "আগের", body: "body" });
    const updated = await svc.update("org-1", "user-1", mine.id, { title: "নতুন" });
    expect(updated.title).toBe("নতুন");
    await expect(svc.update("org-1", "user-2", mine.id, { title: "হ্যাক" })).rejects.toMatchObject({ code: "ai.promptNotFound" });
    await expect(svc.remove("org-1", "user-2", mine.id)).rejects.toMatchObject({ code: "ai.promptNotFound" });
    await expect(svc.remove("org-1", "user-1", mine.id)).resolves.toEqual({ deleted: true });
    expect(await svc.list("org-1", "user-1")).toHaveLength(0);
  });

  it("update rejects empty values", async () => {
    const { svc } = makeService();
    const mine = await svc.create("org-1", "user-1", { title: "t", body: "b" });
    await expect(svc.update("org-1", "user-1", mine.id, { body: "   " })).rejects.toThrow();
  });
});
