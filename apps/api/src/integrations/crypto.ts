import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM credential encryption.
// Stored format: v1:<iv base64>:<authTag base64>:<ciphertext base64>
// The key comes from ENCRYPTION_KEY (32 bytes as base64 or hex).
// In development only, a missing key falls back to a clearly-named dev key
// so local setup works; production MUST set ENCRYPTION_KEY (enforced below).

const DEV_FALLBACK_KEY = Buffer.from("dev-only-insecure-key-do-not-use-in-prod!!".slice(0, 32));

export function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY must be set in production");
    }
    return DEV_FALLBACK_KEY;
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

export function encryptJson(payload: unknown): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptJson<T>(stored: string): T {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unsupported credential format");
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}
