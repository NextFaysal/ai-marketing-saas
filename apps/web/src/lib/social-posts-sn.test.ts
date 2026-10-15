import { describe, expect, it } from "vitest";
import {
  CLIENT_REVIEW_META,
  SHARE_LINK_STATUS_META,
  shareLinkStatus,
} from "./social-posts-sn";

describe("shareLinkStatus (SN2)", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  const future = "2026-10-20T00:00:00Z";
  const past = "2026-10-10T00:00:00Z";

  it("active: not revoked and not yet expired", () => {
    expect(shareLinkStatus({ expiresAt: future, revokedAt: null }, now)).toBe("active");
  });

  it("expired: expiry in the past (boundary inclusive)", () => {
    expect(shareLinkStatus({ expiresAt: past, revokedAt: null }, now)).toBe("expired");
    expect(shareLinkStatus({ expiresAt: now.toISOString(), revokedAt: null }, now)).toBe("expired");
  });

  it("revoked beats expired and active", () => {
    expect(shareLinkStatus({ expiresAt: future, revokedAt: past }, now)).toBe("revoked");
    expect(shareLinkStatus({ expiresAt: past, revokedAt: past }, now)).toBe("revoked");
  });

  it("every status + decision has a Bengali label + pill class", () => {
    for (const s of ["active", "expired", "revoked"] as const) {
      expect(SHARE_LINK_STATUS_META[s].label.length).toBeGreaterThan(0);
      expect(SHARE_LINK_STATUS_META[s].pillCls).toContain("bg-");
    }
    for (const d of ["approved", "changes_requested"] as const) {
      expect(CLIENT_REVIEW_META[d].label).toContain("ক্লায়েন্ট");
    }
  });
});
