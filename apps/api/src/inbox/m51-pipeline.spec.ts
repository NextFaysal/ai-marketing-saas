import { InboxService } from "./inbox.service";

/**
 * M51 — pipeline board derivation. The board gains a DERIVED
 * "shipped" stage between "ordered" and "delivered": stored stage
 * stays the U5 set; "shipped" appears only while a linked order's
 * courier shipment is in_transit.
 */
describe("M51 pipeline board shipped derivation", () => {
  const ORG = "org-m51";
  const conv = { id: "c1", organizationId: ORG, channel: "webchat", contactName: "A", status: "open", pipelineStage: "ordered", lastMessageAt: new Date(), lastMessagePreview: "hi", unreadCount: 0, assignedUserId: null, priority: "normal" };
  const order = { id: "o1", organizationId: ORG, conversationId: "c1", status: "processing", totalMinor: 10000n, createdAt: new Date() };

  function svc(shipmentStatus: string | null) {
    const prisma = {
      channelConversation: { findMany: async () => [conv] },
      order: { findMany: async () => [order] },
      courierShipment: { findMany: async () => shipmentStatus ? [{ id: "s1", orderId: "o1", status: shipmentStatus }] : [] },
    };
    return new InboxService(prisma as any, { log: async () => undefined } as any, { getProvider: () => ({ isRealLlm: false, name: "dev" }) } as any);
  }

  it("no shipment yet -> stays ordered (Order Placed)", async () => {
    const board: any = await svc(null).getPipelineBoard(ORG);
    expect(board.stages.ordered.count).toBe(1);
    expect(board.stages.shipped.count).toBe(0);
  });

  it("shipment in_review/pending -> still ordered, not shipped", async () => {
    const board: any = await svc("in_review").getPipelineBoard(ORG);
    expect(board.stages.ordered.count).toBe(1);
    expect(board.stages.shipped.count).toBe(0);
  });

  it("shipment in_transit -> shipped, with the status on the card", async () => {
    const board: any = await svc("in_transit").getPipelineBoard(ORG);
    expect(board.stages.shipped.count).toBe(1);
    expect(board.stages.shipped.cards[0].latestShipmentStatus).toBe("in_transit");
    expect(board.stages.shipped.cards[0].storedStage).toBe("ordered");
  });

  it("shipment delivered -> delivered (Completed), never stuck at shipped", async () => {
    const board: any = await svc("delivered").getPipelineBoard(ORG);
    expect(board.stages.delivered.count).toBe(1);
    expect(board.stages.shipped.count).toBe(0);
  });

  it("board exposes exactly the six stages in owner order", async () => {
    const board: any = await svc(null).getPipelineBoard(ORG);
    expect(Object.keys(board.stages)).toEqual(["new", "talking", "ordered", "shipped", "delivered", "repeat"]);
  });

  it("shipped is NOT a manually settable stored stage", () => {
    expect((InboxService.PIPELINE_STAGES as readonly string[]).includes("shipped")).toBe(false);
    expect((InboxService.BOARD_STAGES as readonly string[]).includes("shipped")).toBe(true);
  });
});
