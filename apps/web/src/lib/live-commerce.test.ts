import { describe, expect, it } from "vitest";
import {
  buildCommentOrderPayload, commentOrderNotice, commentsModeNotice, followUpSummary,
  movePin, nowShowingProductId, recapRows, sessionSourceBadge, sessionStatusChip,
  shouldPollComments, togglePin, type LiveSessionProductPin,
} from "./live-commerce";

describe("sessionStatusChip", () => {
  it("maps the three API statuses to Bengali labels", () => {
    expect(sessionStatusChip("scheduled").label).toBe("সূচিত");
    expect(sessionStatusChip("live").label).toBe("লাইভ");
    expect(sessionStatusChip("ended").label).toBe("শেষ");
  });
});

describe("sessionSourceBadge", () => {
  it("meta sessions say Meta, manual sessions honestly say ম্যানুয়াল মোড", () => {
    expect(sessionSourceBadge({ source: "meta" }).label).toBe("Meta");
    expect(sessionSourceBadge({ source: "manual" }).label).toBe("ম্যানুয়াল মোড");
  });
});

describe("commentsModeNotice", () => {
  it("provider unavailable shows the exact honest manual-mode state", () => {
    expect(commentsModeNotice({ mode: "manual", providerStatus: "unavailable" }))
      .toBe("Meta থেকে লাইভ কমেন্ট আসছে না — ম্যানুয়াল মোড");
  });

  it("manual sessions are labelled manual; provider ok shows no notice", () => {
    expect(commentsModeNotice({ mode: "manual", providerStatus: "not_applicable" }))
      .toContain("ম্যানুয়াল মোড");
    expect(commentsModeNotice({ mode: "meta", providerStatus: "ok" })).toBeNull();
    expect(commentsModeNotice(null)).toBeNull();
  });
});

describe("shouldPollComments", () => {
  it("polls only while live", () => {
    expect(shouldPollComments({ status: "live" })).toBe(true);
    expect(shouldPollComments({ status: "scheduled" })).toBe(false);
    expect(shouldPollComments({ status: "ended" })).toBe(false);
    expect(shouldPollComments(null)).toBe(false);
  });
});

describe("pin list ordering", () => {
  it("movePin swaps neighbours and no-ops at the edges", () => {
    expect(movePin(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(movePin(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(movePin(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(movePin(["a", "b"], "zz", 1)).toEqual(["a", "b"]);
  });

  it("togglePin appends new pins and removes existing ones, order preserved", () => {
    expect(togglePin(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(togglePin(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("nowShowingProductId finds the single showing pin", () => {
    const pins: LiveSessionProductPin[] = [
      { id: "p1", productId: "prod-1", displayOrder: 0, isNowShowing: false },
      { id: "p2", productId: "prod-2", displayOrder: 1, isNowShowing: true },
    ];
    expect(nowShowingProductId(pins)).toBe("prod-2");
    expect(nowShowingProductId([])).toBeNull();
    expect(nowShowingProductId(undefined)).toBeNull();
  });
});

describe("buildCommentOrderPayload", () => {
  it("resolves one catalog line with the API's item shape", () => {
    const payload = buildCommentOrderPayload({
      customerPhone: " 01711000000 ",
      customerName: " রহিম ",
      product: { name: "শাড়ি", sku: "S-1", priceMinor: "125000" },
      quantity: 2,
    });
    expect(payload).toEqual({
      customerPhone: "01711000000",
      customerName: "রহিম",
      items: [{ name: "শাড়ি", sku: "S-1", quantity: 2, unitPriceMinor: 125000 }],
    });
  });

  it("omits empty optional fields and clamps quantity to >= 1", () => {
    const payload = buildCommentOrderPayload({
      customerPhone: "01711000000",
      product: { name: "টি-শার্ট", sku: null, priceMinor: null },
      quantity: 0,
    });
    expect(payload).toEqual({
      customerPhone: "01711000000",
      items: [{ name: "টি-শার্ট", quantity: 1, unitPriceMinor: 0 }],
    });
  });
});

describe("commentOrderNotice", () => {
  it("the exactly-once path names the existing order", () => {
    expect(commentOrderNotice({ sessionId: "s", commentId: "c", orderId: "ord-9", alreadyExisted: true, order: null }))
      .toBe("এই কমেন্ট থেকে আগেই অর্ডার তৈরি হয়েছে — অর্ডার ID: ord-9");
    expect(commentOrderNotice({ sessionId: "s", commentId: "c", orderId: "ord-1", alreadyExisted: false, order: null }))
      .toContain("ord-1");
  });
});

describe("recapRows + followUpSummary", () => {
  it("recap rows come only from the recap fields, bn-BD formatted", () => {
    const rows = recapRows({
      sessionId: "s", mode: "manual", status: "ended",
      commentCount: 12, distinctCommenters: 9, orderCount: 3, revenueMinor: "150050",
    });
    expect(rows.map((r) => r.label)).toEqual(["মোট কমেন্ট", "কমেন্টকারী", "অর্ডার", "আয়"]);
    expect(rows[0].value).toBe("১২");
    expect(rows[3].value).toBe("৳১,৫০০.৫০");
  });

  it("follow-up summary carries matched/unmatched counts and the API note verbatim", () => {
    const note = "Saved audience-এর definition খালি শর্তের — যাচাই করুন।";
    const text = followUpSummary({
      sessionId: "s", audienceId: "a1", audienceName: "Live follow-up — x", audienceEntity: "customers",
      matchedCustomerIds: ["c1"], matchedCustomerCount: 1, commenterCount: 4, unmatchedCount: 3, note,
    });
    expect(text).toContain("১ জন ক্রেতা মিলেছে");
    expect(text).toContain("৩ জন মেলেনি");
    expect(text).toContain(note);
  });
});
