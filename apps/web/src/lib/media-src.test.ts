import { describe, expect, it } from "vitest";
import { mediaSrc } from "./media-src";

describe("mediaSrc (RB4)", () => {
  const API = "https://api.qosprey.com";

  it("prefixes a legacy relative path with the API base", () => {
    expect(mediaSrc(API, "/public/branding/org-1/logo")).toBe("https://api.qosprey.com/public/branding/org-1/logo");
  });

  it("returns an absolute CDN URL untouched (no double prefix)", () => {
    expect(mediaSrc(API, "https://media.qosprey.com/branding/org-1/logo-ab12cd34.png"))
      .toBe("https://media.qosprey.com/branding/org-1/logo-ab12cd34.png");
  });

  it("returns any absolute http(s) URL untouched", () => {
    expect(mediaSrc(API, "http://cdn.example.com/x.jpg")).toBe("http://cdn.example.com/x.jpg");
  });

  it("null/empty stays null", () => {
    expect(mediaSrc(API, null)).toBeNull();
    expect(mediaSrc(API, undefined)).toBeNull();
    expect(mediaSrc(API, "")).toBeNull();
  });
});
