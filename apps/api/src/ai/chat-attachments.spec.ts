import { processChatAttachment, ATTACHMENT_TEXT_CAP } from "./chat-attachments";

const okVision = {
  analyzeImage: async () => ({ available: true as const, text: "ছবিতে একটি লাল পাঞ্জাবি, দাম ১,৫০০ টাকা লেখা আছে।", provider: "fake", model: "m" }),
};
const noVision = {
  analyzeImage: async () => ({ available: false as const, reason: "No real AI (LLM) provider is configured — the dev-template adapter cannot read images." }),
};

describe("processChatAttachment (AP2)", () => {
  it("extracts a .txt document", async () => {
    const out = await processChatAttachment("org1", "u1", { originalname: "notes.txt", buffer: Buffer.from("ডেলিভারি চার্জ ঢাকায় ৬০ টাকা।") }, okVision);
    expect(out.kind).toBe("file");
    expect(out.text).toContain("ডেলিভারি চার্জ");
    expect(out.truncated).toBe(false);
  });

  it("decodes CSV as text", async () => {
    const out = await processChatAttachment("org1", "u1", { originalname: "sales.csv", buffer: Buffer.from("date,total\n2026-10-01,5000") }, okVision);
    expect(out.text).toContain("2026-10-01");
  });

  it("rejects unsupported types with the extractor's honest error", async () => {
    await expect(processChatAttachment("org1", "u1", { originalname: "app.exe", buffer: Buffer.from("MZ") }, okVision)).rejects.toThrow();
  });

  it("an image becomes its vision description", async () => {
    const out = await processChatAttachment("org1", "u1", { originalname: "product.png", buffer: Buffer.from([0x89, 0x50]) }, okVision);
    expect(out.kind).toBe("image");
    expect(out.text).toContain("পাঞ্জাবি");
  });

  it("vision unavailable → attach fails with the verbatim reason, nothing faked", async () => {
    await expect(processChatAttachment("org1", "u1", { originalname: "product.png", buffer: Buffer.from([0x89]) }, noVision))
      .rejects.toThrow(/dev-template adapter cannot read images/);
  });

  it("caps long documents at 12,000 chars and flags truncation", async () => {
    const out = await processChatAttachment("org1", "u1", { originalname: "big.txt", buffer: Buffer.from("ক".repeat(15_000)) }, okVision);
    expect(out.text.length).toBe(ATTACHMENT_TEXT_CAP);
    expect(out.truncated).toBe(true);
  });

  it("empty file → 400", async () => {
    await expect(processChatAttachment("org1", "u1", { originalname: "x.txt", buffer: Buffer.alloc(0) }, okVision)).rejects.toThrow(/খালি/);
  });
});
