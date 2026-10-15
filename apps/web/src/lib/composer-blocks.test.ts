import { describe, expect, it } from "vitest";
import { couponSnippetHtml, couponSnippetText, escapeHtml } from "./composer-blocks";

describe("coupon snippets (web mirror of the API composer-blocks)", () => {
  it("builds the text snippet with and without a label", () => {
    expect(couponSnippetText("EID20")).toBe("কুপন কোড: EID20");
    expect(couponSnippetText("EID20", "ঈদ অফার")).toBe("কুপন কোড: EID20 — ঈদ অফার");
  });
  it("builds the HTML snippet and escapes the code and label", () => {
    expect(couponSnippetHtml("EID20")).toBe("<p>কুপন কোড: <strong>EID20</strong></p>");
    expect(couponSnippetHtml("<b>", "a & b")).toBe("<p>কুপন কোড: <strong>&lt;b&gt;</strong> — a &amp; b</p>");
  });
  it("escapeHtml escapes the four markup characters", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
