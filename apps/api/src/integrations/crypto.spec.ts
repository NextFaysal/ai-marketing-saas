import { encryptJson, decryptJson } from "./crypto";

describe("credential encryption (AES-256-GCM)", () => {
  it("round-trips a credential payload and never stores plaintext", () => {
    const payload = { consumerKey: "ck_live_example", consumerSecret: "cs_live_example" };
    const stored = encryptJson(payload);
    expect(stored).not.toContain("ck_live_example");
    expect(stored).not.toContain("cs_live_example");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptJson(stored)).toEqual(payload);
  });
  it("produces different ciphertext every time (random IV)", () => {
    expect(encryptJson({ a: 1 })).not.toBe(encryptJson({ a: 1 }));
  });
  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const stored = encryptJson({ consumerKey: "ck" });
    const tampered = stored.slice(0, -4) + "AAAA";
    expect(() => decryptJson(tampered)).toThrow();
  });
});
