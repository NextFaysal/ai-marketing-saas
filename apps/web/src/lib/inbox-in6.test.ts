import { describe, expect, it } from "vitest";
import { canSendReaction, deliveryTick, parseMessageReactions, quoteReachesCustomer } from "./inbox-in6";

describe("IN6 deliveryTick", () => {
  it("shows nothing without a confirmed deliveryStatus", () => {
    expect(deliveryTick("whatsapp", { direction: "out", deliveryStatus: null })).toBeNull();
    expect(deliveryTick("whatsapp", { direction: "out" })).toBeNull();
  });
  it("shows nothing for inbound messages", () => {
    expect(deliveryTick("whatsapp", { direction: "in", deliveryStatus: "read" })).toBeNull();
  });
  it("WhatsApp: ✓ sent, ✓✓ delivered, blue ✓✓ read", () => {
    expect(deliveryTick("whatsapp", { direction: "out", deliveryStatus: "sent" })?.glyph).toBe("✓");
    expect(deliveryTick("whatsapp", { direction: "out", deliveryStatus: "delivered" })?.glyph).toBe("✓✓");
    const read = deliveryTick("whatsapp", { direction: "out", deliveryStatus: "read" });
    expect(read?.glyph).toBe("✓✓");
    expect(read?.blue).toBe(true);
  });
  it("Messenger: Seen/Delivered labels only", () => {
    expect(deliveryTick("messenger", { direction: "out", deliveryStatus: "read" })?.label).toBe("Seen");
    expect(deliveryTick("messenger", { direction: "out", deliveryStatus: "delivered" })?.label).toBe("Delivered");
    expect(deliveryTick("messenger", { direction: "out", deliveryStatus: "sent" })).toBeNull();
  });
  it("Telegram/Email: never any tick (no confirmed source)", () => {
    expect(deliveryTick("telegram", { direction: "out", deliveryStatus: "read" })).toBeNull();
    expect(deliveryTick("email", { direction: "out", deliveryStatus: "delivered" })).toBeNull();
  });
  it("webchat: Seen only when read", () => {
    expect(deliveryTick("webchat", { direction: "out", deliveryStatus: "read" })?.label).toBe("Seen");
    expect(deliveryTick("webchat", { direction: "out", deliveryStatus: "delivered" })).toBeNull();
  });
});

describe("IN6 channel capability honesty", () => {
  it("quote reaches the customer only on Meta channels", () => {
    expect(quoteReachesCustomer("whatsapp")).toBe(true);
    expect(quoteReachesCustomer("messenger")).toBe(true);
    expect(quoteReachesCustomer("instagram")).toBe(true);
    expect(quoteReachesCustomer("telegram")).toBe(false);
    expect(quoteReachesCustomer("webchat")).toBe(false);
    expect(quoteReachesCustomer("email")).toBe(false);
  });
  it("agent reaction sending only on Messenger/Instagram", () => {
    expect(canSendReaction("messenger")).toBe(true);
    expect(canSendReaction("instagram")).toBe(true);
    expect(canSendReaction("whatsapp")).toBe(false);
    expect(canSendReaction("webchat")).toBe(false);
  });
});

describe("IN6 parseMessageReactions", () => {
  it("parses arrays and JSON strings, drops garbage", () => {
    expect(parseMessageReactions([{ emoji: "❤️", actor: "customer" }])).toHaveLength(1);
    expect(parseMessageReactions('[{"emoji":"👍","actor":"page"}]')).toHaveLength(1);
    expect(parseMessageReactions("not json")).toEqual([]);
    expect(parseMessageReactions(null)).toEqual([]);
    expect(parseMessageReactions([{ emoji: 5, actor: "customer" }, { emoji: "x", actor: "bot" }])).toEqual([]);
  });
});
