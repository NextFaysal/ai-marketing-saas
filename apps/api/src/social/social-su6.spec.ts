import { SocialLinkService, appendUtm, isBotUserAgent } from "./social-link.service";

/**
 * SU6 — Link tracking:
 * - appendUtm adds only the missing utm_* params, never
 *   overwrites the merchant's own, and leaves unparseable URLs
 *   untouched (the MS6 pattern);
 * - bot / link-preview user-agents (Meta, WhatsApp, crawlers)
 *   are NOT clicks; an empty UA counts as human (documented
 *   decision — not every real browser/webview sends one);
 * - tokens are minted once and are idempotent; the tracked URL
 *   needs API_PUBLIC_URL — without it buildTrackedUrl is null
 *   and publish falls back to the raw linkUrl (honest fallback,
 *   covered here per the Batch 3 brief);
 * - recordClick writes a row only for humans but always
 *   resolves the UTM redirect;
 * - stats: clicks + last click, and orders ASSOCIATED via a
 *   LAST_TOUCH credit whose touchpoint campaign is the post,
 *   inside the org's click window, revenue-excluded statuses
 *   dropped — labelled "association, attribution নয়" verbatim.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const o = v as any;
      if ("in" in o) return o.in.includes(row[k]);
      if ("not" in o) return o.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== o.not;
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data };
      if (data.socialPostId && !data.clickedAt) row.clickedAt = new Date();
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

const HUMAN_UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const CLICK_AT = new Date("2026-10-10T10:00:00.000Z");

function fakePrisma() {
  const tables: any = {
    socialPost: makeTable("post"),
    socialAccount: makeTable("acct"),
    socialLinkClick: makeTable("click"),
    attributionCredit: makeTable("credit"),
    order: makeTable("order"),
    organization: makeTable("org"),
  };
  tables.organization.rows.push({ id: "org-1", socialLinkWindowDays: 7 });
  tables.socialAccount.rows.push({ id: "acct-1", organizationId: "org-1", platform: "meta_page", status: "connected" });
  tables.socialPost.rows.push({
    id: "post-1", organizationId: "org-1", socialAccountId: "acct-1",
    caption: "Sale post", linkUrl: "https://shop.example/checkout/panjabi",
    linkToken: "tok-abc", status: "published", createdAt: new Date(),
  });
  return tables;
}

const SAVED_API_PUBLIC_URL = process.env.API_PUBLIC_URL;
afterEach(() => {
  if (SAVED_API_PUBLIC_URL === undefined) delete process.env.API_PUBLIC_URL;
  else process.env.API_PUBLIC_URL = SAVED_API_PUBLIC_URL;
});

describe("SU6 appendUtm (pure)", () => {
  it("adds source/medium/campaign when none exist", () => {
    const out = new URL(appendUtm("https://shop.example/p", { source: "meta_page", medium: "social", campaign: "post-1" }));
    expect(out.searchParams.get("utm_source")).toBe("meta_page");
    expect(out.searchParams.get("utm_medium")).toBe("social");
    expect(out.searchParams.get("utm_campaign")).toBe("post-1");
  });

  it("never overwrites an existing utm param and never duplicates", () => {
    const out = appendUtm("https://shop.example/p?utm_source=merchant&x=1", { source: "meta_page", medium: "social", campaign: "post-1" });
    const url = new URL(out);
    expect(url.searchParams.get("utm_source")).toBe("merchant");
    expect(url.searchParams.get("utm_medium")).toBe("social");
    expect(url.searchParams.get("x")).toBe("1");
    expect(out.match(/utm_source=/g)).toHaveLength(1);
  });

  it("returns an unparseable URL unchanged", () => {
    expect(appendUtm("not a url", { source: "s", medium: "m", campaign: "c" })).toBe("not a url");
  });
});

describe("SU6 isBotUserAgent (pure)", () => {
  it("flags crawlers and link-preview fetchers", () => {
    expect(isBotUserAgent("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe(true);
    expect(isBotUserAgent("WhatsApp/2.23")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBotUserAgent("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isBotUserAgent("Slackbot-LinkExpanding 1.0")).toBe(true);
  });

  it("treats a normal browser — and an empty UA — as human", () => {
    expect(isBotUserAgent(HUMAN_UA)).toBe(false);
    expect(isBotUserAgent("")).toBe(false);
    expect(isBotUserAgent(null)).toBe(false);
    expect(isBotUserAgent(undefined)).toBe(false);
  });
});

describe("SU6 SocialLinkService — tokens + tracked URL", () => {
  it("ensureLinkToken is idempotent: an existing token is returned, never re-minted", async () => {
    const tables = fakePrisma();
    const svc = new SocialLinkService(tables as any);
    const post = tables.socialPost.rows[0];
    await expect(svc.ensureLinkToken("org-1", post)).resolves.toBe("tok-abc");
  });

  it("ensureLinkToken mints + persists a token when absent, then reuses it", async () => {
    const tables = fakePrisma();
    tables.socialPost.rows[0].linkToken = null;
    const svc = new SocialLinkService(tables as any);
    const post = tables.socialPost.rows[0];
    const first = await svc.ensureLinkToken("org-1", post);
    expect(first).toBeTruthy();
    expect(post.linkToken).toBe(first);
    await expect(svc.ensureLinkToken("org-1", post)).resolves.toBe(first);
  });

  it("buildTrackedUrl composes <API_PUBLIC_URL>/public/social/r/<token>, trimming trailing slashes", async () => {
    process.env.API_PUBLIC_URL = "https://api.example.com/";
    const tables = fakePrisma();
    const svc = new SocialLinkService(tables as any);
    const url = await svc.buildTrackedUrl(tables.socialPost.rows[0], tables.socialAccount.rows[0]);
    expect(url).toBe("https://api.example.com/public/social/r/tok-abc");
  });

  it("buildTrackedUrl is null without API_PUBLIC_URL (publish falls back to the raw link)", async () => {
    delete process.env.API_PUBLIC_URL;
    const tables = fakePrisma();
    const svc = new SocialLinkService(tables as any);
    await expect(svc.buildTrackedUrl(tables.socialPost.rows[0], tables.socialAccount.rows[0])).resolves.toBeNull();
  });
});

describe("SU6 SocialLinkService — recordClick", () => {
  it("a human click writes a row and returns the UTM redirect (source = account platform)", async () => {
    const tables = fakePrisma();
    const svc = new SocialLinkService(tables as any);
    const out = await svc.recordClick("tok-abc", HUMAN_UA);
    expect(out?.counted).toBe(true);
    const url = new URL(out!.url!);
    expect(url.searchParams.get("utm_source")).toBe("meta_page");
    expect(url.searchParams.get("utm_medium")).toBe("social");
    expect(url.searchParams.get("utm_campaign")).toBe("post-1");
    expect(tables.socialLinkClick.rows).toHaveLength(1);
    expect(tables.socialLinkClick.rows[0]).toMatchObject({ organizationId: "org-1", socialPostId: "post-1", userAgent: HUMAN_UA });
  });

  it("a bot / preview fetch writes NO row but still gets the redirect", async () => {
    const tables = fakePrisma();
    const svc = new SocialLinkService(tables as any);
    const out = await svc.recordClick("tok-abc", "facebookexternalhit/1.1");
    expect(out?.counted).toBe(false);
    expect(out?.url).toContain("utm_campaign=post-1");
    expect(tables.socialLinkClick.rows).toHaveLength(0);
  });

  it("an unknown token resolves to null (controller 404)", async () => {
    const tables = fakePrisma();
    const svc = new SocialLinkService(tables as any);
    await expect(svc.recordClick("tok-nope", HUMAN_UA)).resolves.toBeNull();
  });

  it("the stored user-agent is capped at 300 chars", async () => {
    const tables = fakePrisma();
    const svc = new SocialLinkService(tables as any);
    await svc.recordClick("tok-abc", `Mozilla/5.0 ${"x".repeat(400)}`);
    expect(tables.socialLinkClick.rows[0].userAgent.length).toBe(300);
  });
});

describe("SU6 SocialLinkService — getLinkStats association", () => {
  function seedClicksAndOrders(tables: any) {
    tables.socialLinkClick.rows.push({ id: "click-1", organizationId: "org-1", socialPostId: "post-1", clickedAt: CLICK_AT, userAgent: HUMAN_UA });
    const credit = (orderId: string, campaign: string | null, model = "LAST_TOUCH") => ({
      id: `cr-${orderId}-${campaign}`, organizationId: "org-1", orderId, model,
      touchpoint: campaign === null ? null : { campaign },
    });
    tables.attributionCredit.rows.push(
      credit("ord-in", "post-1"),
      credit("ord-out", "post-1"),
      credit("ord-cancelled", "post-1"),
      credit("ord-other", "some-other-post"),
      credit("ord-first", "post-1", "FIRST_TOUCH"),
    );
    tables.order.rows.push(
      // Inside the 7-day window after the click → associated.
      { id: "ord-in", organizationId: "org-1", status: "completed", totalMinor: 50000n, placedAt: new Date(CLICK_AT.getTime() + 2 * 86_400_000), createdAt: new Date() },
      // 10 days after the click → outside the window.
      { id: "ord-out", organizationId: "org-1", status: "completed", totalMinor: 90000n, placedAt: new Date(CLICK_AT.getTime() + 10 * 86_400_000), createdAt: new Date() },
      // Inside the window but revenue-excluded status.
      { id: "ord-cancelled", organizationId: "org-1", status: "cancelled", totalMinor: 70000n, placedAt: new Date(CLICK_AT.getTime() + 1 * 86_400_000), createdAt: new Date() },
      // Credited to a DIFFERENT campaign.
      { id: "ord-other", organizationId: "org-1", status: "completed", totalMinor: 11000n, placedAt: new Date(CLICK_AT.getTime() + 1 * 86_400_000), createdAt: new Date() },
      // Only a FIRST_TOUCH credit — the association reads LAST_TOUCH only.
      { id: "ord-first", organizationId: "org-1", status: "completed", totalMinor: 13000n, placedAt: new Date(CLICK_AT.getTime() + 1 * 86_400_000), createdAt: new Date() },
    );
  }

  it("counts clicks, associates only in-window non-excluded LAST_TOUCH orders, sums revenue as a string", async () => {
    const tables = fakePrisma();
    seedClicksAndOrders(tables);
    const svc = new SocialLinkService(tables as any);
    const stats = await svc.getLinkStats("org-1", "post-1");
    expect(stats.clicks).toBe(1);
    expect(stats.lastClickedAt).toBe(CLICK_AT.toISOString());
    expect(stats.ordersAssociated).toBe(1);
    expect(stats.revenueAssociatedMinor).toBe("50000");
    expect(stats.associationNote).toBe("association, attribution নয়");
  });

  it("no credits at all → real zeros (ordersAssociated 0, revenue '0'), not nulls", async () => {
    const tables = fakePrisma();
    tables.socialLinkClick.rows.push({ id: "click-1", organizationId: "org-1", socialPostId: "post-1", clickedAt: CLICK_AT, userAgent: HUMAN_UA });
    const svc = new SocialLinkService(tables as any);
    const stats = await svc.getLinkStats("org-1", "post-1");
    expect(stats.clicks).toBe(1);
    expect(stats.ordersAssociated).toBe(0);
    expect(stats.revenueAssociatedMinor).toBe("0");
  });

  it("no clicks → no association evidence, even with credits present", async () => {
    const tables = fakePrisma();
    seedClicksAndOrders(tables);
    tables.socialLinkClick.rows.length = 0;
    const svc = new SocialLinkService(tables as any);
    const stats = await svc.getLinkStats("org-1", "post-1");
    expect(stats.clicks).toBe(0);
    expect(stats.lastClickedAt).toBeNull();
    expect(stats.ordersAssociated).toBe(0);
    expect(stats.revenueAssociatedMinor).toBe("0");
  });

  it("a post outside the org → 404", async () => {
    const tables = fakePrisma();
    const svc = new SocialLinkService(tables as any);
    await expect(svc.getLinkStats("org-2", "post-1")).rejects.toThrow();
    await expect(svc.getLinkStats("org-1", "post-nope")).rejects.toThrow();
  });
});
