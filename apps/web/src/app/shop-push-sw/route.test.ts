import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { buildShopWorkerScript } from "../../lib/shop-sw";

/**
 * ED10 (EB4) — the route stays a thin wrapper: same URL, same
 * registration-critical headers AB7 shipped with, body = the
 * lib-generated script (so ShopPushPrompt's registration of
 * "/shop-push-sw" with scope "/shop/" needs no changes).
 */
describe("shop-push-sw route", () => {
  it("serves the generated script with the AB7 headers", async () => {
    const res = await GET();
    expect(res.headers.get("Content-Type")).toContain("application/javascript");
    expect(res.headers.get("Service-Worker-Allowed")).toBe("/shop/");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    const body = await res.text();
    expect(body).toBe(buildShopWorkerScript());
    expect(body).toContain('addEventListener("push"');
    expect(body).toContain('addEventListener("fetch"');
  });
});
