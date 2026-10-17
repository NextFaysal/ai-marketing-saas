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

/**
 * MX10 — preference-center + double-opt-in tokens. These reuse
 * the EXACT same signed-token discipline as the unsubscribe
 * token above (HMAC-SHA256 over the base64url payload,
 * JWT_SECRET, timingSafeEqual, purpose-scoped payloads) — there
 * is deliberately no second token scheme. The preference token
 * identifies ONE contact (recipient entity when known, else the
 * channel address it was issued for); the page resolves the
 * contact's email + phone server-side, so one token manages all
 * channels. The opt-in token confirms ONE pending (channel,
 * address) signup.
 */
export interface PreferenceTokenPayload {
  purpose: "msg-preferences";
  orgId: string;
  recipientType?: string | null;
  recipientId?: string | null;
  channel: string;
  address: string;
  exp: number;
}

export function issuePreferenceToken(input: { orgId: string; channel: string; address: string; recipientType?: string | null; recipientId?: string | null }): string {
  const body: PreferenceTokenPayload = {
    purpose: "msg-preferences",
    orgId: input.orgId,
    recipientType: input.recipientType ?? null,
    recipientId: input.recipientId ?? null,
    channel: input.channel,
    address: input.address,
    exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyPreferenceToken(token: string): PreferenceTokenPayload | null {
  try {
    const [encoded, sig] = String(token).split(".");
    if (!encoded || !sig) return null;
    const expected = sign(encoded);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreferenceTokenPayload;
    if (body.purpose !== "msg-preferences" || !body.orgId || !body.address) return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

export interface OptInTokenPayload {
  purpose: "msg-optin";
  orgId: string;
  channel: string;
  address: string;
  exp: number;
}

export function issueOptInToken(input: { orgId: string; channel: string; address: string }): string {
  const body: OptInTokenPayload = {
    purpose: "msg-optin",
    orgId: input.orgId,
    channel: input.channel,
    address: input.address,
    // Shorter than the footer links: a confirmation is expected
    // promptly; an expired link honestly asks for a fresh signup.
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyOptInToken(token: string): OptInTokenPayload | null {
  try {
    const [encoded, sig] = String(token).split(".");
    if (!encoded || !sig) return null;
    const expected = sign(encoded);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OptInTokenPayload;
    if (body.purpose !== "msg-optin" || !body.orgId || !body.address || !body.channel) return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}
