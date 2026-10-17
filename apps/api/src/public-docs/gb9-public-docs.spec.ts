import { PublicDocsService, introspectPublicRoutes, PUBLIC_API_VERSION } from "./public-docs.service";
import { rewriteV1Url } from "./v1-alias";

/**
 * GB9 (GC23) — public API docs drift guard.
 *
 * The OpenAPI document is built by introspecting the four public
 * controllers, so by construction every documented route exists.
 * The REAL guard is the frozen inventory below: it is the exact
 * public route set at GC23 build time. Adding, renaming or
 * removing a public route changes the introspected set and fails
 * this spec until the inventory (and with it the published doc)
 * is deliberately regenerated.
 */
const FROZEN_PUBLIC_ROUTES: string[] = [
  "GET /public/shop/by-domain/:domain",
  // TD (tenant-domain): the web tier's domain-allowlist probe —
  // deliberately added to the frozen inventory with the route
  // (interim-release union, 2026-10-16).
  "GET /public/shop/domain-allowed",
  "GET /public/shop/:orgSlug",
  "GET /public/shop/:orgSlug/brands/:brandSlug",
  "GET /public/shop/:orgSlug/flash-sales",
  // Final-union regeneration (2026-10-17): three public routes added
  // by lines unioned after GC23 — OU8 offers + popup-lead capture and
  // the store-credit account endpoint (storefront.controller). The
  // published doc already counted 61; the inventory is regenerated
  // to match deliberately, per this guard's own rule.
  "GET /public/shop/:orgSlug/offers",
  // AB6 (AX14): cart cross-sell recommendations — deliberately
  // added to the frozen inventory with the route.
  "GET /public/shop/:orgSlug/recommendations",
  "GET /public/shop/:orgSlug/products/:productSlug",
  "GET /public/shop/:orgSlug/pages/:pageSlug",
  // AB6 (AX12): shop blog — deliberately added to the frozen
  // inventory with the routes.
  "GET /public/shop/:orgSlug/blog",
  "GET /public/shop/:orgSlug/blog/:postSlug",
  "GET /public/shop/:orgSlug/popup",
  "POST /public/shop/:orgSlug/popup-lead",
  "POST /public/shop/:orgSlug/popup-event",
  "POST /public/shop/:orgSlug/contact",
  "GET /public/shop/:orgSlug/pickup-points",
  "POST /public/shop/:orgSlug/cart",
  "GET /public/shop/:orgSlug/cart",
  "PATCH /public/shop/:orgSlug/cart",
  "POST /public/shop/:orgSlug/cart/bundle",
  "POST /public/shop/:orgSlug/cart/contact",
  "POST /public/shop/:orgSlug/quote",
  "POST /public/shop/:orgSlug/checkout",
  // AB4 (AX5c): express checkout — deliberately added to the frozen inventory with the route.
  "POST /public/shop/:orgSlug/express-checkout",
  "POST /public/shop/:orgSlug/auth/request-otp",
  "POST /public/shop/:orgSlug/auth/verify",
  "POST /public/shop/:orgSlug/auth/logout",
  "GET /public/shop/:orgSlug/account/me",
  // AB1 (AX1/AX2): the signed-in customer's loyalty surface —
  // deliberately added to the frozen inventory with the route.
  "GET /public/shop/:orgSlug/account/loyalty",
  "GET /public/shop/:orgSlug/account/store-credit",
  "PATCH /public/shop/:orgSlug/account/profile",
  "GET /public/shop/:orgSlug/account/orders",
  "GET /public/shop/:orgSlug/account/orders/:orderId",
  "POST /public/shop/:orgSlug/account/orders/:orderId/reorder",
  "GET /public/shop/:orgSlug/account/addresses",
  "POST /public/shop/:orgSlug/account/addresses",
  "PATCH /public/shop/:orgSlug/account/addresses/:addressId",
  "DELETE /public/shop/:orgSlug/account/addresses/:addressId",
  // MB5 (MX14): the signed-in customer's on-site notification
  // center — deliberately added to the frozen inventory with
  // the routes.
  "GET /public/shop/:orgSlug/account/notifications",
  "POST /public/shop/:orgSlug/account/notifications/read-all",
  "POST /public/shop/:orgSlug/account/notifications/:notificationId/read",
  "GET /public/shop/:orgSlug/account/wishlist",
  "POST /public/shop/:orgSlug/account/wishlist/merge",
  "POST /public/shop/:orgSlug/account/wishlist",
  "DELETE /public/shop/:orgSlug/account/wishlist/:productId",
  "POST /public/shop/:orgSlug/track",
  "POST /public/shop/:orgSlug/track/digital-access",
  // Owner's 7-step marketing suite (main 1526500c): the public
  // NDR-recovery tracking post — deliberately added to the frozen
  // inventory with the route (interim-release union, 2026-10-16).
  "POST /public/shop/:orgSlug/track/ndr-recovery",
  // AB5 (AX9): the signed-token digital download redirect —
  // deliberately added to the frozen inventory with the route.
  "GET /public/shop/:orgSlug/orders/:orderId/digital-download",
  // AB2 (AX3): the public gift-card balance lookup — deliberately
  // added to the frozen inventory with the route.
  "POST /public/shop/:orgSlug/gift-cards/balance",
  "POST /public/shop/:orgSlug/stock-alerts",
  "POST /public/shop/:orgSlug/track/returns",
  "GET /public/shop/:orgSlug/products/:productSlug/questions",
  "POST /public/shop/:orgSlug/products/:productSlug/questions",
  "GET /public/shop/:orgSlug/products/:productSlug/reviews",
  "GET /public/landing/:slug",
  "POST /public/landing/:slug/view",
  "POST /public/landing/:slug/checkout-started",
  "POST /public/landing/:slug/order",
  "POST /public/landing/:slug/order/:orderId/upsell",
  "POST /tracking/events",
];

describe("GB9 public docs — drift guard", () => {
  it("the introspected route set equals the frozen inventory exactly", () => {
    const actual = introspectPublicRoutes().map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(actual).toEqual(FROZEN_PUBLIC_ROUTES);
  });

  it("every documented path+method exists in the introspected route set", () => {
    const doc = new PublicDocsService().buildOpenApiDoc();
    const introspected = new Set(
      introspectPublicRoutes().map(
        (r) => `${r.method} ${r.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`,
      ),
    );
    let documented = 0;
    for (const [path, ops] of Object.entries<any>(doc.paths)) {
      for (const method of Object.keys(ops)) {
        documented++;
        expect(introspected.has(`${method} ${path}`)).toBe(true);
      }
    }
    expect(documented).toBe(FROZEN_PUBLIC_ROUTES.length);
  });

  it("the doc carries the version and all three prefix groups", () => {
    const doc = new PublicDocsService().buildOpenApiDoc();
    expect(doc.openapi).toMatch(/^3\.0/);
    expect(doc.info.version).toBe(PUBLIC_API_VERSION);
    const paths = Object.keys(doc.paths);
    expect(paths.some((p) => p.startsWith("/public/shop"))).toBe(true);
    expect(paths.some((p) => p.startsWith("/public/landing"))).toBe(true);
    expect(paths.some((p) => p.startsWith("/tracking"))).toBe(true);
    expect(doc.info.description).toContain("/v1");
  });

  it("checkout + track operations carry the hand-written request schemas", () => {
    const doc = new PublicDocsService().buildOpenApiDoc();
    const checkout = doc.paths["/public/shop/{orgSlug}/checkout"].post;
    expect(checkout.requestBody.content["application/json"].schema.required)
      .toEqual(expect.arrayContaining(["cartToken", "name", "phone", "address", "district"]));
    const track = doc.paths["/public/shop/{orgSlug}/track"].post;
    expect(track.requestBody.content["application/json"].schema.required)
      .toEqual(expect.arrayContaining(["phone", "orderNumber"]));
    // Path params come from introspection, not hand-typing.
    expect(checkout.parameters).toEqual([
      expect.objectContaining({ name: "orgSlug", in: "path", required: true }),
    ]);
  });

  it("the doc is cached after the first build", () => {
    const svc = new PublicDocsService();
    expect(svc.getOpenApiDoc()).toBe(svc.getOpenApiDoc());
  });
});

describe("GB9 /v1 alias rewrite", () => {
  it("maps the three documented prefixes and preserves the query string", () => {
    expect(rewriteV1Url("/v1/public/shop/acme/checkout")).toBe("/public/shop/acme/checkout");
    expect(rewriteV1Url("/v1/public/shop/acme/track?x=1&y=2")).toBe("/public/shop/acme/track?x=1&y=2");
    expect(rewriteV1Url("/v1/public/landing/summer-sale")).toBe("/public/landing/summer-sale");
    expect(rewriteV1Url("/v1/public/landing/summer-sale/order")).toBe("/public/landing/summer-sale/order");
    expect(rewriteV1Url("/v1/tracking/events")).toBe("/tracking/events");
    expect(rewriteV1Url("/v1/tracking/events?src=web")).toBe("/tracking/events?src=web");
    expect(rewriteV1Url("/v1/public/shop")).toBe("/public/shop");
  });

  it("leaves unversioned and non-public /v1 paths untouched", () => {
    expect(rewriteV1Url("/public/shop/acme")).toBe("/public/shop/acme");
    expect(rewriteV1Url("/tracking/events")).toBe("/tracking/events");
    expect(rewriteV1Url("/v1/organizations/org-1/orders")).toBe("/v1/organizations/org-1/orders");
    expect(rewriteV1Url("/v1/public/shopping/x")).toBe("/v1/public/shopping/x");
    expect(rewriteV1Url("/organizations/org-1/tickets")).toBe("/organizations/org-1/tickets");
  });
});
