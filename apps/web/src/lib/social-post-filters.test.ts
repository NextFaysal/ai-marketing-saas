import { describe, expect, it } from "vitest";
import { filterSocialPosts, type SocialPost } from "./social-post-filters";

const page = { id: "acc-page", platform: "meta_page" as const, name: "Qosprey Shop", username: null };
const insta = { id: "acc-ig", platform: "instagram" as const, name: "Qosprey IG", username: "qosprey.bd" };

function post(partial: Partial<SocialPost> & { id: string }): SocialPost {
  return {
    socialAccountId: page.id,
    caption: "",
    linkUrl: null,
    mediaRefs: [],
    status: "draft",
    scheduledAt: null,
    publishedAt: null,
    platformPostId: null,
    platformUrl: null,
    error: null,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    account: page,
    ...partial,
  };
}

const posts: SocialPost[] = [
  post({ id: "p1", caption: "নতুন কালেকশন এসেছে — শাড়ি মাত্র ৯৯৯ টাকা", status: "draft" }),
  post({ id: "p2", caption: "Eid offer starts tomorrow", status: "scheduled", socialAccountId: insta.id, account: insta }),
  post({ id: "p3", caption: "Customer review video", status: "published", publishedAt: "2026-10-10T00:00:00.000Z" }),
  post({ id: "p4", caption: "Flash sale FAILED post", status: "failed", error: "Token expired", socialAccountId: insta.id, account: insta }),
  post({ id: "p5", caption: "পুরনো পোস্ট", status: "cancelled" }),
];

describe("filterSocialPosts (SP2)", () => {
  it("no filters → everything, order preserved", () => {
    expect(filterSocialPosts(posts, {})).toHaveLength(5);
    expect(filterSocialPosts(posts, { query: "   " }).map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("status filter matches exactly", () => {
    expect(filterSocialPosts(posts, { status: "draft" }).map((p) => p.id)).toEqual(["p1"]);
    expect(filterSocialPosts(posts, { status: "published" }).map((p) => p.id)).toEqual(["p3"]);
    expect(filterSocialPosts(posts, { status: "sent_to_creator" })).toHaveLength(0);
  });

  it("account filter matches the owning account", () => {
    expect(filterSocialPosts(posts, { accountId: insta.id }).map((p) => p.id)).toEqual(["p2", "p4"]);
    expect(filterSocialPosts(posts, { accountId: "no-such-account" })).toHaveLength(0);
  });

  it("query matches caption and account name, case-insensitively", () => {
    expect(filterSocialPosts(posts, { query: "শাড়ি" }).map((p) => p.id)).toEqual(["p1"]);
    expect(filterSocialPosts(posts, { query: "eid OFFER" }).map((p) => p.id)).toEqual(["p2"]);
    expect(filterSocialPosts(posts, { query: "qosprey shop" }).map((p) => p.id)).toEqual(["p1", "p3", "p5"]);
    expect(filterSocialPosts(posts, { query: "qosprey.bd" }).map((p) => p.id)).toEqual(["p2", "p4"]);
    expect(filterSocialPosts(posts, { query: "কিছুই মিলবে না" })).toHaveLength(0);
  });

  it("filters combine (AND)", () => {
    expect(filterSocialPosts(posts, { status: "failed", accountId: insta.id }).map((p) => p.id)).toEqual(["p4"]);
    expect(filterSocialPosts(posts, { status: "failed", accountId: page.id })).toHaveLength(0);
    expect(filterSocialPosts(posts, { status: "draft", accountId: page.id, query: "কালেকশন" })).toHaveLength(1);
    expect(filterSocialPosts(posts, { status: "draft", query: "eid" })).toHaveLength(0);
  });

  it("empty input stays empty", () => {
    expect(filterSocialPosts([], { status: "draft", query: "x" })).toEqual([]);
  });
});
