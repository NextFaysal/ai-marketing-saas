import { Injectable } from "@nestjs/common";
import "reflect-metadata";
import { PublicShopController } from "../storefront/storefront.controller";
import { PublicProductReviewsController } from "../orders/product-reviews.controller";
import { LandingsPublicController } from "../landings/landings-public.controller";
import { TrackingController } from "../tracking/tracking.controller";

/**
 * GC23 — public API documentation.
 *
 * The OpenAPI document is BUILT BY INTROSPECTION of the four
 * public controllers' Nest metadata — never hand-typed — so the
 * published paths/methods cannot silently drift from the code:
 * the drift-guard spec (gb9-public-docs.spec.ts) freezes the
 * current route inventory and fails the moment a route is added,
 * renamed or removed without the inventory being regenerated.
 *
 * Hand-written content is limited to per-route summaries and the
 * two request schemas that are trivially known (storefront
 * checkout + order tracking, mirroring CheckoutDto /
 * TrackLookupDto). Everything else documents its parameters
 * (from the route template) and a generic JSON response.
 *
 * The same routes are also reachable under the /v1 alias
 * (see v1-alias.ts); the document lists the canonical unversioned
 * paths and states the alias in its description.
 */

export const PUBLIC_API_VERSION = "1.0.0";

/** Nest's RequestMethod enum values (verified against
 * @nestjs/common 10.4: GET=0, POST=1, PUT=2, DELETE=3, PATCH=4,
 * ALL=5, OPTIONS=6, HEAD=7, SEARCH=8). */
const REQUEST_METHOD_NAMES: Record<number, string> = {
  0: "get", 1: "post", 2: "put", 3: "delete", 4: "patch", 5: "all", 6: "options", 7: "head", 8: "search",
};

export interface PublicRoute {
  method: string; // lowercase http method
  path: string; // Nest template form, e.g. /public/shop/:orgSlug/checkout
  controller: string;
  handler: string;
}

/** The controllers whose routes make up the public API, in
 * document order. StorefrontPublicController = the FIRST
 * @Controller("public/shop") class in storefront.controller.ts
 * (PublicShopController). */
export const PUBLIC_CONTROLLERS: Array<{ name: string; cls: any; tag: string }> = [
  { name: "StorefrontPublicController", cls: PublicShopController, tag: "Storefront" },
  { name: "ProductReviewsPublicController", cls: PublicProductReviewsController, tag: "Storefront" },
  { name: "LandingsPublicController", cls: LandingsPublicController, tag: "Landing pages" },
  { name: "TrackingController", cls: TrackingController, tag: "Tracking" },
];

/** Read Nest route metadata off one controller class. */
export function introspectController(cls: any): PublicRoute[] {
  const base = String(Reflect.getMetadata("path", cls) ?? "");
  const routes: PublicRoute[] = [];
  const proto = cls.prototype;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor") continue;
    const fn = (proto as any)[name];
    if (typeof fn !== "function") continue;
    const path = Reflect.getMetadata("path", fn);
    const method = Reflect.getMetadata("method", fn);
    if (path === undefined || method === undefined) continue;
    const methodName = REQUEST_METHOD_NAMES[Number(method)] ?? String(method);
    const full = `/${[base, String(path)].filter((s) => s && s !== "/").join("/")}`.replace(/\/{2,}/g, "/");
    routes.push({ method: methodName, path: full, controller: cls.name, handler: name });
  }
  return routes;
}

export function introspectPublicRoutes(): PublicRoute[] {
  const out: PublicRoute[] = [];
  for (const { cls } of PUBLIC_CONTROLLERS) out.push(...introspectController(cls));
  return out;
}

/** Hand-written summaries for the routes whose purpose is known;
 * any route without an entry gets a factual generic summary. */
const SUMMARIES: Record<string, string> = {
  "GET /public/shop/by-domain/:domain": "Resolve a shop by its custom domain",
  "GET /public/shop/:orgSlug": "Get the public shop (branding, storefront settings) for an organization slug",
  "GET /public/shop/:orgSlug/brands/:brandSlug": "Get one brand page of the shop",
  "GET /public/shop/:orgSlug/flash-sales": "List the shop's active flash sales",
  "GET /public/shop/:orgSlug/products/:productSlug": "Get one product's public detail",
  "GET /public/shop/:orgSlug/pages/:pageSlug": "Get one storefront CMS page",
  "GET /public/shop/:orgSlug/popup": "Get the shop's active popup, if any",
  "POST /public/shop/:orgSlug/popup-event": "Record a popup impression / click event",
  "POST /public/shop/:orgSlug/contact": "Submit the shop contact form",
  "GET /public/shop/:orgSlug/pickup-points": "List pickup points for the shop",
  "POST /public/shop/:orgSlug/cart": "Create a cart (returns the cart token)",
  "GET /public/shop/:orgSlug/cart": "Get the current cart (x-cart-token header)",
  "PATCH /public/shop/:orgSlug/cart": "Update cart lines (x-cart-token header)",
  "POST /public/shop/:orgSlug/cart/bundle": "Add a bundle to the cart",
  "POST /public/shop/:orgSlug/cart/contact": "Attach contact details to the cart",
  "POST /public/shop/:orgSlug/quote": "Request a quote for the cart",
  "POST /public/shop/:orgSlug/checkout": "Place an order from a cart (COD / manual payment methods)",
  "POST /public/shop/:orgSlug/auth/request-otp": "Request an OTP for shop account sign-in",
  "POST /public/shop/:orgSlug/auth/verify": "Verify an OTP and open a shop account session",
  "POST /public/shop/:orgSlug/auth/logout": "Close the shop account session",
  "GET /public/shop/:orgSlug/account/me": "Get the signed-in shopper's profile",
  "PATCH /public/shop/:orgSlug/account/profile": "Update the signed-in shopper's profile",
  "GET /public/shop/:orgSlug/account/orders": "List the signed-in shopper's orders",
  "GET /public/shop/:orgSlug/account/orders/:orderId": "Get one of the signed-in shopper's orders",
  "POST /public/shop/:orgSlug/account/orders/:orderId/reorder": "Reorder a previous order into a new cart",
  "GET /public/shop/:orgSlug/account/addresses": "List the signed-in shopper's saved addresses",
  "POST /public/shop/:orgSlug/account/addresses": "Save an address",
  "PATCH /public/shop/:orgSlug/account/addresses/:addressId": "Update a saved address",
  "DELETE /public/shop/:orgSlug/account/addresses/:addressId": "Delete a saved address",
  "GET /public/shop/:orgSlug/account/wishlist": "Get the signed-in shopper's wishlist",
  "POST /public/shop/:orgSlug/account/wishlist/merge": "Merge a guest wishlist into the account wishlist",
  "POST /public/shop/:orgSlug/account/wishlist": "Add a product to the wishlist",
  "DELETE /public/shop/:orgSlug/account/wishlist/:productId": "Remove a product from the wishlist",
  "POST /public/shop/:orgSlug/track": "Track an order by order number + phone (rate-limited; the pair is the credential)",
  "POST /public/shop/:orgSlug/track/digital-access": "Reveal digital download links for a delivered order (order number + phone)",
  "POST /public/shop/:orgSlug/gift-cards/balance": "Check a gift card's balance by code (rate-limited; generic error for unknown codes)",
  "POST /public/shop/:orgSlug/stock-alerts": "Subscribe to a back-in-stock alert",
  "POST /public/shop/:orgSlug/track/returns": "Look up return-request status for an order (order number + phone)",
  "GET /public/shop/:orgSlug/products/:productSlug/questions": "List public questions for a product",
  "POST /public/shop/:orgSlug/products/:productSlug/questions": "Ask a public question about a product",
  "GET /public/shop/:orgSlug/products/:productSlug/reviews": "List approved public reviews for a product",
  "GET /public/landing/:slug": "Get a published landing page",
  "POST /public/landing/:slug/view": "Record a landing page view",
  "POST /public/landing/:slug/checkout-started": "Record a landing checkout start",
  "POST /public/landing/:slug/order": "Place an order from a landing page",
  "POST /public/landing/:slug/order/:orderId/upsell": "Accept / decline a landing post-purchase upsell",
  "POST /tracking/events": "Ingest a storefront tracking event",
};

const CHECKOUT_SCHEMA = {
  type: "object",
  required: ["cartToken", "name", "phone", "address", "district"],
  properties: {
    cartToken: { type: "string", description: "Cart token issued by POST /public/shop/:orgSlug/cart" },
    name: { type: "string" },
    phone: { type: "string" },
    address: { type: "string" },
    district: { type: "string" },
    couponCode: { type: "string" },
    referralCode: { type: "string" },
    affiliateCode: { type: "string" },
    paymentMethod: { type: "string", enum: ["cod", "bkash", "nagad"] },
    note: { type: "string" },
  },
};

const TRACK_SCHEMA = {
  type: "object",
  required: ["phone", "orderNumber"],
  properties: {
    phone: { type: "string" },
    orderNumber: { type: "string" },
  },
};

const REQUEST_SCHEMAS: Record<string, any> = {
  "POST /public/shop/:orgSlug/checkout": CHECKOUT_SCHEMA,
  "POST /public/shop/:orgSlug/track": TRACK_SCHEMA,
  "POST /public/shop/:orgSlug/track/digital-access": TRACK_SCHEMA,
  "POST /public/shop/:orgSlug/track/returns": TRACK_SCHEMA,
};

/** AB8 (AX21) — hand-written Merchant API section.
 *
 * These are AUTHENTICATED developer routes (merchant API key,
 * Bearer scheme), unlike everything else in this document. The
 * GC23 frozen inventory (gb9-public-docs.spec.ts) covers the
 * PUBLIC (unauthenticated) routes only, so the merchant routes
 * are intentionally NOT added to the introspected `paths` above
 * and NOT to the frozen inventory; they are published here as a
 * dedicated `x-merchant-api` section of the generated document,
 * with their own OpenAPI-style paths + the bearer security
 * scheme, so the frozen-inventory drift guard keeps passing
 * exactly as written. */
export const MERCHANT_API_ROUTES: Array<{ method: string; path: string; scope: string; summary: string }> = [
  { method: "get", path: "/v1/merchant/products", scope: "products:read", summary: "List the key's organization's products" },
  { method: "get", path: "/v1/merchant/products/{id}", scope: "products:read", summary: "Get one product of the key's organization" },
  { method: "post", path: "/v1/merchant/products", scope: "products:write", summary: "Create a product in the key's organization" },
  { method: "patch", path: "/v1/merchant/products/{id}", scope: "products:write", summary: "Update one product of the key's organization" },
  { method: "get", path: "/v1/merchant/orders", scope: "orders:read", summary: "List the key's organization's orders (status, from, to, page, pageSize)" },
  { method: "get", path: "/v1/merchant/orders/{id}", scope: "orders:read", summary: "Get one order of the key's organization" },
  { method: "get", path: "/v1/merchant/customers", scope: "customers:read", summary: "List the key's organization's customers (search, page, pageSize)" },
  { method: "get", path: "/v1/merchant/customers/{id}", scope: "customers:read", summary: "Get one customer of the key's organization" },
];

export const MERCHANT_API_SECURITY_SCHEME = {
  type: "http",
  scheme: "bearer",
  bearerFormat: "qk_live_<token>",
  description:
    "Merchant API key issued from the dashboard (organizations/:organizationId/merchant-api-keys, OWNER/ADMIN). " +
    "Send it as `Authorization: Bearer qk_live_…` or in the `x-merchant-api-key` header. " +
    "The plaintext is shown exactly once at creation; only its SHA-256 hash is stored. " +
    "The organization is derived from the key — there is no org parameter. " +
    "Each route requires the scope listed for it; a key without the scope gets 403 naming the missing scope, " +
    "and calls count against the plan's daily API limit (429 when reached).",
};

export function merchantApiSection(): any {
  const paths: Record<string, any> = {};
  for (const r of MERCHANT_API_ROUTES) {
    paths[r.path] = paths[r.path] ?? {};
    const operation: any = {
      tags: ["Merchant API"],
      summary: r.summary,
      security: [{ MerchantApiKeyAuth: [r.scope] }],
      responses: {
        "200": { description: "Success", content: { "application/json": { schema: { type: "object" } } } },
        "401": { description: "Missing, invalid or revoked merchant API key" },
        "403": { description: `The key lacks the required scope (${r.scope})` },
        "429": { description: "The plan's daily API limit has been reached" },
      },
    };
    if (r.path.includes("{id}")) {
      operation.parameters = [{ name: "id", in: "path", required: true, schema: { type: "string" } }];
    }
    paths[r.path][r.method] = operation;
  }
  return {
    description:
      "Merchant Developer API (AB8 / AX21): authenticated, versioned /v1/merchant routes for products, orders and customers. " +
      "Authentication is a merchant API key (see the MerchantApiKeyAuth bearer security scheme); every route requires its listed scope. " +
      "The GC23 frozen route inventory covers PUBLIC (unauthenticated) routes only, so these authenticated routes are described in this section " +
      "but intentionally NOT in the frozen inventory or in the introspected public `paths`.",
    securityScheme: MERCHANT_API_SECURITY_SCHEME,
    scopes: ["products:read", "products:write", "orders:read", "customers:read"],
    paths,
  };
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function pathParams(path: string) {
  const names = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  return names.map((name) => ({
    name, in: "path", required: true, schema: { type: "string" },
  }));
}

@Injectable()
export class PublicDocsService {
  private cachedDoc: any | null = null;

  buildOpenApiDoc(): any {
    const paths: Record<string, any> = {};
    for (const { cls, tag } of PUBLIC_CONTROLLERS) {
      for (const route of introspectController(cls)) {
        const key = `${route.method.toUpperCase()} ${route.path}`;
        const openApiPath = toOpenApiPath(route.path);
        paths[openApiPath] = paths[openApiPath] ?? {};
        const operation: any = {
          tags: [tag],
          summary: SUMMARIES[key] ?? `Public endpoint (${route.controller}.${route.handler})`,
          operationId: `${route.controller}_${route.handler}`,
          parameters: pathParams(route.path),
          responses: {
            "200": {
              description: "Success",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        };
        const requestSchema = REQUEST_SCHEMAS[key];
        if (requestSchema) {
          operation.requestBody = {
            required: true,
            content: { "application/json": { schema: requestSchema } },
          };
        }
        paths[openApiPath][route.method] = operation;
      }
    }
    return {
      openapi: "3.0.3",
      info: {
        title: "Qosprey Public API",
        version: PUBLIC_API_VERSION,
        description:
          "Public storefront, landing-page and tracking API. " +
          `Version ${PUBLIC_API_VERSION}: every route below is also reachable under the /v1 alias ` +
          "(/v1/public/shop/* → /public/shop/*, /v1/public/landing/* → /public/landing/*, /v1/tracking/* → /tracking/*); " +
          "the unversioned paths remain canonical and unchanged for existing integrations. " +
          "Authenticated developer routes live in the separate Merchant API section (x-merchant-api) of this document: " +
          "they require a merchant API key (bearer scheme MerchantApiKeyAuth) and per-route scopes, and — because the " +
          "GC23 frozen inventory covers PUBLIC (unauthenticated) routes only — they are intentionally not part of the " +
          "frozen inventory or of the introspected public paths below.",
      },
      tags: [
        { name: "Storefront", description: "Public shop, cart, checkout, shopper account, reviews and Q&A" },
        { name: "Landing pages", description: "Published landing pages and their order flow" },
        { name: "Tracking", description: "Storefront event ingestion" },
        { name: "Merchant API", description: "Authenticated /v1/merchant developer routes — see the x-merchant-api section" },
      ],
      components: {
        securitySchemes: {
          MerchantApiKeyAuth: MERCHANT_API_SECURITY_SCHEME,
        },
      },
      "x-merchant-api": merchantApiSection(),
      paths,
    };
  }

  /** Built once, cached in memory (first request pays). */
  getOpenApiDoc(): any {
    if (!this.cachedDoc) this.cachedDoc = this.buildOpenApiDoc();
    return this.cachedDoc;
  }

  getDocsHtml(): string {
    const doc = this.getOpenApiDoc();
    const routeCount = Object.values(doc.paths).reduce(
      (n: number, p: any) => n + Object.keys(p).length, 0,
    );
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Qosprey Public API — v${PUBLIC_API_VERSION}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; line-height: 1.6">
<h1>Qosprey Public API</h1>
<p>Version <strong>${PUBLIC_API_VERSION}</strong> · ${routeCount} public routes (storefront, landing pages, tracking).</p>
<p>Machine-readable specification: <a href="/public/docs/openapi.json">/public/docs/openapi.json</a> (OpenAPI 3.0).</p>
<p>Authenticated developer routes (Merchant API, <code>/v1/merchant/*</code>) are documented in the
<code>x-merchant-api</code> section of the OpenAPI document; they require a merchant API key and are
intentionally not part of the public route count above.</p>
<p>Every documented route is also reachable under the <code>/v1</code> alias:
<code>/v1/public/shop/*</code>, <code>/v1/public/landing/*</code> and <code>/v1/tracking/*</code>
rewrite to the canonical unversioned paths. Unversioned integrations are unaffected.</p>
</body></html>`;
  }
}
