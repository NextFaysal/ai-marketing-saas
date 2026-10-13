import { mintApprovalToken, verifyApprovalToken, APPROVAL_LINK_TTL_MS } from "./approval-links";

describe("approval links (AP7)", () => {
  const secret = "test-secret";
  it("roundtrip verifies; tampered, wrong-proposal and expired tokens fail", () => {
    const { token, expiresAt } = mintApprovalToken(secret, "prop-1", 1_000_000);
    expect(expiresAt).toBe(1_000_000 + APPROVAL_LINK_TTL_MS);
    expect(verifyApprovalToken(secret, "prop-1", token, 1_000_001)).toBe(true);
    expect(verifyApprovalToken(secret, "prop-2", token, 1_000_001)).toBe(false);
    expect(verifyApprovalToken("other-secret", "prop-1", token, 1_000_001)).toBe(false);
    expect(verifyApprovalToken(secret, "prop-1", token.replace(/\d/, "9"), 1_000_001)).toBe(false);
    expect(verifyApprovalToken(secret, "prop-1", token, expiresAt + 1)).toBe(false);
    expect(verifyApprovalToken(secret, "prop-1", undefined)).toBe(false);
    expect(verifyApprovalToken(secret, "prop-1", "garbage")).toBe(false);
  });
});
