import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ReviewsService, parseReviewRating } from "./reviews.service";
import { ProactiveService } from "../ai/proactive.service";
import { JOB_TEMPLATES, JOB_TYPES } from "../automation/automation.service";

/**
 * CX12b — Auto Review Request (+ owner report email copy).
 * All customer sends are proven ONLY via fake providers at the
 * send seams — no real chat/SMS/email is claimed anywhere here.
 */
const ORG = "org-1";

function makeReviews(opts: { enabled?: boolean; delayHours?: number; smsConfigured?: boolean; emailConfigured?: boolean } = {}) {
  const reviews: any[] = [];
  const orders: any[] = [
    { id: "ord-1", organizationId: ORG, customerId: "cus-1", conversationId: "conv-1", externalNumber: "1042", customer: { phone: "01711111111", email: "rahim@example.com" } },
    { id: "ord-2", organizationId: ORG, customerId: "cus-1", conversationId: null, externalNumber: "1043", customer: { phone: "01711111111", email: null } },
    { id: "ord-3", organizationId: ORG, customerId: null, conversationId: null, externalNumber: "1044", customer: null },
    { id: "ord-x", organizationId: "org-2", customerId: "cus-9", conversationId: null, externalNumber: "9001", customer: null },
  ];
  const setting = { organizationId: ORG, reviewRequestEnabled: opts.enabled ?? true, reviewRequestDelayHours: opts.delayHours ?? 24 };
  const prisma = {
    inboxSetting: { findUnique: async ({ where }: any) => (where.organizationId === ORG ? setting : null) },
    order: {
      findFirst: async ({ where }: any) => orders.find((o) => o.id === where.id && o.organizationId === where.organizationId) ?? null,
      findMany: async ({ where }: any) => orders.filter((o) => o.organizationId === where.organizationId && (!where.id?.in || where.id.in.includes(o.id))),
    },
    customer: { findMany: async () => [{ id: "cus-1", firstName: "Rahim", lastName: "Uddin" }] },
    organization: { findFirst: async () => ({ id: ORG, name: "Legal Ltd", brandName: "Meghna Attire", logoUrl: null, primaryColor: null }) },
    orderReview: {
      create: async ({ data }: any) => {
        if (reviews.some((r) => r.orderId === data.orderId)) throw new Error("P2002 unique orderId");
        if (reviews.some((r) => r.reviewToken === data.reviewToken)) throw new Error("P2002 unique token");
        const row = { id: `rev-${reviews.length + 1}`, rating: null, comment: null, source: null, requestedAt: null, receivedAt: null, createdAt: new Date(), ...data };
        reviews.push(row);
        return row;
      },
      findFirst: async ({ where, orderBy }: any) => {
        let rows = reviews.filter((r) =>
          (where.organizationId === undefined || r.organizationId === where.organizationId) &&
          (where.reviewToken === undefined || r.reviewToken === where.reviewToken) &&
          (where.conversationId === undefined || r.conversationId === where.conversationId) &&
          (where.status === undefined || (where.status.in ? where.status.in.includes(r.status) : r.status === where.status)));
        if (orderBy?.requestedAt === "desc") rows = rows.sort((a, b) => new Date(b.requestedAt ?? 0).getTime() - new Date(a.requestedAt ?? 0).getTime());
        return rows[0] ?? null;
      },
      findMany: async ({ where }: any) => reviews.filter((r) =>
        r.organizationId === where.organizationId &&
        (where.status === undefined || r.status === where.status) &&
        (where.rating === undefined || r.rating === where.rating) &&
        (where.customerId === undefined || r.customerId === where.customerId) &&
        (where.deliveredAt?.lte === undefined || new Date(r.deliveredAt).getTime() <= new Date(where.deliveredAt.lte).getTime())),
      update: async ({ where, data }: any) => { const r = reviews.find((x) => x.id === where.id)!; Object.assign(r, data); return r; },
    },
  };
  const handlers: Record<string, (p: any) => void> = {};
  const events = { on: (ev: string, fn: any) => { handlers[ev] = fn; } };
  const smsCalls: any[] = [];
  const sms = { isConfigured: () => opts.smsConfigured ?? true, send: async (i: any) => { smsCalls.push(i); return { providerMessageId: "s1" }; } };
  const emailCalls: any[] = [];
  const email = { isConfigured: () => opts.emailConfigured ?? true, send: async (i: any) => { emailCalls.push(i); return { providerMessageId: "e1" }; } };
  const svc = new ReviewsService(prisma as any, events as any, sms as any, email as any, { log: async () => undefined } as any);
  const chatCalls: any[] = [];
  const sender = { sendAutomatedMessage: async (...a: any[]) => { chatCalls.push(a); return { id: "m1" }; } };
  return { svc, reviews, handlers, smsCalls, emailCalls, chatCalls, sender, setting };
}

describe("CX12b parser (tiny + honest)", () => {
  it("accepts ONLY a standalone 1-5 / ১-৫", () => {
    expect(parseReviewRating("5")).toBe(5);
    expect(parseReviewRating("৫")).toBe(5);
    expect(parseReviewRating("১")).toBe(1);
    expect(parseReviewRating(" 4 ")).toBe(4);
    expect(parseReviewRating("55")).toBeNull();
    expect(parseReviewRating("5 star")).toBeNull();
    expect(parseReviewRating("৫/৫")).toBeNull();
    expect(parseReviewRating("ভালো")).toBeNull();
    expect(parseReviewRating("0")).toBeNull();
    expect(parseReviewRating("6")).toBeNull();
    expect(parseReviewRating("")).toBeNull();
  });
});

describe("CX12b delivery trigger", () => {
  it("disabled by default: no rows are created", async () => {
    const { svc, reviews } = makeReviews({ enabled: false });
    await svc.noteDelivered(ORG, "ord-1");
    expect(reviews.length).toBe(0);
  });

  it("creates ONE pending_send row; double-delivery events do not duplicate (unique guard)", async () => {
    const { svc, reviews, handlers } = makeReviews();
    handlers["order.delivered"]({ organizationId: ORG, context: { orderId: "ord-1" } });
    handlers["order.delivered"]({ organizationId: ORG, context: { orderId: "ord-1" } });
    handlers["shipment.status_changed"]({ organizationId: ORG, context: { orderId: "ord-1", shipmentStatus: "delivered" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(reviews.length).toBe(1);
    expect(reviews[0].status).toBe("pending_send");
    expect(reviews[0].reviewToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(reviews[0].customerId).toBe("cus-1");
    expect(reviews[0].deliveredAt).toBeInstanceOf(Date);
  });

  it("shipment in_transit creates nothing; another org's order creates nothing", async () => {
    const { svc, reviews, handlers } = makeReviews();
    handlers["shipment.status_changed"]({ organizationId: ORG, context: { orderId: "ord-1", shipmentStatus: "in_transit" } });
    await svc.noteDelivered(ORG, "ord-x");
    await new Promise((r) => setTimeout(r, 20));
    expect(reviews.length).toBe(0);
  });
});

describe("CX12b sweep", () => {
  it("skips when disabled; sends the chat ask when due; not-yet-due rows wait", async () => {
    const off = makeReviews({ enabled: false });
    expect((await off.svc.runReviewSweep(ORG, off.sender)).skipped).toBe("review_requests_disabled");

    const { svc, reviews, chatCalls, sender } = makeReviews();
    await svc.noteDelivered(ORG, "ord-1");
    // just delivered — 24h delay not yet passed
    let out = await svc.runReviewSweep(ORG, sender);
    expect(out.checked).toBe(0);
    // age the delivery past the delay
    reviews[0].deliveredAt = new Date(Date.now() - 25 * 3600 * 1000);
    out = await svc.runReviewSweep(ORG, sender);
    expect(out).toEqual({ checked: 1, sent: 1, stillPending: 0, failed: 0 });
    expect(chatCalls.length).toBe(1);
    expect(chatCalls[0][1]).toBe("conv-1");
    expect(chatCalls[0][2]).toContain("১–৫");
    expect(chatCalls[0][2]).toContain(`/review/${reviews[0].reviewToken}`);
    expect(chatCalls[0][3]).toBe("review_request");
    expect(reviews[0].status).toBe("requested");
    expect(reviews[0].source).toBe("chat");
    // a second sweep sends nothing again (dedupe by status)
    out = await svc.runReviewSweep(ORG, sender);
    expect(out.checked).toBe(0);
    expect(chatCalls.length).toBe(1);
  });

  it("no conversation -> SMS carries the review link (source link)", async () => {
    const { svc, reviews, smsCalls, sender } = makeReviews();
    await svc.noteDelivered(ORG, "ord-2");
    reviews[0].deliveredAt = new Date(Date.now() - 25 * 3600 * 1000);
    const out = await svc.runReviewSweep(ORG, sender);
    expect(out.sent).toBe(1);
    expect(smsCalls.length).toBe(1);
    expect(smsCalls[0].to).toBe("8801711111111");
    expect(smsCalls[0].text).toContain(`/review/${reviews[0].reviewToken}`);
    expect(reviews[0].source).toBe("link");
    expect(reviews[0].status).toBe("requested");
  });

  it("no channel at all -> row stays pending_send, counted honestly, never marked sent", async () => {
    const { svc, reviews, sender } = makeReviews({ smsConfigured: false, emailConfigured: false });
    await svc.noteDelivered(ORG, "ord-3"); // no conversation, no customer phone/email
    reviews[0].deliveredAt = new Date(Date.now() - 25 * 3600 * 1000);
    const out = await svc.runReviewSweep(ORG, sender);
    expect(out).toEqual({ checked: 1, sent: 0, stillPending: 1, failed: 0 });
    expect(reviews[0].status).toBe("pending_send");
    expect(reviews[0].requestedAt).toBeNull();
  });
});

describe("CX12b chat capture", () => {
  async function requestedRow() {
    const ctx = makeReviews();
    await ctx.svc.noteDelivered(ORG, "ord-1");
    ctx.reviews[0].deliveredAt = new Date(Date.now() - 25 * 3600 * 1000);
    await ctx.svc.runReviewSweep(ORG, ctx.sender);
    return ctx;
  }
  const conv = { id: "conv-1" };

  it("a standalone Bengali digit is the rating; the follow-up text is the comment", async () => {
    const { svc, reviews } = await requestedRow();
    expect(await svc.tryCaptureReply(ORG, conv, "৫")).toBe(true);
    expect(reviews[0].rating).toBe(5);
    expect(reviews[0].status).toBe("received");
    expect(reviews[0].source).toBe("chat");
    expect(await svc.tryCaptureReply(ORG, conv, "খুব ভালো সার্ভিস, ধন্যবাদ!")).toBe(true);
    expect(reviews[0].comment).toBe("খুব ভালো সার্ভিস, ধন্যবাদ!");
    // after the comment, everything flows normally again
    expect(await svc.tryCaptureReply(ORG, conv, "আরেকটা অর্ডার করতে চাই")).toBe(false);
  });

  it("normal text before any rating is untouched; '5 star' is not a rating; a second digit never overwrites", async () => {
    const { svc, reviews } = await requestedRow();
    expect(await svc.tryCaptureReply(ORG, conv, "আপনাদের সার্ভিস কেমন?")).toBe(false);
    expect(await svc.tryCaptureReply(ORG, conv, "5 star")).toBe(false);
    expect(reviews[0].rating).toBeNull();
    expect(await svc.tryCaptureReply(ORG, conv, "4")).toBe(true);
    expect(await svc.tryCaptureReply(ORG, conv, "2")).toBe(false);
    expect(reviews[0].rating).toBe(4);
  });

  it("outside the 7-day window a digit is ignored; a comment 25h after the rating is ignored", async () => {
    const { svc, reviews } = await requestedRow();
    reviews[0].requestedAt = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    expect(await svc.tryCaptureReply(ORG, conv, "5")).toBe(false);
    expect(reviews[0].rating).toBeNull();

    const ctx2 = await requestedRow();
    expect(await ctx2.svc.tryCaptureReply(ORG, conv, "5")).toBe(true);
    ctx2.reviews[0].receivedAt = new Date(Date.now() - 25 * 3600 * 1000);
    expect(await ctx2.svc.tryCaptureReply(ORG, conv, "দেরিতে মন্তব্য")).toBe(false);
    expect(ctx2.reviews[0].comment).toBeNull();
  });
});

describe("CX12b public link page", () => {
  it("submit stores rating + comment (source link); a second submit is refused; bad input 400s; unknown token 404s", async () => {
    const { svc, reviews } = makeReviews();
    await svc.noteDelivered(ORG, "ord-2");
    const token = reviews[0].reviewToken;
    const page: any = await svc.publicReview(token);
    expect(page.branding.name).toBe("Meghna Attire");
    expect(page.rating).toBeNull();
    const out = await svc.submitPublicReview(token, { rating: 4, comment: "মোটামুটি ভালো" });
    expect(out).toEqual({ ok: true, rating: 4, status: "received" });
    expect(reviews[0].source).toBe("link");
    await expect(svc.submitPublicReview(token, { rating: 5 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.submitPublicReview(token, { rating: 9 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.publicReview("nope")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.submitPublicReview("nope", { rating: 3 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("listReviews is org-scoped, filterable, and resolves order/customer labels", async () => {
    const { svc, reviews } = makeReviews();
    await svc.noteDelivered(ORG, "ord-1");
    await svc.submitPublicReview(reviews[0].reviewToken, { rating: 5, comment: "দারুণ" });
    const all = await svc.listReviews(ORG);
    expect(all.length).toBe(1);
    expect(all[0].orderNumber).toBe("1042");
    expect(all[0].customerName).toBe("Rahim Uddin");
    expect((await svc.listReviews(ORG, { rating: 5 })).length).toBe(1);
    expect((await svc.listReviews(ORG, { rating: 1 })).length).toBe(0);
    expect((await svc.listReviews("org-2")).length).toBe(0);
  });
});

describe("CX12b job registration", () => {
  it("review_request_sweep is a creatable type with an org template (60 min)", () => {
    expect(JOB_TYPES).toContain("review_request_sweep");
    const tpl = JOB_TEMPLATES.find((t) => t.type === "review_request_sweep");
    expect(tpl?.targetKind).toBe("org");
    expect(tpl?.intervalMinutes).toBe(60);
  });
});

describe("CX12b (12e) daily report email copy", () => {
  function makeProactive(emailEnabled: boolean, smtpConfigured: boolean) {
    const notifications: any[] = [];
    const prisma = {
      aIProactiveSetting: { findUnique: async () => ({ briefingEnabled: true, anomalyAlertsEnabled: true, dailyReportEmailEnabled: emailEnabled }) },
      membership: { findMany: async () => [{ userId: "u-owner" }, { userId: "u-owner" }] },
      agentNotification: {
        findMany: async () => [],
        create: async ({ data }: any) => { notifications.push(data); return data; },
      },
      user: { findMany: async () => [{ id: "u-owner", email: "owner@example.com" }] },
    };
    const tools = {
      execute: async () => ({ orders: 3, revenue: "৳ ৩,০০০", adSpend: "৳ ৫০০", contributionProfit: "৳ ৯০০", contributionMarginPercent: 30, cogsCoveragePercent: 100 }),
      getAnomalies: async () => ({ anomalies: [] }),
    };
    const emailCalls: any[] = [];
    const email = { isConfigured: () => smtpConfigured, send: async (i: any) => { emailCalls.push(i); return { providerMessageId: "e1" }; } };
    const svc = new ProactiveService(prisma as any, { log: async () => undefined } as any, tools as any, email as any);
    return { svc, notifications, emailCalls };
  }

  it("opt-in + SMTP configured -> one email copy per owner; in-app briefing still primary", async () => {
    const { svc, notifications, emailCalls } = makeProactive(true, true);
    const out: any = await svc.runDailyBriefing(ORG, "actor");
    expect(out.briefings).toBe(1);
    expect(notifications.length).toBe(1);
    expect(out.emailsSent).toBe(1);
    expect(emailCalls.length).toBe(1);
    expect(emailCalls[0].to).toBe("owner@example.com");
    expect(emailCalls[0].subject).toContain("দৈনিক ব্রিফিং");
  });

  it("SMTP unconfigured -> copy skipped silently, in-app briefing still created", async () => {
    const { svc, notifications, emailCalls } = makeProactive(true, false);
    const out: any = await svc.runDailyBriefing(ORG, "actor");
    expect(out.briefings).toBe(1);
    expect(notifications.length).toBe(1);
    expect(out.emailsSent).toBe(0);
    expect(emailCalls.length).toBe(0);
  });

  it("setting OFF (default) -> no email even with SMTP configured", async () => {
    const { svc, emailCalls } = makeProactive(false, true);
    const out: any = await svc.runDailyBriefing(ORG, "actor");
    expect(out.briefings).toBe(1);
    expect(out.emailsSent).toBe(0);
    expect(emailCalls.length).toBe(0);
  });
});
