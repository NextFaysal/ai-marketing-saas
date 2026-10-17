// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// vitest globals are off in this app, so RTL auto-cleanup never runs.
afterEach(() => cleanup());
import { MediaImage } from "./MediaImage";

const CDN = "https://media.qosprey.com/org-1/product/p1/abc.png";
const EXT = "https://cdn.shopify.com/s/files/1/photo.jpg";

function img() {
  return screen.getByRole("img") as HTMLImageElement;
}

describe("MediaImage (ED4)", () => {
  it("CDN src: src is the transformation URL at the largest preset step <= requested width", () => {
    render(<MediaImage src={CDN} alt="পণ্য" width={800} height={800} />);
    // 800 → step 640 (largest preset <= 800)
    expect(img().getAttribute("src")).toBe(
      `https://media.qosprey.com/cdn-cgi/image/width=640,quality=85,format=auto/${CDN}`,
    );
  });

  it("CDN src: exact step and overshoot clamp to presets", () => {
    const { rerender } = render(<MediaImage src={CDN} alt="পণ্য" width={320} height={320} />);
    expect(img().getAttribute("src")).toContain("width=320,quality=85,format=auto/");
    rerender(<MediaImage src={CDN} alt="পণ্য" width={4000} height={4000} />);
    expect(img().getAttribute("src")).toContain("width=1280,quality=85,format=auto/");
  });

  it("CDN src: srcset carries every preset step and sizes defaults to the declared width", () => {
    render(<MediaImage src={CDN} alt="পণ্য" width={640} height={640} />);
    const set = img().getAttribute("srcset") ?? "";
    for (const w of [320, 640, 960, 1280]) {
      expect(set).toContain(`width=${w},quality=85,format=auto/${CDN} ${w}w`);
    }
    expect(img().getAttribute("sizes")).toBe("640px");
  });

  it("CDN src: an explicit sizes prop wins over the default", () => {
    render(<MediaImage src={CDN} alt="পণ্য" width={640} height={640} sizes="(max-width: 768px) 50vw, 320px" />);
    expect(img().getAttribute("sizes")).toBe("(max-width: 768px) 50vw, 320px");
  });

  it("external src: plain img — original src, no srcset/sizes", () => {
    render(<MediaImage src={EXT} alt="বাইরের ছবি" width={640} height={640} />);
    expect(img().getAttribute("src")).toBe(EXT);
    expect(img().getAttribute("srcset")).toBeNull();
    expect(img().getAttribute("sizes")).toBeNull();
  });

  it("data:/blob:/relative srcs also fall back to a plain img", () => {
    const { rerender } = render(<MediaImage src="data:image/png;base64,AAAA" alt="ডেটা" width={100} height={100} />);
    expect(img().getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(img().getAttribute("srcset")).toBeNull();
    rerender(<MediaImage src="blob:https://app.qosprey.com/1234" alt="ব্লব" width={100} height={100} />);
    expect(img().getAttribute("src")).toBe("blob:https://app.qosprey.com/1234");
    rerender(<MediaImage src="/local/logo.png" alt="লোকাল" width={100} height={100} />);
    expect(img().getAttribute("src")).toBe("/local/logo.png");
    expect(img().getAttribute("srcset")).toBeNull();
  });

  it("default loading is lazy with async decoding and no fetchPriority", () => {
    render(<MediaImage src={CDN} alt="পণ্য" width={640} height={640} />);
    expect(img().getAttribute("loading")).toBe("lazy");
    expect(img().getAttribute("decoding")).toBe("async");
    expect(img().getAttribute("fetchpriority")).toBeNull();
  });

  it("priority: eager + fetchPriority=high, never lazy", () => {
    render(<MediaImage src={CDN} alt="হিরো" width={1280} height={720} priority />);
    expect(img().getAttribute("loading")).toBe("eager");
    expect(img().getAttribute("fetchpriority")).toBe("high");
    expect(img().getAttribute("decoding")).toBe("async");
  });

  it("fallback dims: width/height attributes and aspect-ratio style from width/height", () => {
    render(<MediaImage src={EXT} alt="বাইরের ছবি" width={320} height={180} />);
    expect(img().getAttribute("width")).toBe("320");
    expect(img().getAttribute("height")).toBe("180");
    expect(img().style.aspectRatio).toBe("320 / 180");
  });

  it("aspectRatio prop wins over the width/height-derived ratio", () => {
    render(<MediaImage src={EXT} alt="বাইরের ছবি" width={320} height={180} aspectRatio="1/1" />);
    expect(img().style.aspectRatio).toBe("1/1");
  });

  it("aspectRatio alone (no width/height) still reserves the box", () => {
    render(<MediaImage src={EXT} alt="বাইরের ছবি" aspectRatio="16/9" />);
    expect(img().style.aspectRatio).toBe("16/9");
    expect(img().getAttribute("width")).toBeNull();
    expect(img().getAttribute("height")).toBeNull();
  });

  it("className and imgClassName both land on the img", () => {
    render(<MediaImage src={EXT} alt="ছবি" width={100} height={100} className="wrap-cls" imgClassName="img-cls" />);
    expect(img().className).toContain("wrap-cls");
    expect(img().className).toContain("img-cls");
  });

  it("no width on a CDN src: src uses the 640 default step and sizes defaults to 100vw", () => {
    render(<MediaImage src={CDN} alt="পণ্য" />);
    expect(img().getAttribute("src")).toContain("width=640,quality=85,format=auto/");
    expect(img().getAttribute("sizes")).toBe("100vw");
  });
});
