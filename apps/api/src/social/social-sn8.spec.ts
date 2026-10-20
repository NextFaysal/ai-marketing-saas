import { SocialCommerceDraftService } from "./social-commerce-draft.service";
import { SocialSyndicationService } from "./social-syndication.service";
import { SocialImportService } from "./social-import.service";
import { parseFeed } from "./social-feed";
import { YouTubeClient } from "./youtube.client";
import { AutomationService, JOB_TEMPLATES, JOB_TYPES } from "../automation/automation.service";

/**
 * SN8 — Syndication auto-drafts:
 * - the dependency-free RSS 2.0 / Atom parser (guid/link identity,
 *   CDATA + entity decoding, alternate-link preference, empty
 *   title/link dropped, feed order preserved);
 * - auto-draft settings: the syndication toggles + rssFeedUrl
 *   join the defaults / serializer / PATCH (null/"" clears, only
 *   http/https URLs are accepted, absent leaves it untouched);
 * - the guarded text fetch rides the existing guarded bytes path;
 * - YouTubeClient.listRecentUploads via the uploads playlist;
 * - the sweep: toggles off → skipped; new items → DRAFTS only
 *   (caption + linkUrl + kind/ref pinned), seen-row dedupe (a
 *   seen item is never re-drafted, even after its post is
 *   deleted), the autoDraftRef second dedupe layer, the SU5
 *   daily cap (cap-skipped items stay unseen), the SU5 target
 *   account rule, and per-source error isolation (verbatim);
 * - the automation job type / template / dispatch.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const o = v as any;
      if ("not" in o) return o.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== o.not;
      if ("in" in o) return o.in.includes(row[k]);
      const t = row[k] instanceof Date ? row[k].getTime() : row[k];
      if ("gte" in o && !(t >= new Date(o.gte).getTime())) return false;
      if ("gt" in o && !(t > new Date(o.gt).getTime())) return false;
      if ("lt" in o && !(t < new Date(o.lt).getTime())) return false;
      if ("lte" in o && !(t <= new Date(o.lte).getTime())) return false;
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string, opts: { uniqueSeen?: boolean } = {}) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "asc") out = [...out].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return out[0] ?? null;
    },
    findMany: async ({ where, orderBy }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "asc") out = [...out].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return out;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      if (opts.uniqueSeen && rows.some((r) => r.organizationId === data.organizationId && r.source === data.source && r.externalId === data.externalId)) {
        throw new Error("Unique constraint failed on the fields: (`organizationId`,`source`,`externalId`)");
      }
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    upsert: async ({ where, update, create }: any) => {
      const existing = rows.find((r) => matches(r, where ?? {}));
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
      return row;
    },
  };
}

function fakePrisma() {
  const tables: any = {
    socialAutoDraftConfig: makeTable("cfg"),
    socialAccount: makeTable("acct"),
    socialPost: makeTable("post"),
    socialSyndicationSeen: makeTable("seen", { uniqueSeen: true }),
  };
  tables.socialAccount.rows.push(
    { id: "acct-page", organizationId: "org-1", platform: "meta_page", status: "connected", name: "Page", createdAt: new Date("2026-01-01") },
    { id: "acct-yt", organizationId: "org-1", platform: "youtube", status: "connected", name: "Channel", createdAt: new Date("2026-01-02") },
  );
  return tables;
}

function auditStub() {
  const entries: any[] = [];
  return { entries, log: async (e: any) => { entries.push(e); } };
}

function syndicationConfig(tables: any, overrides: any = {}) {
  tables.socialAutoDraftConfig.rows.push({
    id: "cfg-1", organizationId: "org-1",
    newProductEnabled: false, saleEnabled: false, backInStockEnabled: false, reviewMilestoneEnabled: false,
    rssEnabled: false, youtubeEnabled: false, rssFeedUrl: null,
    maxDraftsPerDay: 3, socialAccountId: null, ...overrides,
  });
}

function makeSweep(tables: any, audit: any = auditStub()) {
  const svc = new SocialSyndicationService(tables as any, audit as any);
  return { svc, audit };
}

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Shop Blog</title>
<item><title><![CDATA[ঈদ কালেকশন & অফার]]></title><link>https://example.com/eid?a=1&amp;b=2</link><guid>post-101</guid><pubDate>Wed, 15 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Second &amp; News</title><link>https://example.com/second</link><pubDate>Wed, 15 Oct 2026 09:00:00 GMT</pubDate></item>
<item><title></title><link>https://example.com/empty-title</link><guid>empty-1</guid></item>
<item><title>No Link Item</title><guid>no-link-1</guid></item>
</channel></rss>`;

const ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom Post &quot;One&quot;</title><link rel="self" href="https://example.com/feed.xml"/><link rel="alternate" href="https://example.com/atom-one"/><id>urn:atom:1</id><updated>2026-10-15T10:00:00Z</updated></entry>
<entry><title>Atom &#39;Two&#39;</title><link href="https://example.com/atom-two"/><id>urn:atom:2</id><published>2026-10-14T10:00:00Z</published></entry>
</feed>`;

// ---------- parser ----------

describe("SN8 parseFeed — RSS 2.0", () => {
  it("extracts guid identity, CDATA title, entity-decoded link and pubDate, in feed order", () => {
    const items = parseFeed(RSS_XML);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      externalId: "post-101",
      title: "ঈদ কালেকশন & অফার",
      link: "https://example.com/eid?a=1&b=2",
      publishedAt: "Wed, 15 Oct 2026 10:00:00 GMT",
    });
    // No guid → the link is the identity; &amp; in the title decodes.
    expect(items[1].externalId).toBe("https://example.com/second");
    expect(items[1].title).toBe("Second & News");
  });

  it("drops items with an empty title or an empty link", () => {
    const ids = parseFeed(RSS_XML).map((i) => i.externalId);
    expect(ids).not.toContain("empty-1");
    expect(ids).not.toContain("no-link-1");
  });
});

describe("SN8 parseFeed — Atom", () => {
  it("prefers the rel=alternate link, uses <id> as identity, updated before published", () => {
    const items = parseFeed(ATOM_XML);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      externalId: "urn:atom:1",
      title: 'Atom Post "One"',
      link: "https://example.com/atom-one",
      publishedAt: "2026-10-15T10:00:00Z",
    });
    expect(items[1].externalId).toBe("urn:atom:2");
    expect(items[1].title).toBe("Atom 'Two'");
    expect(items[1].link).toBe("https://example.com/atom-two");
    expect(items[1].publishedAt).toBe("2026-10-14T10:00:00Z");
  });

  it("empty / unrecognised input yields an empty list, never a throw", () => {
    expect(parseFeed("")).toEqual([]);
    expect(parseFeed("not xml at all")).toEqual([]);
  });
});

// ---------- settings ----------

describe("SN8 auto-draft settings — syndication fields", () => {
  it("defaults carry rssEnabled/youtubeEnabled false and rssFeedUrl null, without writing a row", async () => {
    const tables = fakePrisma();
    const svc = new SocialCommerceDraftService(tables as any, auditStub() as any, undefined, undefined);
    const out = await svc.getSettings("org-1");
    expect(out).toMatchObject({ rssEnabled: false, youtubeEnabled: false, rssFeedUrl: null });
    expect(tables.socialAutoDraftConfig.rows).toHaveLength(0);
  });

  it("PATCH stores the toggles and a trimmed valid rssFeedUrl; a stored row serializes them back", async () => {
    const tables = fakePrisma();
    const svc = new SocialCommerceDraftService(tables as any, auditStub() as any, undefined, undefined);
    const out = await svc.updateSettings("org-1", "actor-1", {
      rssEnabled: true, youtubeEnabled: true, rssFeedUrl: "  https://example.com/feed.xml  ",
    });
    expect(out.rssEnabled).toBe(true);
    expect(out.youtubeEnabled).toBe(true);
    expect(out.rssFeedUrl).toBe("https://example.com/feed.xml");
    const again = await svc.getSettings("org-1");
    expect(again).toMatchObject({ rssEnabled: true, youtubeEnabled: true, rssFeedUrl: "https://example.com/feed.xml" });
  });

  it("PATCH rejects a non-http/https or malformed rssFeedUrl with the Bengali error, and saves nothing for it", async () => {
    const tables = fakePrisma();
    const svc = new SocialCommerceDraftService(tables as any, auditStub() as any, undefined, undefined);
    await expect(svc.updateSettings("org-1", "actor-1", { rssFeedUrl: "ftp://example.com/feed" }))
      .rejects.toThrow("RSS Feed URL-টি সঠিক http/https ঠিকানা নয়।");
    await expect(svc.updateSettings("org-1", "actor-1", { rssFeedUrl: "not a url" }))
      .rejects.toThrow("RSS Feed URL-টি সঠিক http/https ঠিকানা নয়।");
  });

  it("PATCH with rssFeedUrl null or '' clears it; an absent rssFeedUrl leaves it untouched", async () => {
    const tables = fakePrisma();
    const svc = new SocialCommerceDraftService(tables as any, auditStub() as any, undefined, undefined);
    await svc.updateSettings("org-1", "actor-1", { rssFeedUrl: "https://example.com/feed.xml" });
    const untouched = await svc.updateSettings("org-1", "actor-1", { rssEnabled: true });
    expect(untouched.rssFeedUrl).toBe("https://example.com/feed.xml");
    const clearedNull = await svc.updateSettings("org-1", "actor-1", { rssFeedUrl: null });
    expect(clearedNull.rssFeedUrl).toBeNull();
    await svc.updateSettings("org-1", "actor-1", { rssFeedUrl: "https://example.com/feed.xml" });
    const clearedEmpty = await svc.updateSettings("org-1", "actor-1", { rssFeedUrl: "" });
    expect(clearedEmpty.rssFeedUrl).toBeNull();
  });
});

// ---------- guarded text fetch ----------

describe("SN8 SocialImportService.fetchGuardedText", () => {
  it("returns the UTF-8 text fetched through the guarded bytes path", async () => {
    const svc = new SocialImportService({} as any, auditStub() as any);
    svc.resolveHost = async () => ["93.184.216.34"];
    svc.fetchFn = async () => ({
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode("<rss>ঈদ</rss>").buffer,
    });
    await expect(svc.fetchGuardedText("https://example.com/feed.xml")).resolves.toBe("<rss>ঈদ</rss>");
  });
});

// ---------- YouTube recent uploads ----------

function stubFetch(handler: (url: string) => { status?: number; body?: any }) {
  const calls: { url: string; opts: any }[] = [];
  const fetchFn = (async (url: string, opts: any) => {
    calls.push({ url, opts });
    const r = handler(url);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300, status, headers: {},
      json: async () => r.body ?? {},
    };
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("SN8 YouTubeClient.listRecentUploads", () => {
  it("resolves the uploads playlist from channels.list and maps one playlistItems page", async () => {
    const { fetchFn, calls } = stubFetch((url) => {
      if (url.includes("/channels?")) {
        return { body: { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] } };
      }
      return {
        body: {
          items: [
            { contentDetails: { videoId: "v1", videoPublishedAt: "2026-10-15T08:00:00Z" }, snippet: { title: "Title One" } },
            { snippet: { resourceId: { videoId: "v2" }, title: "Title Two", publishedAt: "2026-10-14T08:00:00Z" } },
          ],
        },
      };
    });
    const out = await new YouTubeClient(fetchFn).listRecentUploads("tok", 5);
    expect(out).toEqual([
      { videoId: "v1", title: "Title One", publishedAt: "2026-10-15T08:00:00Z" },
      { videoId: "v2", title: "Title Two", publishedAt: "2026-10-14T08:00:00Z" },
    ]);
    expect(calls[0].url).toContain("part=contentDetails");
    expect(calls[0].url).toContain("mine=true");
    expect(calls[1].url).toContain("/playlistItems?");
    expect(calls[1].url).toContain("playlistId=UU123");
    expect(calls[1].url).toContain("maxResults=5");
  });

  it("no uploads playlist → an empty list, no second call", async () => {
    const { fetchFn, calls } = stubFetch(() => ({ body: { items: [{ contentDetails: { relatedPlaylists: {} } }] } }));
    await expect(new YouTubeClient(fetchFn).listRecentUploads("tok")).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("a failed channels call throws Google's verbatim error", async () => {
    const { fetchFn } = stubFetch(() => ({ status: 403, body: { error: { message: "quotaExceeded" } } }));
    await expect(new YouTubeClient(fetchFn).listRecentUploads("tok")).rejects.toThrow("quotaExceeded");
  });
});

// ---------- the sweep ----------

describe("SN8 SocialSyndicationService — disabled + target account", () => {
  it("no config row → skipped disabled, nothing fetched, nothing created", async () => {
    const tables = fakePrisma();
    const { svc } = makeSweep(tables);
    let fetched = 0;
    svc.fetchFeedText = async () => { fetched += 1; return RSS_XML; };
    const out = await svc.runSyndicationSweep("org-1");
    expect(out.skipped).toBe("disabled");
    expect(out.rssCreated).toBe(0);
    expect(fetched).toBe(0);
    expect(tables.socialPost.rows).toHaveLength(0);
  });

  it("config row with both toggles off → skipped disabled", async () => {
    const tables = fakePrisma();
    syndicationConfig(tables, { rssEnabled: false, youtubeEnabled: false, rssFeedUrl: "https://example.com/feed.xml" });
    const { svc } = makeSweep(tables);
    const out = await svc.runSyndicationSweep("org-1");
    expect(out.skipped).toBe("disabled");
    expect(tables.socialPost.rows).toHaveLength(0);
  });

  it("no connected meta_page target account → no drafts at all (skipped no_account)", async () => {
    const tables = fakePrisma();
    const ytOnly = tables.socialAccount.rows.filter((r: any) => r.platform === "youtube");
    tables.socialAccount.rows.length = 0;
    tables.socialAccount.rows.push(...ytOnly);
    syndicationConfig(tables, { youtubeEnabled: true });
    const { svc } = makeSweep(tables);
    let ytCalls = 0;
    svc.listYouTubeUploads = async () => { ytCalls += 1; return [{ videoId: "v1", title: "T", publishedAt: null }]; };
    const out = await svc.runSyndicationSweep("org-1");
    expect(out.skipped).toBe("no_account");
    expect(out.youtubeCreated).toBe(0);
    expect(ytCalls).toBe(0);
    expect(tables.socialPost.rows).toHaveLength(0);
    expect(tables.socialSyndicationSeen.rows).toHaveLength(0);
  });

  it("the pinned config account wins over the first connected meta_page account", async () => {
    const tables = fakePrisma();
    tables.socialAccount.rows.push({ id: "acct-page-2", organizationId: "org-1", platform: "meta_page", status: "connected", name: "Page 2", createdAt: new Date("2026-02-01") });
    syndicationConfig(tables, { rssEnabled: true, rssFeedUrl: "https://example.com/feed.xml", socialAccountId: "acct-page-2" });
    const { svc } = makeSweep(tables);
    svc.fetchFeedText = async () => RSS_XML;
    await svc.runSyndicationSweep("org-1");
    expect(tables.socialPost.rows.length).toBeGreaterThan(0);
    expect(tables.socialPost.rows.every((p: any) => p.socialAccountId === "acct-page-2")).toBe(true);
  });
});

describe("SN8 SocialSyndicationService — RSS drafts + dedupe + cap", () => {
  it("new RSS items become drafts with the pinned caption/linkUrl/kind/ref + seen rows + syndication audit", async () => {
    const tables = fakePrisma();
    syndicationConfig(tables, { rssEnabled: true, rssFeedUrl: "https://example.com/feed.xml" });
    const { svc, audit } = makeSweep(tables);
    svc.fetchFeedText = async () => RSS_XML;
    const out = await svc.runSyndicationSweep("org-1");
    expect(out).toEqual({ rssCreated: 2, youtubeCreated: 0, errors: [] });
    const first = tables.socialPost.rows[0];
    expect(first).toMatchObject({
      caption: "ঈদ কালেকশন & অফার",
      linkUrl: "https://example.com/eid?a=1&b=2",
      status: "draft",
      autoDraftKind: "rss_feed",
      autoDraftRef: "rss:post-101",
      socialAccountId: "acct-page",
      createdById: "system",
      mediaRefs: [],
    });
    expect(tables.socialPost.rows[1].autoDraftRef).toBe("rss:https://example.com/second");
    expect(tables.socialSyndicationSeen.rows.map((r: any) => [r.source, r.externalId])).toEqual([
      ["rss", "post-101"], ["rss", "https://example.com/second"],
    ]);
    const auditHit = (audit as any).entries.find((e: any) => e.action === "social.auto_draft_created");
    expect(auditHit.metadata).toEqual({ kind: "rss_feed", ref: "rss:post-101", source: "syndication" });
    // Drafts only — every created post is a draft, nothing else.
    expect(tables.socialPost.rows.every((p: any) => p.status === "draft")).toBe(true);
  });

  it("a second run over the same feed creates nothing new", async () => {
    const tables = fakePrisma();
    syndicationConfig(tables, { rssEnabled: true, rssFeedUrl: "https://example.com/feed.xml" });
    const { svc } = makeSweep(tables);
    svc.fetchFeedText = async () => RSS_XML;
    await svc.runSyndicationSweep("org-1");
    const out = await svc.runSyndicationSweep("org-1");
    expect(out.rssCreated).toBe(0);
    expect(tables.socialPost.rows).toHaveLength(2);
    expect(tables.socialSyndicationSeen.rows).toHaveLength(2);
  });

  it("a seen item is never re-drafted — even after its draft post is deleted", async () => {
    const tables = fakePrisma();
    syndicationConfig(tables, { rssEnabled: true, rssFeedUrl: "https://example.com/feed.xml" });
    tables.socialSyndicationSeen.rows.push({ id: "seen-1", organizationId: "org-1", source: "rss", externalId: "post-101", createdAt: new Date() });
    const { svc } = makeSweep(tables);
    svc.fetchFeedText = async () => RSS_XML;
    const out = await svc.runSyndicationSweep("org-1");
    // post-101 stays un-drafted (seen); only the second item drafts.
    expect(out.rssCreated).toBe(1);
    expect(tables.socialPost.rows.map((p: any) => p.autoDraftRef)).toEqual(["rss:https://example.com/second"]);
  });

  it("an existing post with the same autoDraftRef suppresses a second draft and re-writes the seen row", async () => {
    const tables = fakePrisma();
    syndicationConfig(tables, { rssEnabled: true, rssFeedUrl: "https://example.com/feed.xml" });
    tables.socialPost.rows.push({
      id: "post-old", organizationId: "org-1", autoDraftKind: "rss_feed", autoDraftRef: "rss:post-101",
      status: "draft", createdAt: new Date(Date.now() - 3 * 86_400_000),
    });
    const { svc } = makeSweep(tables);
    svc.fetchFeedText = async () => RSS_XML;
    const out = await svc.runSyndicationSweep("org-1");
    expect(tables.socialPost.rows.filter((p: any) => p.autoDraftRef === "rss:post-101")).toHaveLength(1);
    expect(out.rssCreated).toBe(1); // only the second feed item
    expect(tables.socialSyndicationSeen.rows.some((r: any) => r.externalId === "post-101")).toBe(true);
  });

  it("daily cap already full → no draft and the item does NOT enter seen (retried later)", async () => {
    const tables = fakePrisma();
    syndicationConfig(tables, { rssEnabled: true, rssFeedUrl: "https://example.com/feed.xml", maxDraftsPerDay: 1 });
    tables.socialPost.rows.push({
      id: "post-today", organizationId: "org-1", autoDraftKind: "sale", autoDraftRef: "promo-1",
      status: "draft", createdAt: new Date(),
    });
    const { svc } = makeSweep(tables);
    svc.fetchFeedText = async () => RSS_XML;
    const out = await svc.runSyndicationSweep("org-1");
    expect(out.rssCreated).toBe(0);
    expect(tables.socialPost.rows).toHaveLength(1);
    expect(tables.socialSyndicationSeen.rows).toHaveLength(0);
  });

  it("cap reached mid-run stops the run; the remaining items stay unseen", async () => {
    const tables = fakePrisma();
    syndicationConfig(tables, { rssEnabled: true, rssFeedUrl: "https://example.com/feed.xml", maxDraftsPerDay: 1 });
    const { svc } = makeSweep(tables);
    svc.fetchFeedText = async () => RSS_XML;
    const out = await svc.runSyndicationSweep("org-1");
    expect(out.rssCreated).toBe(1);
    expect(tables.socialSyndicationSeen.rows.map((r: any) => r.externalId)).toEqual(["post-101"]);
  });
});

describe("SN8 SocialSyndicationService — YouTube drafts + error isolation", () => {
  it("new uploads become youtube_new drafts with the watch URL + seen rows", async () => {
    const tables = fakePrisma();
    syndicationConfig(tables, { youtubeEnabled: true });
    const { svc } = makeSweep(tables);
    const seenAccounts: string[] = [];
    svc.listYouTubeUploads = async (_org: string, account: any) => {
      seenAccounts.push(account.id);
      return [{ videoId: "vid-9", title: "Launch Video", publishedAt: "2026-10-15T08:00:00Z" }];
    };
    const out = await svc.runSyndicationSweep("org-1");
    expect(out).toEqual({ rssCreated: 0, youtubeCreated: 1, errors: [] });
    expect(seenAccounts).toEqual(["acct-yt"]);
    expect(tables.socialPost.rows[0]).toMatchObject({
      caption: "Launch Video",
      linkUrl: "https://www.youtube.com/watch?v=vid-9",
      status: "draft",
      autoDraftKind: "youtube_new",
      autoDraftRef: "yt:vid-9",
      socialAccountId: "acct-page",
      createdById: "system",
    });
    expect(tables.socialSyndicationSeen.rows.map((r: any) => [r.source, r.externalId])).toEqual([["youtube", "vid-9"]]);
  });

  it("a feed fetch failure is recorded verbatim and the YouTube branch still runs", async () => {
    const tables = fakePrisma();
    syndicationConfig(tables, { rssEnabled: true, youtubeEnabled: true, rssFeedUrl: "https://example.com/feed.xml" });
    const { svc } = makeSweep(tables);
    svc.fetchFeedText = async () => { throw new Error("feed boom 522"); };
    svc.listYouTubeUploads = async () => [{ videoId: "vid-1", title: "Launch Video", publishedAt: null }];
    const out = await svc.runSyndicationSweep("org-1");
    expect(out.errors).toEqual([{ source: "rss", error: "feed boom 522" }]);
    expect(out.rssCreated).toBe(0);
    expect(out.youtubeCreated).toBe(1);
    expect(tables.socialPost.rows[0].status).toBe("draft");
  });

  it("a YouTube account failure is recorded verbatim and the RSS branch's drafts still stand", async () => {
    const tables = fakePrisma();
    syndicationConfig(tables, { rssEnabled: true, youtubeEnabled: true, rssFeedUrl: "https://example.com/feed.xml" });
    const { svc } = makeSweep(tables);
    svc.fetchFeedText = async () => RSS_XML;
    svc.listYouTubeUploads = async () => { throw new Error("quotaExceeded"); };
    const out = await svc.runSyndicationSweep("org-1");
    expect(out.errors).toEqual([{ source: "youtube", error: "quotaExceeded" }]);
    expect(out.rssCreated).toBe(2);
    expect(out.youtubeCreated).toBe(0);
  });
});

// ---------- automation wiring ----------

describe("SN8 automation — social_syndication_sweep", () => {
  it("the job type + template exist (org target, 60 minutes, drafts-only description)", () => {
    expect((JOB_TYPES as readonly string[]).includes("social_syndication_sweep")).toBe(true);
    const tpl = JOB_TEMPLATES.find((t) => t.key === "social_syndication_sweep");
    expect(tpl).toBeDefined();
    expect(tpl!.type).toBe("social_syndication_sweep");
    expect(tpl!.targetKind).toBe("org");
    expect(tpl!.intervalMinutes).toBe(60);
    expect(tpl!.descriptionBn).toContain("Draft");
    expect(tpl!.descriptionBn).toContain("Publish হবে না");
  });

  it("executeJob dispatches to runSyndicationSweep; without the service it is a BadRequest", async () => {
    const fake: any = { runSyndicationSweep: jest.fn(async () => ({ rssCreated: 1, youtubeCreated: 0, errors: [] })) };
    const svc: any = Object.create(AutomationService.prototype);
    svc.socialSyndication = fake;
    const out = await svc.executeJob({ organizationId: "org-1", createdById: "u1", type: "social_syndication_sweep" });
    expect(out).toEqual({ rssCreated: 1, youtubeCreated: 0, errors: [] });
    expect(fake.runSyndicationSweep).toHaveBeenCalledWith("org-1");

    const bare: any = Object.create(AutomationService.prototype);
    await expect(bare.executeJob({ organizationId: "org-1", createdById: "u1", type: "social_syndication_sweep" }))
      .rejects.toMatchObject({ code: "automation.socialSyndicationServiceIsNotAvailable" });
  });
});
