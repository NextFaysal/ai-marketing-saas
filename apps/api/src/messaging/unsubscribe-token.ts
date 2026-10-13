import { createHmac, timingSafeEqual } from "crypto";

/**
 * MS2 — signed unsubscribe tokens for broadcast email footers.
 * Same HMAC-SHA256 + JWT_SECRET pattern as common/admin-token.ts,
 * with a payload shaped for this purpose: the token itself is the
 * only credential on the public unsubscribe page, so it carries
 * the org, the channel and the NORMALIZED address it applies to.
 * Long expiry (1 year): the link rides in already-sent mail and
 * must keep working when the recipient finds it months later.
 */
export interface UnsubscribePayload {
  purpose: "msg-unsubscribe";
  orgId: string;
  channel: string;
  address: string;
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

export function issueUnsubscribeToken(input: { orgId: string; channel: string; address: string }): string {
  const body: UnsubscribePayload = {
    purpose: "msg-unsubscribe",
    orgId: input.orgId,
    channel: input.channel,
    address: input.address,
    exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  try {
    const [encoded, sig] = String(token).split(".");
    if (!encoded || !sig) return null;
    const expected = sign(encoded);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as UnsubscribePayload;
    if (body.purpose !== "msg-unsubscribe" || !body.orgId || !body.address) return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}
