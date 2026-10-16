import "reflect-metadata";
import { EmailProvider } from "../messaging/email.provider";

/**
 * GB8 (GC19) — the EmailProvider attachment verdict, pinned:
 * the provider's send() historically exposed NO attachment
 * parameter (the nodemailer transport underneath always
 * supported them). GB8 added an OPTIONAL pass-through. These
 * tests prove (a) an attachment reaches the transport intact,
 * (b) a send without attachments produces the exact pre-GB8
 * mail shape, and (c) "sent" still requires a message id.
 */
describe("GB8 EmailProvider attachments", () => {
  const OLD_ENV = { ...process.env };
  beforeAll(() => {
    process.env.SMTP_HOST = "smtp.invalid";
    process.env.SMTP_FROM = "reports@example.com";
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  function providerCapturing() {
    const sent: any[] = [];
    const transport = {
      sendMail: async (mail: any) => {
        sent.push(mail);
        return { messageId: "<gb8@test>" };
      },
    };
    return { provider: new EmailProvider(transport), sent };
  }

  it("passes attachments through to the transport", async () => {
    const { provider, sent } = providerCapturing();
    const out = await provider.send({
      to: "owner@example.com",
      subject: "রিপোর্ট",
      text: "summary",
      attachments: [{ filename: "discounts.csv", content: "a,b\n1,2\n", contentType: "text/csv; charset=utf-8" }],
    });
    expect(out.providerMessageId).toBe("<gb8@test>");
    expect(sent).toHaveLength(1);
    expect(sent[0].attachments).toEqual([
      { filename: "discounts.csv", content: "a,b\n1,2\n", contentType: "text/csv; charset=utf-8" },
    ]);
  });

  it("without attachments the mail shape is unchanged (no attachments key)", async () => {
    const { provider, sent } = providerCapturing();
    await provider.send({ to: "owner@example.com", subject: "hi", text: "body" });
    expect(sent).toHaveLength(1);
    expect("attachments" in sent[0]).toBe(false);
    expect(sent[0]).toMatchObject({ to: "owner@example.com", subject: "hi", text: "body" });
  });

  it("a send with no message id from the server still does NOT count as sent", async () => {
    const provider = new EmailProvider({ sendMail: async () => ({}) });
    await expect(
      provider.send({ to: "owner@example.com", subject: "hi", text: "body", attachments: [{ filename: "x.csv", content: "1" }] }),
    ).rejects.toThrow("NOT counted as sent");
  });
});
