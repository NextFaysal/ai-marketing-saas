import { BadRequestException } from "@nestjs/common";
import { WebhookDispatcher } from "../common/webhook-dispatch";
import { InternalJobsController } from "./internal-jobs.controller";

/**
 * Milestone 63: queued webhook processing. The dispatcher
 * falls back to inline (returns false) without Redis; the
 * internal re-entry point classifies failures as permanent
 * (422) vs transient (500) for BullMQ.
 */
describe("M63 webhook dispatcher", () => {
  const OLD = process.env.REDIS_URL;
  afterAll(() => { if (OLD === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = OLD; });

  it("without REDIS_URL enqueue declines (inline path)", async () => {
    delete process.env.REDIS_URL;
    const d = new WebhookDispatcher();
    await expect(d.enqueue({ source: "meta", integrationId: "i1", rawBody: "{}" })).resolves.toBe(false);
  });

  it("with a queue it enqueues with retries and reports success", async () => {
    const add = jest.fn(async (..._args: any[]) => ({}));
    const d = new WebhookDispatcher(async () => ({ add }));
    await expect(d.enqueue({ source: "telegram", integrationId: "i2", update: { message: { text: "hi" } } })).resolves.toBe(true);
    expect(add.mock.calls[0][0]).toBe("process");
    expect(add.mock.calls[0][1]).toMatchObject({ source: "telegram", integrationId: "i2" });
    expect(add.mock.calls[0][2].attempts).toBe(3);
    expect(add.mock.calls[0][2].jobId).toMatch(/^wh-/);
  });

  it("an oversized body is never queued (inline instead)", async () => {
    const add = jest.fn(async (..._args: any[]) => ({}));
    const d = new WebhookDispatcher(async () => ({ add }));
    const big = "x".repeat(1024 * 1024 + 1);
    await expect(d.enqueue({ source: "meta", integrationId: "i1", rawBody: big })).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
  });
});

describe("M63 internal webhook re-entry", () => {
  const OLD = process.env.INTERNAL_JOB_SECRET;
  beforeAll(() => { process.env.INTERNAL_JOB_SECRET = "topsecret"; });
  afterAll(() => { if (OLD === undefined) delete process.env.INTERNAL_JOB_SECRET; else process.env.INTERNAL_JOB_SECRET = OLD; });

  function controller(handlers: Record<string, any>) {
    return new InternalJobsController(
      {} as any,
      handlers.inbox, handlers.shopify, handlers.telegram, handlers.integrations,
    );
  }

  it("meta: delegates to handleWebhook with the raw body + signature", async () => {
    const inbox = { handleWebhook: jest.fn(async () => ({ stored: 1 })) };
    const ctrl = controller({ inbox });
    const out: any = await ctrl.processWebhook("topsecret", {
      source: "meta", integrationId: "i1", rawBody: "{}", headers: { signature: "sha256=z" },
    });
    expect(out).toMatchObject({ ok: true, stored: 1 });
    expect(inbox.handleWebhook).toHaveBeenCalledWith("i1", "{}", "sha256=z");
  });

  it("a signature failure is permanent (422), a generic failure transient (500)", async () => {
    const inbox = { handleWebhook: jest.fn(async () => { throw new Error("Invalid webhook signature"); }) };
    const ctrl = controller({ inbox });
    await expect(ctrl.processWebhook("topsecret", { source: "meta", integrationId: "i1", rawBody: "{}" }))
      .rejects.toMatchObject({ status: 422 });
    inbox.handleWebhook.mockRejectedValue(new Error("database unreachable"));
    await expect(ctrl.processWebhook("topsecret", { source: "meta", integrationId: "i1", rawBody: "{}" }))
      .rejects.toMatchObject({ status: 500 });
  });

  it("a handler 4xx (telegram bad secret) is also permanent — found live in M63", async () => {
    const telegram = { handleWebhook: jest.fn(async () => { throw new BadRequestException("Invalid webhook secret"); }) };
    const ctrl = controller({ telegram });
    await expect(ctrl.processWebhook("topsecret", { source: "telegram", integrationId: "i3", secret: "wrong", update: {} }))
      .rejects.toMatchObject({ status: 422 });
  });

  it("woocommerce: delegates by eventId; telegram by stored secret + update", async () => {
    const integrations = { processWooWebhookEvent: jest.fn(async () => ({ processed: true })) };
    const telegram = { handleWebhook: jest.fn(async () => ({ stored: true })) };
    const ctrl = controller({ integrations, telegram });
    await expect(ctrl.processWebhook("topsecret", { source: "woocommerce", integrationId: "i9", eventId: "ev-1" }))
      .resolves.toMatchObject({ ok: true, processed: true });
    expect(integrations.processWooWebhookEvent).toHaveBeenCalledWith("ev-1");
    await expect(ctrl.processWebhook("topsecret", { source: "telegram", integrationId: "i3", secret: "s3cr3t", update: { update_id: 5 } }))
      .resolves.toMatchObject({ ok: true, stored: true });
    expect(telegram.handleWebhook).toHaveBeenCalledWith("i3", "s3cr3t", { update_id: 5 });
  });

  it("the secret check still governs the webhook surface", async () => {
    const ctrl = controller({ inbox: { handleWebhook: jest.fn() } });
    await expect(ctrl.processWebhook("wrong", { source: "meta", integrationId: "i1" }))
      .rejects.toThrow(/Invalid internal secret/);
  });
});
