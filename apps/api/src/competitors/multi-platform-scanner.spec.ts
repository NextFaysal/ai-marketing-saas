import { MultiPlatformScanner } from "./multi-platform-scanner";

/**
 * HF1 honesty specs: the scanner only returns what it actually fetched.
 * Platforms without a wired public source return []; a failed fetch is
 * an honest empty result, never a fabricated ad.
 */

const DDG_HTML = `<html><body>
<a class="result__url" href="https://rival.example/shop"><h2 class="result__a">Rival Shop — Official Store</h2></a>
<a class="result__snippet" href="https://rival.example/shop">Best panjabi collection with cash on delivery.</a>
</body></html>`;

describe("MultiPlatformScanner (HF1 honesty)", () => {
  it("TikTok returns [] — no source wired, nothing synthesized", async () => {
    const fetchFn = jest.fn(async () => { throw new Error("must not be called"); });
    const scanner = new MultiPlatformScanner(fetchFn as any);
    await expect(scanner.scanTikTokAds("Rival")).resolves.toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("Bing returns [] — no source wired, nothing synthesized", async () => {
    const fetchFn = jest.fn(async () => { throw new Error("must not be called"); });
    const scanner = new MultiPlatformScanner(fetchFn as any);
    await expect(scanner.scanBingAds("Rival", "rival.example")).resolves.toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("Google network failure returns [] instead of a fallback ad", async () => {
    const scanner = new MultiPlatformScanner((async () => { throw new Error("network blocked"); }) as any);
    await expect(scanner.scanGoogleAds("Rival", "rival.example")).resolves.toEqual([]);
  });

  it("Google non-OK response returns []", async () => {
    const scanner = new MultiPlatformScanner((async () => ({ ok: false, status: 503, text: async () => "" })) as any);
    await expect(scanner.scanGoogleAds("Rival", "rival.example")).resolves.toEqual([]);
  });

  it("Google zero matches returns [] (no fallback invention)", async () => {
    const scanner = new MultiPlatformScanner((async () => ({ ok: true, status: 200, text: async () => "<html><body>no results</body></html>" })) as any);
    await expect(scanner.scanGoogleAds("Rival", "rival.example")).resolves.toEqual([]);
  });

  it("Google results are labeled organic search results with no invented start date", async () => {
    const scanner = new MultiPlatformScanner((async () => ({ ok: true, status: 200, text: async () => DDG_HTML })) as any);
    const ads = await scanner.scanGoogleAds("Rival", "rival.example");
    expect(ads).toHaveLength(1);
    expect(ads[0].creativeText).toContain("[Google Search Result]");
    expect(ads[0].creativeText).not.toContain("[Google Search Ad");
    expect(ads[0].raw).toMatchObject({ sourceType: "organic_search" });
    expect(ads[0].startedAt).toBeUndefined();
  });
});
