import { createHmac, timingSafeEqual } from "crypto";

// WooCommerce signs webhook bodies with HMAC-SHA256 using the webhook
// secret, base64-encoded, sent in `x-wc-webhook-signature`.
export function verifyWooSignature(rawBody: Buffer | string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const expected = createHmac("sha256", secret).update(body).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
