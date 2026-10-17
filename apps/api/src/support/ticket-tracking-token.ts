import { createHmac, timingSafeEqual } from "crypto";

/**
 * OU8 — signed ticket-tracking tokens for the PUBLIC tracking page.
 * Same HMAC-SHA256 + JWT_SECRET pattern as messaging/unsubscribe-token.ts
 * (MS2 preference-center discipline): the token in the link is the
 * ONLY credential — no login. It carries exactly one ticket id +
 * its org, purpose-scoped so it cannot be replayed as an
 * unsubscribe/open token. 90-day expiry: long enough for a support
 * thread's life, short enough that a leaked link ages out.
 */
export interface TicketTrackingPayload {
  purpose: "ticket-track";
  ticketId: string;
  orgId: string;
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

export function issueTicketTrackingToken(input: { ticketId: string; orgId: string }): string {
  const body: TicketTrackingPayload = {
    purpose: "ticket-track",
    ticketId: input.ticketId,
    orgId: input.orgId,
    exp: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyTicketTrackingToken(token: string): TicketTrackingPayload | null {
  try {
    const [encoded, sig] = String(token).split(".");
    if (!encoded || !sig) return null;
    const expected = sign(encoded);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TicketTrackingPayload;
    if (body.purpose !== "ticket-track" || !body.ticketId || !body.orgId) return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}
