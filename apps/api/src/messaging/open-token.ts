import { createHmac, timingSafeEqual } from "crypto";

/**
 * MS7 — email open tracking token. Follows link-tracking.ts
 * exactly (HMAC-SHA256 over the base64url payload, JWT_SECRET,
 * timingSafeEqual) with purpose "msg-open". The token carries
 * org + broadcast + the MS5 recipientKey definition
 * (`${type}:${id}` or `${type}:${channelAddress}`) so the public
 * pixel endpoint can find the matching MessageDelivery
 * statelessly. Long expiry (1 year): the pixel rides in
 * already-sent mail and must keep working months later.
 */
export interface OpenTokenPayload {
  purpose: "msg-open";
  orgId: string;
  broadcastId: string;
  recipientKey: string;
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

export function issueOpenToken(input: { orgId: string; broadcastId: string; recipientKey: string }): string {
  const body: OpenTokenPayload = {
    purpose: "msg-open",
    orgId: input.orgId,
    broadcastId: input.broadcastId,
    recipientKey: input.recipientKey,
    exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyOpenToken(token: string): OpenTokenPayload | null {
  try {
    const [encoded, sig] = String(token).split(".");
    if (!encoded || !sig) return null;
    const expected = sign(encoded);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OpenTokenPayload;
    if (body.purpose !== "msg-open" || !body.orgId || !body.broadcastId || !body.recipientKey) return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

/** The 1×1 transparent GIF the pixel endpoint returns. */
export const TRANSPARENT_GIF_BASE64 =
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
