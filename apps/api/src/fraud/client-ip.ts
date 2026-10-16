/**
 * GB3 (GC9): the client IP as seen by the API, for the checkout
 * gate's blocked-IP check and the fraud attempt log.
 *
 * Honest note: XFF is the edge-proxy signal in this deployment
 * (Dokploy/Traefik terminates the public connection and forwards
 * the original address in x-forwarded-for); it is spoofable if
 * the API is exposed directly, bypassing the proxy. The attempt
 * log records what was used — it is a signal, not proof.
 */
export function clientIpFromRequest(req: any): string | null {
  try {
    const headers = req?.headers ?? {};
    const raw = headers["x-forwarded-for"] ?? headers["X-Forwarded-For"];
    const headerValue = Array.isArray(raw) ? raw.join(",") : raw;
    if (typeof headerValue === "string" && headerValue.trim()) {
      const first = headerValue.split(",")[0]?.trim();
      if (first) return first;
    }
    return req?.ip ?? null;
  } catch {
    return null;
  }
}
