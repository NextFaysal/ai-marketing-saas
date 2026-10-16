import { describe, expect, it } from "vitest";
import { CDN_IMAGE_WIDTHS, cdnImageUrl, cdnSrcSet, isCdnImageUrl } from "./cdn-image";

const CDN = "https://media.qosprey.com/org-1/product/p1/abc.png";

describe("cdn-image (RB5/RM6)", () => {
  it("recognises only our media CDN host", () => {
    expect(isCdnImageUrl(CDN)).toBe(true);
    expect(isCdnImageUrl("https://media.qosprey.com/x.jpg")).toBe(true);
    expect(isCdnImageUrl("https://shopify-cdn.example.com/x.jpg")).toBe(false);
    expect(isCdnImageUrl("https://media.qosprey.com.evil.example/x.jpg")).toBe(false);
    expect(isCdnImageUrl("/public/branding/org-1/logo")).toBe(false);
    expect(isCdnImageUrl("blob:https://app.qosprey.com/1234")).toBe(false);
    expect(isCdnImageUrl(null)).toBe(false);
    expect(isCdnImageUrl(undefined)).toBe(false);
    expect(isCdnImageUrl("")).toBe(false);
  });

  it("builds the transformation URL for a CDN src", () => {
    expect(cdnImageUrl(CDN, 640)).toBe(
      `https://media.qosprey.com/cdn-cgi/image/width=640,quality=85,format=auto/${CDN}`,
    );
    expect(cdnImageUrl(CDN, 320)).toContain("width=320,quality=85,format=auto/");
  });

  it("returns non-CDN src unchanged from cdnImageUrl", () => {
    const ext = "https://cdn.shopify.com/s/files/1/photo.jpg";
    expect(cdnImageUrl(ext, 640)).toBe(ext);
    expect(cdnImageUrl("/relative/path.png", 640)).toBe("/relative/path.png");
  });

  it("builds a srcset over the default preset widths for CDN src", () => {
    const set = cdnSrcSet(CDN);
    expect(set).toBeDefined();
    for (const w of CDN_IMAGE_WIDTHS) {
      expect(set).toContain(`width=${w},quality=85,format=auto/${CDN} ${w}w`);
    }
    expect(set!.split(", ").length).toBe(CDN_IMAGE_WIDTHS.length);
  });

  it("honours a custom width list and returns undefined srcset for non-CDN src", () => {
    expect(cdnSrcSet(CDN, [200, 400])).toBe(
      `${cdnImageUrl(CDN, 200)} 200w, ${cdnImageUrl(CDN, 400)} 400w`,
    );
    expect(cdnSrcSet("https://example.com/x.jpg")).toBeUndefined();
    expect(cdnSrcSet("/local.png")).toBeUndefined();
  });

  it("rounds and floors the width", () => {
    expect(cdnImageUrl(CDN, 640.4)).toContain("width=640");
    expect(cdnImageUrl(CDN, 0)).toContain("width=1");
  });
});
