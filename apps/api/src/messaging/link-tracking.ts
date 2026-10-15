import { createHmac, timingSafeEqual } from "crypto";

/**
 * MS5 — broadcast link tracking: UTM append + signed redirect
 * wrap. The token follows unsubscribe-token.ts exactly (HMAC-
 * SHA256 over the base64url payload, JWT_SECRET, timingSafeEqual)
 * with purpose "msg-link". It carries everything the public
 * redirect endpoint needs — org, broadcast, recipient key and the
 * FINAL url (UTM already applied) — so verification is stateless.
 * Long expiry (1 year): the link rides in already-sent mail/SMS
 * and must keep working when the recipient finds it months later.
 *
 * The redirect target is the API itself
 * (`${API_PUBLIC_URL}/public/messaging/redirect/:token`): the
 * web's /r route is already taken by public reports, so no web
 * route is involved (API_PUBLIC_URL precedent:
 * payments/platform-config).
 */
export interface LinkTokenPayload {
  purpose: "msg-link";
  orgId: string;
  broadcastId: string;
  recipientKey: string;
  url: string;
  exp: number;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not configured");
  return s;
}
function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function issueLinkToken(input: { orgId: string; broadcastId: string; recipientKey: string; url: string }): string {
  const body: LinkTokenPayload = {
    purpose: "msg-link",
    orgId: input.orgId,
    broadcastId: input.broadcastId,
    recipientKey: input.recipientKey,
    url: input.url,
    exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyLinkToken(token: string): LinkTokenPayload | null {
  try {
    const [encoded, sig] = String(token).split(".");
    if (!encoded || !sig) return null;
    const expected = sign(encoded);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LinkTokenPayload;
    if (body.purpose !== "msg-link" || !body.orgId || !body.broadcastId || !body.url) return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

/** The API's public base (same expression as payments /
 * platform-config / admin). */
export function apiPublicUrl(): string {
  return (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

/** The one link pattern used by the rewrite + compose-check. */
export const BROADCAST_LINK_RE = /https?:\/\/[^\s<>"')\]]+/g;

export function findLinks(text: string): string[] {
  return String(text ?? "").match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
}

/**
 * Append the broadcast UTM parameters to a URL. A parameter that
 * is already present is NEVER duplicated or overwritten — the
 * merchant's own tracking wins. An unparseable URL is returned
 * unchanged.
 */
export function appendUtm(url: string, broadcastId: string, channel: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("utm_source")) parsed.searchParams.set("utm_source", channel);
    if (!parsed.searchParams.has("utm_medium")) parsed.searchParams.set("utm_medium", "broadcast");
    if (!parsed.searchParams.has("utm_campaign")) parsed.searchParams.set("utm_campaign", broadcastId);
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Rewrite every http/https link in a broadcast body: UTM first,
 * then wrap in the signed redirect URL. If a token cannot be
 * signed (JWT_SECRET unset — an environment where auth itself
 * cannot work), the UTM'd URL is sent unwrapped rather than
 * crashing the send loop (the unsubscribe-footer discipline).
 */
export function rewriteBroadcastLinks(text: string, ctx: { orgId: string; broadcastId: string; channel: string; recipientKey: string }): string {
  return String(text ?? "").replace(/https?:\/\/[^\s<>"')\]]+/g, (raw) => {
    const utmUrl = appendUtm(raw, ctx.broadcastId, ctx.channel);
    try {
      const token = issueLinkToken({ orgId: ctx.orgId, broadcastId: ctx.broadcastId, recipientKey: ctx.recipientKey, url: utmUrl });
      return `${apiPublicUrl()}/public/messaging/redirect/${token}`;
    } catch {
      return utmUrl;
    }
  });
}
