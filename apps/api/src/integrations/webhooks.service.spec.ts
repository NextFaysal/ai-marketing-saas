import { createHmac } from "crypto";
import { verifyWooSignature } from "./webhooks.service";

describe("verifyWooSignature", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: 900, status: "completed" });
  const good = createHmac("sha256", secret).update(body).digest("base64");
  it("accepts a correctly signed body", () => {
    expect(verifyWooSignature(body, good, secret)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyWooSignature(body.replace("completed", "refunded"), good, secret)).toBe(false);
  });
  it("rejects a missing or wrong signature", () => {
    expect(verifyWooSignature(body, undefined, secret)).toBe(false);
    expect(verifyWooSignature(body, good, "wrong-secret")).toBe(false);
  });
});
