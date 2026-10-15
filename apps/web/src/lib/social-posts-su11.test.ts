import { describe, expect, it } from "vitest";
import {
  buildPostsPageQuery, healthPill, managerApprovedLabel, mergePostPage,
  summarizeBulkPostResults, summarizeCsvImport,
} from "./social-posts-su11";

describe("SU11 buildPostsPageQuery", () => {
  it("always carries the limit; cursor/filters only when set", () => {
    expect(buildPostsPageQuery({})).toBe("limit=50");
    expect(buildPostsPageQuery({ limit: 25 })).toBe("limit=25");
    const qs = buildPostsPageQuery({ cursor: "abc", status: "draft", accountId: "a-1" });
    expect(qs).toContain("cursor=abc");
    expect(qs).toContain("status=draft");
    expect(qs).toContain("accountId=a-1");
    expect(buildPostsPageQuery({ status: "", accountId: "" })).toBe("limit=50");
  });
});

describe("SU11 mergePostPage", () => {
  it("appends new rows in page order and drops ids already loaded", () => {
    const existing = [{ id: "1" }, { id: "2" }];
    const merged = mergePostPage(existing, [{ id: "2" }, { id: "3" }, { id: "4" }]);
    expect(merged.map((p) => p.id)).toEqual(["1", "2", "3", "4"]);
    expect(mergePostPage([], [{ id: "9" }]).map((p) => p.id)).toEqual(["9"]);
  });
});

describe("SU11 bulk summary", () => {
  it("counts in Bengali digits + up to two verbatim errors", () => {
    const text = summarizeBulkPostResults({
      results: [
        { id: "1", ok: true },
        { id: "2", ok: false, error: "শুধু Draft পোস্ট মুছে ফেলা যায়।" },
        { id: "3", ok: false, error: "পোস্টটি পাওয়া যায়নি।" },
        { id: "4", ok: false, error: "তৃতীয় কারণ" },
      ],
      succeeded: 1, failed: 3,
    }, "Bulk Delete");
    expect(text).toContain("১টি সফল");
    expect(text).toContain("৩টি ব্যর্থ");
    expect(text).toContain("শুধু Draft পোস্ট মুছে ফেলা যায়।");
    expect(text).toContain("পোস্টটি পাওয়া যায়নি।");
    expect(text).not.toContain("তৃতীয় কারণ");
    expect(text).toContain("আরও আছে");
  });

  it("an all-success run has no failure section", () => {
    const text = summarizeBulkPostResults({ results: [{ id: "1", ok: true }], succeeded: 1, failed: 0 }, "Bulk Reschedule");
    expect(text).toBe("Bulk Reschedule: ১টি সফল, ০টি ব্যর্থ।");
  });
});

describe("SU11 CSV import summary + health pill + manager label", () => {
  it("csv summary counts drafts created and rows failed", () => {
    expect(summarizeCsvImport({ results: [], created: 12, failed: 3 }))
      .toBe("CSV Import: ১২টি Draft তৈরি হয়েছে, ৩টি সারি ব্যর্থ।");
  });

  it("health pills map the API labels", () => {
    expect(healthPill("ok").label).toBe("সুস্থ");
    expect(healthPill("error").label).toBe("সমস্যা আছে");
    expect(healthPill("never_checked").label).toBe("কখনো যাচাই হয়নি");
    expect(healthPill(null).label).toBe("অজানা");
    expect(healthPill("something-else").label).toBe("অজানা");
  });

  it("manager_approved carries its own two-step label", () => {
    expect(managerApprovedLabel()).toContain("Manager ধাপে অনুমোদিত");
    expect(managerApprovedLabel()).toContain("চূড়ান্ত অনুমোদনের অপেক্ষায়");
  });
});
