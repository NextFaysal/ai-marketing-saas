import { createHmac, timingSafeEqual } from "crypto";

/**
 * Small signed tokens for admin-issued flows (password reset).
 * Format: base64url(JSON payload).base64url(HMAC-SHA256) using the
 * API's JWT_SECRET. Payload: { purpose, sub, exp, tv }.
 */
function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not configured");
  return s;
}
function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}
export function issueAdminToken(payload: { purpose: string; sub: string; tv: number }, ttlMinutes: number): string {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlMinutes * 60 };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}
export function verifyAdminToken<T extends { purpose: string; sub: string; exp: number; tv: number }>(token: string, purpose: string): T | null {
  try {
    const [encoded, sig] = String(token).split(".");
    if (!encoded || !sig) return null;
    const expected = sign(encoded);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
    if (body.purpose !== purpose || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}
