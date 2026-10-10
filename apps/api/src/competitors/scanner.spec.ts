import { parseRobotsDisallows, isPathAllowed, extractProductData, extractSitemapUrls } from "./website-scanner";
import { AdLibraryClient, normalizeAd } from "./ad-library.client";

describe("robots parsing", () => {
  const robots = `User-agent: *
Disallow: /admin/
Disallow: /checkout

User-agent: Googlebot
Disallow: /private/`;
  it("collects rules for * but not other agents' private rules", () => {
    const rules = parseRobotsDisallows(robots);
    expect(rules).toContain("/admin/");
    expect(rules).not.toContain("/private/");
  });
  it("blocks disallowed paths only", () => {
    const rules = parseRobotsDisallows(robots);
    expect(isPathAllowed("/admin/panel", rules)).toBe(false);
    expect(isPathAllowed("/products/shirt", rules)).toBe(true);
  });
});

describe("extractProductData", () => {
  it("reads JSON-LD product offers", () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Product","name":"Handloom Jamdani Saree","offers":{"@type":"Offer","price":"4500","priceCurrency":"BDT"}}</script></head></html>`;
    const p = extractProductData(html, "https://shop.example/products/saree");
    expect(p).toMatchObject({ name: "Handloom Jamdani Saree", priceMinor: "450000", currency: "BDT" });
  });
  it("falls back to OpenGraph price tags", () => {
    const html = `<html><head><meta property="og:title" content="Leather Wallet"><meta property="product:price:amount" content="1250.50"><meta property="product:price:currency" content="BDT"></head></html>`;
    const p = extractProductData(html, "https://shop.example/p/wallet");
    expect(p).toMatchObject({ name: "Leather Wallet", priceMinor: "125050" });
  });
  it("returns null when no price is published (nothing is invented)", () => {
    expect(extractProductData("<html><head><title>No prices here</title></head></html>", "https://x.example")).toBeNull();
  });
  it("extracts same-host sitemap urls with a cap", () => {
    const xml = `<urlset><url><loc>https://shop.example/products/a</loc></url><url><loc>https://other.example/products/b</loc></url><url><loc>https://shop.example/sitemap_products.xml</loc></url></urlset>`;
    expect(extractSitemapUrls(xml, "shop.example", 10)).toEqual(["https://shop.example/products/a"]);
  });
});

describe("AdLibrary normalize + client", () => {
  it("normalizes an archive item; no stop time means active", () => {
    const ad = normalizeAd({
      id: "987", page_id: "123", page_name: "Rival Shop",
      ad_delivery_start_time: "2026-09-01T00:00:00+0000",
      publisher_platforms: ["facebook", "instagram"],
      ad_creative_bodies: ["Big sale!"], ad_creative_link_url: "https://rival.example/sale",
      ad_snapshot_url: "https://www.facebook.com/ads/library/?id=987",
    });
    expect(ad).toMatchObject({ externalAdId: "987", isActive: true, creativeText: "Big sale!", pageName: "Rival Shop" });
    expect(ad.startedAt?.toISOString()).toContain("2026-09-01");
  });
  it("client builds a page-id search and paginates safely on graph.facebook.com only", async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      urls.push(url);
      if (urls.length === 1) return { ok: true, status: 200, json: async () => ({ data: [{ id: "1", ad_delivery_start_time: "2026-10-01" }], paging: { next: "https://graph.facebook.com/v21.0/ads_archive?after=x" } }) } as any;
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "2" }] }) } as any;
    };
    const client = new AdLibraryClient("tok", fetchFn as any);
    const ads = await client.searchAds({ pageId: "555", countries: ["BD"] });
    expect(ads.map((a) => a.externalAdId)).toEqual(["1", "2"]);
    expect(urls[0]).toContain("search_page_ids");
  });
  it("off-domain paging links are never followed", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "1" }], paging: { next: "https://evil.example/steal" } }) }) as any;
    const client = new AdLibraryClient("tok", fetchFn as any);
    const ads = await client.searchAds({ searchTerms: "saree", countries: ["BD"] });
    expect(ads).toHaveLength(1);
  });
});
