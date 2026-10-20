import { firstValueFrom, take, timeout } from "rxjs";
import { RealtimeService } from "./realtime.service";
import { WebchatService } from "./webchat.service";

/**
 * Milestone 66: the webchat visitor stream. A subscription is
 * bound to the conversation derived from the visitor's session
 * token; delivery carries a visitor-safe projection only.
 */
describe("M66 visitor stream delivery", () => {
  it("delivers message.created for the subscribed conversation, projected to visitor-safe fields", async () => {
    const rt = new RealtimeService();
    const stream = rt.streamVisitor("conv-A");
    const next = firstValueFrom(stream.pipe(take(1), timeout(3000)));
    rt.emit("org-1", {
      type: "message.created", conversationId: "conv-A",
      message: {
        id: "m1", direction: "out", content: "আসসালামু আলাইকুম", type: "text",
        createdAt: "2026-10-11T00:00:00.000Z",
        senderUserId: "agent-9", internalNote: "must never leak", mediaStorageKey: "s3/key",
      } as any,
    });
    const ev: any = await next;
    expect(ev.data.type).toBe("message.created");
    // The projection carries the visitor-safe fields (Inbox
    // Next-Gen P2 added a parsed `product` card field) — the
    // M66 guarantee is that INTERNAL fields never leak.
    expect(ev.data.message).toMatchObject({
      id: "m1", direction: "out", content: "আসসালামু আলাইকুম", type: "text",
      createdAt: "2026-10-11T00:00:00.000Z",
    });
    expect(ev.data.message.senderUserId).toBeUndefined();
    expect(ev.data.message.internalNote).toBeUndefined();
    expect(ev.data.message.mediaStorageKey).toBeUndefined();
  });

  it("another conversation's messages never reach this visitor", async () => {
    const rt = new RealtimeService();
    const received: any[] = [];
    const sub = rt.streamVisitor("conv-A").subscribe((e: any) => { if (e.data) received.push(e.data); });
    rt.emit("org-1", { type: "message.created", conversationId: "conv-B", message: { id: "mx", content: "secret" } as any });
    rt.emit("org-1", { type: "conversation.updated", conversationId: "conv-A", patch: { assignedUserId: "agent-9" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);
    sub.unsubscribe();
  });
});

describe("M66 streamFor token binding", () => {
  function service() {
    const { createHash } = require("crypto");
    const goodHash = createHash("sha256").update("good-token").digest("hex");
    const prisma: any = {
      widgetSite: { findFirst: jest.fn(async () => ({ id: "site-1", organizationId: "org-1", enabled: true })) },
      liveChatSession: {
        // Only the good token's SHA-256 resolves a session.
        findFirst: jest.fn(async ({ where }: any) =>
          where.visitorTokenHash === goodHash
            ? { id: "sess-1", conversationId: "conv-A", widgetSiteId: "site-1" }
            : null),
      },
    };
    const realtime = new RealtimeService();
    const svc = new WebchatService(prisma, { log: jest.fn() } as any, {} as any, realtime);
    return { svc, realtime };
  }

  it("a valid token opens a stream bound to ITS conversation", async () => {
    const { svc, realtime } = service();
    const stream = await svc.streamFor("wc_key", "good-token");
    expect(stream).toBeDefined();
    const sub = stream.subscribe(() => undefined);
    expect(realtime.visitorSubscriberCount("conv-A")).toBe(1);
    sub.unsubscribe();
    expect(realtime.visitorSubscriberCount("conv-A")).toBe(0);
  });

  it("an invalid token is refused before any stream exists", async () => {
    const { svc } = service();
    await expect(svc.streamFor("wc_key", "someone-elses-token")).rejects.toMatchObject({ code: "inbox.invalidChatSessionToken" });
  });
});
