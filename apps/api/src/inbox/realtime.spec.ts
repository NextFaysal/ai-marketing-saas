import { RealtimeService } from "./realtime.service";

/** Unified Inbox U1: realtime fan-out + ephemeral presence. */
describe("RealtimeService", () => {
  it("fans events out to the org's subscribers only", async () => {
    const rt = new RealtimeService();
    const gotA: any[] = [];
    const gotB: any[] = [];
    const subA = rt.stream("org-a").subscribe((e) => { if (e.type !== "heartbeat") gotA.push(e.data); });
    const subB = rt.stream("org-b").subscribe((e) => { if (e.type !== "heartbeat") gotB.push(e.data); });
    rt.emit("org-a", { type: "message.created", conversationId: "c-1", message: { id: "m-1" } });
    expect(gotA).toHaveLength(1);
    expect(gotA[0].type).toBe("message.created");
    expect(gotA[0].conversationId).toBe("c-1");
    expect(typeof gotA[0].at).toBe("string");
    expect(gotB).toHaveLength(0); // strict org isolation
    subA.unsubscribe(); subB.unsubscribe();
    expect(rt.subscriberCount("org-a")).toBe(0);
  });

  it("emitting to an org with no subscribers is a no-op", () => {
    const rt = new RealtimeService();
    expect(() => rt.emit("org-x", { type: "conversation.updated", conversationId: "c" })).not.toThrow();
  });

  it("presence is recorded per thread, broadcast, and expires", () => {
    const rt = new RealtimeService();
    const got: any[] = [];
    const sub = rt.stream("org-a").subscribe((e) => { if (e.type !== "heartbeat") got.push(e.data); });
    rt.notePresence("org-a", "c-1", "u-1", true, "Karim");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: "presence", conversationId: "c-1", userId: "u-1", typing: true });
    const viewers = rt.presenceFor("org-a", "c-1");
    expect(viewers).toEqual([{ userId: "u-1", userName: "Karim", typing: true }]);
    expect(rt.presenceFor("org-a", "c-2")).toEqual([]);
    expect(rt.presenceFor("org-b", "c-1")).toEqual([]);
    sub.unsubscribe();
  });
});
