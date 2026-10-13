import { describe, expect, it } from "vitest";
import { accountMatches, appConfigStatusLabel, appSourceMeta, categoryStatusLabel, filterOverview, formatTakaMinor, gatewayStatusLabel, healthMeta, ledgerTypeLabel, llmConfigStatusLabel, payoutStatusLabel, type ConnectionsOverview } from "./connections";

const account = (over: Partial<ConnectionsOverview["categories"][number]["accounts"][number]>) => ({
  id: "a1", source: "integration", category: "messaging", provider: "whatsapp",
  displayName: "WhatsApp", externalAccountId: "111", status: "CONNECTED",
  lastSyncAt: null, lastError: null, tokenExpiresAt: null, expiringSoon: false,
  health: "ok" as const, isDefault: false, deepLink: "/dashboard/inbox",
  ...over,
});

const overview: ConnectionsOverview = {
  organizationId: "org-1",
  generatedAt: "2026-10-13T00:00:00.000Z",
  summary: { totalAccounts: 3, connectedAccounts: 2, errorAccounts: 0, byCategory: {} },
  categories: [
    {
      key: "messaging", label: "মেসেজিং চ্যানেল", deepLink: "/dashboard/inbox", status: "connected",
      note: null, connectedCount: 2, totalCount: 2,
      accounts: [account({}), account({ id: "a2", provider: "telegram", displayName: "Telegram", externalAccountId: "bot-1" })],
    },
    {
      key: "courier", label: "কুরিয়ার", deepLink: "/dashboard/integrations", status: "connected",
      note: null, connectedCount: 1, totalCount: 1,
      accounts: [account({ id: "a3", category: "courier", provider: "steadfast", displayName: "Steadfast", externalAccountId: null })],
    },
    {
      key: "payment", label: "পেমেন্ট", deepLink: "/dashboard/settings#hub-payment", status: "not_configured",
      note: "payment_manual_not_configured", connectedCount: 0, totalCount: 0, accounts: [],
    },
  ],
};

describe("CC1 connections view helpers", () => {
  it("healthMeta covers every health value and falls back to unknown", () => {
    expect(healthMeta("ok").label).toBe("সচল");
    expect(healthMeta("error").label).toBe("সমস্যা আছে");
    expect(healthMeta("disconnected").label).toBe("বিচ্ছিন্ন");
    expect(healthMeta("expiring").label).toContain("মেয়াদ");
    expect(healthMeta("something-else").label).toBe("অজানা");
  });

  it("accountMatches searches name, provider, external id and status", () => {
    const a = account({});
    expect(accountMatches(a, "whats")).toBe(true);
    expect(accountMatches(a, "111")).toBe(true);
    expect(accountMatches(a, "connected")).toBe(true);
    expect(accountMatches(a, "pathao")).toBe(false);
    expect(accountMatches(a, "  ")).toBe(true);
  });

  it("filterOverview keeps only matching accounts and drops empty categories", () => {
    const out = filterOverview(overview, "steadfast");
    expect(out.map((c) => c.key)).toEqual(["courier"]);
    expect(out[0].accounts).toHaveLength(1);
    // Category label match keeps the whole category.
    const byLabel = filterOverview(overview, "কুরিয়ার");
    expect(byLabel.map((c) => c.key)).toEqual(["courier"]);
    // Empty query returns everything untouched.
    expect(filterOverview(overview, "")).toHaveLength(3);
    expect(filterOverview(overview, "no-such-thing")).toEqual([]);
  });

  it("categoryStatusLabel is honest for platform-managed and empty categories", () => {
    expect(categoryStatusLabel({ ...overview.categories[2], status: "platform_managed" })).toBe("প্ল্যাটফর্মের AI দিয়ে চলছে");
    expect(categoryStatusLabel(overview.categories[2])).toBe("কনফিগার করা হয়নি");
    expect(categoryStatusLabel(overview.categories[0])).toBe("2/2 কানেক্টেড");
  });
});

describe("CC3/CC4 app-source helpers", () => {
  it("appSourceMeta badges own vs platform and stays silent without an app source", () => {
    expect(appSourceMeta(account({ appSource: "own" }))?.label).toBe("নিজের অ্যাপ");
    expect(appSourceMeta(account({ appSource: "platform" }))?.label).toBe("প্ল্যাটফর্ম অ্যাপ");
    expect(appSourceMeta(account({}))).toBeNull();
  });

  it("appConfigStatusLabel never calls a TikTok 'configured' row verified", () => {
    const base = { platform: "tiktok", appId: "k", lastVerifiedAt: null, lastError: null, verificationNote: "verified_at_first_connect" };
    expect(appConfigStatusLabel({ ...base, status: "verified" })).toBe("যাচাইকৃত");
    expect(appConfigStatusLabel({ ...base, status: "configured" })).toContain("যাচাই প্রথম কানেক্টে হবে");
  });
});

describe("CC8/CC9 status labels", () => {
  const llmView = { provider: "openai", model: null, status: "verified", isEnabled: true, lastVerifiedAt: null, lastError: null, verificationNote: "verified_with_provider" };
  const gwView = { provider: "bkash", identifier: "ak", sandbox: false, status: "verified", isEnabled: true, lastVerifiedAt: null, lastError: null, verificationNote: "verified_with_gateway" };

  it("llm label says verified only for a verified row", () => {
    expect(llmConfigStatusLabel(llmView)).toContain("যাচাইকৃত");
    expect(llmConfigStatusLabel({ ...llmView, status: "configured" })).toBe("কনফিগার করা");
  });

  it("gateway label never calls a configured (unverifiable) row verified", () => {
    expect(gatewayStatusLabel(gwView)).toBe("যাচাইকৃত");
    const configured = gatewayStatusLabel({ ...gwView, status: "configured", verificationNote: "no_pre_transaction_check" });
    expect(configured).toContain("কনফিগার করা");
    expect(configured).toContain("আগাম যাচাইয়ের সুযোগ নেই");
  });
});

describe("CC10 wallet formatting + labels", () => {
  it("formats minor units as taka, signed", () => {
    expect(formatTakaMinor("98000")).toBe("৳ 980.00");
    expect(formatTakaMinor("-2000")).toBe("-৳ 20.00");
    expect(formatTakaMinor("123456789")).toBe("৳ 1,234,567.89");
    expect(formatTakaMinor("0")).toBe("৳ 0.00");
  });

  it("payout + ledger labels cover every status/type the API emits", () => {
    for (const s of ["pending", "approved", "paid", "rejected", "cancelled"]) {
      expect(payoutStatusLabel(s)).not.toBe(s);
    }
    for (const t of ["payment_credit", "fee_debit", "payout_debit", "adjustment"]) {
      expect(ledgerTypeLabel(t)).not.toBe(t);
    }
    expect(payoutStatusLabel("paid")).toContain("পাঠানো হয়েছে");
  });
});
