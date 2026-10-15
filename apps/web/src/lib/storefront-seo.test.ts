import { describe, expect, it } from "vitest";
import { buildProductJsonLd, buildShopJsonLd, canonicalShopUrl, jsonLdScript, minorToMajorString } from "./storefront-seo";

const product = {
  name: "Leather Wallet",
  slug: "wallet",
  description: "আসল চামড়া",
  images: ["https://img/1.jpg"],
  imageUrl: "https://img/1.jpg",
  sku: "WAL-1",
  priceMinor: "50000",
  currency: "BDT",
  stockState: "in_stock",
};

describe("minorToMajorString", () => {
  it("converts poisha to taka with two decimals", () => {
    expect(minorToMajorString("50000")).toBe("500.00");
    expect(minorToMajorString("99")).toBe("0.99");
    expect(minorToMajorString("100000")).toBe("1000.00");
  });
});

describe("buildProductJsonLd", () => {
  it("builds Product + Offer from real data only", () => {
    const ld: any = buildProductJsonLd({ base: "https://app.example.com", orgSlug: "my-shop", product });
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe("Leather Wallet");
    expect(ld.sku).toBe("WAL-1");
    expect(ld.offers).toMatchObject({
      "@type": "Offer",
      priceCurrency: "BDT",
      price: "500.00",
      availability: "https://schema.org/InStock",
      url: "https://app.example.com/shop/my-shop/products/wallet",
    });
  });

  it("OMITS aggregateRating entirely when there are no reviews", () => {
    const none: any = buildProductJsonLd({ base: "", orgSlug: "s", product, reviewsSummary: { average: null, count: 0 } });
    expect(none).not.toHaveProperty("aggregateRating");
    const missing: any = buildProductJsonLd({ base: "", orgSlug: "s", product });
    expect(missing).not.toHaveProperty("aggregateRating");
  });

  it("includes aggregateRating only from a real summary with count > 0", () => {
    const ld: any = buildProductJsonLd({ base: "", orgSlug: "s", product, reviewsSummary: { average: 4.5, count: 12 } });
    expect(ld.aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 12 });
  });

  it("availability follows real stock; untracked stock makes no claim", () => {
    const oos: any = buildProductJsonLd({ base: "", orgSlug: "s", product: { ...product, stockState: "out_of_stock" } });
    expect(oos.offers.availability).toBe("https://schema.org/OutOfStock");
    const untracked: any = buildProductJsonLd({ base: "", orgSlug: "s", product: { ...product, stockState: "untracked" } });
    expect(untracked.offers).not.toHaveProperty("availability");
  });
});

describe("buildShopJsonLd", () => {
  it("emits Organization + WebSite with a real search action", () => {
    const [org, site]: any[] = buildShopJsonLd({ base: "https://x.com", orgSlug: "s", shopName: "ShopS", logoUrl: "https://x.com/l.png" });
    expect(org).toMatchObject({ "@type": "Organization", name: "ShopS", url: "https://x.com/shop/s", logo: "https://x.com/l.png" });
    expect(site["@type"]).toBe("WebSite");
    expect(site.potentialAction.target.urlTemplate).toBe("https://x.com/shop/s?q={search_term_string}");
  });
});

describe("canonicalShopUrl / jsonLdScript", () => {
  it("builds canonical shop + product URLs", () => {
    expect(canonicalShopUrl("https://x.com", "s")).toBe("https://x.com/shop/s");
    expect(canonicalShopUrl("", "s", "a b")).toBe("/shop/s/products/a%20b");
  });
  it("escapes < so a name cannot break out of the script tag", () => {
    expect(jsonLdScript({ name: "</script>" })).not.toContain("</script>");
  });
});
