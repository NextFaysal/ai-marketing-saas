/**
 * GC23 — the /v1 alias for the documented public API.
 *
 * The public storefront / landing / tracking routes have always
 * been served unversioned (`/public/shop/*`, `/public/landing/*`,
 * `/tracking/*`). The published API is versioned as v1: requests
 * under the three documented /v1 prefixes are rewritten to the
 * unversioned routes BEFORE Nest routing, so both spellings serve
 * the same handlers and the unversioned routes stay untouched for
 * every existing integration. ONLY these prefixes are rewritten —
 * `/v1/...` anywhere else is NOT an alias and 404s as before.
 */
const PREFIX_MAP: Array<readonly [string, string]> = [
  ["/v1/public/shop", "/public/shop"],
  ["/v1/public/landing", "/public/landing"],
  ["/v1/tracking", "/tracking"],
];

export function rewriteV1Url(url: string): string {
  const q = url.indexOf("?");
  const path = q >= 0 ? url.slice(0, q) : url;
  const query = q >= 0 ? url.slice(q) : "";
  for (const [from, to] of PREFIX_MAP) {
    if (path === from) return to + query;
    if (path.startsWith(`${from}/`)) return to + path.slice(from.length) + query;
  }
  return url;
}

/** Express-style middleware, registered in main.ts before Nest
 * routing takes over the request. */
export function v1AliasMiddleware(req: any, _res: any, next: () => void): void {
  if (typeof req?.url === "string") req.url = rewriteV1Url(req.url);
  next();
}
