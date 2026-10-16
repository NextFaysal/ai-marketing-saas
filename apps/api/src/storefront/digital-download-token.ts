import { createHmac, timingSafeEqual } from "crypto";

/**
 * AB5 (AX9) — signed download tokens for digital products.
 *
 * Pure helpers mirroring common/admin-token.ts EXACTLY in format:
 *   base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 * signed with the API's JWT_SECRET. The secret source is the
 * SAME as admin-token.ts's private secret() — JWT_SECRET from
 * the environment — mirrored here (with this comment) because
 * admin-token.ts does not export its secret().
 *
 * Payload: { orderId, itemId, exp } where exp is epoch seconds.
 * A token authorises ONE item of ONE order: StorefrontService's
 * digitalDownload re-checks the order, org, item, delivery gate
 * and the per-item access limit from the DB on every hit, so a
 * leaked token alone never widens access beyond its item/order
 * and stops working at its expiry.
 */
export function downloadTokenSecret(): string {
  // Mirrors common/admin-token.ts secret(): the SAME source.
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not configured");
  return s;
}

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function mintDownloadToken(
  secret: string,
  payload: { orderId: string; itemId: string; expEpochSec: number },
): string {
  const body = {
    orderId: payload.orderId,
    itemId: payload.itemId,
    exp: payload.expEpochSec,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${sign(secret, encoded)}`;
}

export function verifyDownloadToken(
  secret: string,
  token: string,
): { orderId: string; itemId: string; exp: number } | null {
  try {
    const [encoded, sig] = String(token ?? "").split(".");
    if (!encoded || !sig) return null;
    const expected = sign(secret, encoded);
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    const body = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as { orderId?: unknown; itemId?: unknown; exp?: unknown };
    if (typeof body.orderId !== "string" || !body.orderId) return null;
    if (typeof body.itemId !== "string" || !body.itemId) return null;
    if (typeof body.exp !== "number" || !Number.isFinite(body.exp)) return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return { orderId: body.orderId, itemId: body.itemId, exp: body.exp };
  } catch {
    return null;
  }
}
