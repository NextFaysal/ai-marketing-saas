import { describe, expect, it } from "vitest";
import { GOOGLE_CONNECT_KINDS, MARKETPLACE_NOTES, UNGROUPED_FILTER, accountGroupNames, accountInGroup, accountMatches, adBucketMeta, alertKindMeta, appConfigStatusLabel, appSourceMeta, canEditAccountMeta, canPauseSync, canRefreshProviderHealth, categoryStatusLabel, completenessItems, filterOverview, findingSeverityMeta, formatTakaMinor, gatewayStatusLabel, googleKindLabel, groupAccounts, healthMeta, ledgerTypeLabel, llmConfigStatusLabel, memberCanBeRestricted, overallMeta, payOnlineAvailable, payOptionLabel, payoutStatusLabel, qualityMeta, stepStatusMeta, syncJobStatusLabel, txnStatusMeta, webhookTopics, whatsappHealth, type ConnectionAccount, type ConnectionsOverview } from "./connections";

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
  const gwView = { provider: "bkash", identifier: "ak", sandbox: false, status: "verified", isEnabled: true, lastVerifiedAt: null, lastError: null, verificationNote: "verified_with_gateway", feeBps: null, feeFixedMinor: null };

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

  it("CC11/CC12: doctor + alert labels are Bengali and honest — not_checkable never renders as a pass", () => {
    expect(overallMeta("pass").label).toBe("পাস");
    expect(overallMeta("fail").label).toBe("ব্যর্থ");
    expect(overallMeta("partial").label).toBe("আংশিক");
    expect(stepStatusMeta("pass").label).toContain("পাস");
    expect(stepStatusMeta("fail").label).toContain("ব্যর্থ");
    // The honesty pin: not_checkable must NOT contain "পাস".
    expect(stepStatusMeta("not_checkable").label).not.toContain("পাস");
    expect(stepStatusMeta("not_checkable").label).toContain("যাচাই সম্ভব নয়");
    expect(alertKindMeta("broke").label).toBe("সমস্যা");
    expect(alertKindMeta("recovered").label).toBe("ঠিক হয়েছে");
    expect(alertKindMeta("expiring").label).toContain("মেয়াদ");
  });
});

describe("CC14/CC15/CC16 provider-health helpers", () => {
  const base: ConnectionAccount = {
    id: "a-1", source: "integration", category: "messaging", provider: "whatsapp",
    displayName: "WhatsApp", externalAccountId: "111", status: "CONNECTED",
    lastSyncAt: null, lastError: null, tokenExpiresAt: null, expiringSoon: false,
    health: "ok", isDefault: false, deepLink: "/dashboard/inbox",
  };

  it("whatsappHealth surfaces only the fields Meta actually returned", () => {
    const view = whatsappHealth({ ...base, providerHealth: { kind: "whatsapp", qualityRating: "YELLOW", waba: { accountReviewStatus: "APPROVED" } } });
    expect(view?.qualityRating).toBe("YELLOW");
    expect(view?.wabaReviewStatus).toBe("APPROVED");
    // Absent stays absent — no messagingLimit is invented.
    expect(view?.messagingLimit).toBeUndefined();
    expect(whatsappHealth({ ...base, providerHealth: null })).toBeNull();
    expect(whatsappHealth({ ...base, providerHealth: { kind: "meta_page" } })).toBeNull();
    expect(qualityMeta("RED").cls).toContain("red");
    expect(qualityMeta("GREEN").label).toContain("Green");
  });

  it("completenessItems keeps unknowns unknown — never yes/no without an answer", () => {
    const page: ConnectionAccount = {
      ...base, source: "social_account", category: "social", provider: "meta_page",
      providerHealth: {
        kind: "meta_page",
        instagram: { linked: true, id: "ig-1", username: "shop" },
        pixel: { associated: null, scope: "meta_ad_account", error: "no ad account" },
        catalog: { associated: false, count: 0, scope: "meta_ad_account" },
      },
    };
    const items = completenessItems(page);
    expect(items.find((i) => i.key === "instagram")).toMatchObject({ state: "yes", detail: "@shop" });
    expect(items.find((i) => i.key === "pixel")?.state).toBe("unknown");
    expect(items.find((i) => i.key === "catalog")).toMatchObject({ state: "no", detail: null });
    expect(completenessItems({ ...base, providerHealth: null })).toEqual([]);
    const ad: ConnectionAccount = {
      ...base, source: "ad_account", category: "ads", provider: "meta",
      providerHealth: { kind: "ad_account", paymentMethodOnFile: false },
    };
    expect(completenessItems(ad)).toEqual([
      { key: "payment_method", label: "Payment method on file (Meta-র রিপোর্ট)", state: "no", detail: null },
      // CC30: the business-verification item exists for Meta targets;
      // with no snapshot.business it stays "unknown" — never a guess.
      { key: "business_verification", label: "Business verification (Meta)", state: "unknown", detail: null },
    ]);
    expect(adBucketMeta("restricted").label).toContain("সীমাবদ্ধ");
    expect(adBucketMeta(null).label).toBe("জানা নেই");
  });

  it("canRefreshProviderHealth covers exactly the CC14/CC15 targets", () => {
    expect(canRefreshProviderHealth(base)).toBe(true);
    expect(canRefreshProviderHealth({ ...base, provider: "woocommerce" })).toBe(false);
    expect(canRefreshProviderHealth({ ...base, source: "social_account", provider: "meta_page" })).toBe(true);
    expect(canRefreshProviderHealth({ ...base, source: "social_account", provider: "tiktok" })).toBe(false);
    expect(canRefreshProviderHealth({ ...base, source: "ad_account", provider: "meta" })).toBe(true);
    expect(canRefreshProviderHealth({ ...base, source: "ad_account", provider: "google" })).toBe(false);
  });

  it("webhookTopics reads the stored EC2 record per topic; no record → empty list", () => {
    expect(webhookTopics(null)).toEqual([]);
    expect(webhookTopics({ status: "partial", topics: { "order.created": { status: "registered" }, "order.updated": { status: "failed", error: "500" } } })).toEqual([
      { topic: "order.created", status: "registered", error: null },
      { topic: "order.updated", status: "failed", error: "500" },
    ]);
  });
});

describe("CC17 groups + member access helpers", () => {
  const grouped = [
    account({ id: "g1", groupName: "ঢাকা ব্রাঞ্চ" }),
    account({ id: "g2", groupName: null }),
    account({ id: "g3", groupName: "খুলনা" }),
    account({ id: "g4", groupName: "ঢাকা ব্রাঞ্চ" }),
    account({ id: "g5" }),
  ] as ConnectionAccount[];

  it("groupAccounts files accounts under their group with ungrouped LAST", () => {
    const groups = groupAccounts(grouped);
    expect(groups.map((g) => g.groupName)).toEqual(["ঢাকা ব্রাঞ্চ", "খুলনা", null]);
    expect(groups[0].accounts.map((a) => a.id)).toEqual(["g1", "g4"]);
    expect(groups[2].accounts.map((a) => a.id)).toEqual(["g2", "g5"]);
  });

  it("accountGroupNames returns the distinct sorted group names", () => {
    expect(accountGroupNames(grouped)).toEqual(["খুলনা", "ঢাকা ব্রাঞ্চ"]);
  });

  it("accountInGroup honours the filter, including the ungrouped sentinel", () => {
    expect(accountInGroup(grouped[0], "")).toBe(true);
    expect(accountInGroup(grouped[0], "ঢাকা ব্রাঞ্চ")).toBe(true);
    expect(accountInGroup(grouped[0], "খুলনা")).toBe(false);
    expect(accountInGroup(grouped[1], UNGROUPED_FILTER)).toBe(true);
    expect(accountInGroup(grouped[0], UNGROUPED_FILTER)).toBe(false);
  });

  it("meta editing + sync pause apply only to the right sources", () => {
    expect(canEditAccountMeta(account({ source: "integration" }) as ConnectionAccount)).toBe(true);
    expect(canEditAccountMeta(account({ source: "social_account" }) as ConnectionAccount)).toBe(true);
    expect(canEditAccountMeta(account({ source: "ad_account" }) as ConnectionAccount)).toBe(true);
    expect(canEditAccountMeta(account({ source: "sender_config" }) as ConnectionAccount)).toBe(false);
    expect(canPauseSync(account({ source: "integration" }) as ConnectionAccount)).toBe(true);
    expect(canPauseSync(account({ source: "ad_account" }) as ConnectionAccount)).toBe(false);
  });

  it("OWNER members can never be restricted in the matrix (M72)", () => {
    expect(memberCanBeRestricted({ userId: "u1", name: null, email: null, role: "OWNER", deniedConnectionIds: [] })).toBe(false);
    expect(memberCanBeRestricted({ userId: "u2", name: null, email: null, role: "SUPPORT_AGENT", deniedConnectionIds: [] })).toBe(true);
  });
});

describe("CC18 sync history labels", () => {
  const job = (over: any) => ({ id: "j1", kind: "products", status: "COMPLETED", fetched: 0, created: 0, updated: 0, skipped: 0, error: null, startedAt: "2026-01-01T00:00:00Z", completedAt: null, ...over });

  it("a sync_paused skip reads as paused, whatever the stored status", () => {
    expect(syncJobStatusLabel(job({ error: "sync_paused" }))).toContain("বিরতি");
    expect(syncJobStatusLabel(job({}))).toBe("সম্পন্ন");
    expect(syncJobStatusLabel(job({ status: "FAILED", error: "boom" }))).toBe("ব্যর্থ");
  });
});

describe("CC19 payment views + Pay-online visibility", () => {
  it("txnStatusMeta covers the transaction lifecycle", () => {
    expect(txnStatusMeta("verified_paid").label).toBe("যাচাইকৃত পেইড");
    expect(txnStatusMeta("initiated").label).toBe("শুরু হয়েছে");
    expect(txnStatusMeta("failed").label).toBe("ব্যর্থ");
  });

  it("the Pay-online button exists ONLY when the API returned at least one real option", () => {
    expect(payOnlineAvailable([])).toBe(false);
    expect(payOnlineAvailable(null)).toBe(false);
    expect(payOnlineAvailable(undefined)).toBe(false);
    expect(payOnlineAvailable([{ provider: "bkash", source: "own" }])).toBe(true);
    expect(payOnlineAvailable([{ provider: "sslcommerz", source: "platform" }])).toBe(true);
  });

  it("payOptionLabel names the provider and the platform path honestly", () => {
    expect(payOptionLabel({ provider: "bkash", source: "own" })).toBe("বিকাশ");
    expect(payOptionLabel({ provider: "bkash", source: "platform" })).toContain("প্ল্যাটফর্ম");
    expect(payOptionLabel({ provider: "sslcommerz", source: "own" })).toContain("SSLCommerz");
  });
});

describe("CC20 assistant severity + Google kinds + marketplace verdicts", () => {
  it("findingSeverityMeta covers the three severities and falls back to info", () => {
    expect(findingSeverityMeta("blocker").label).toContain("ব্লকার");
    expect(findingSeverityMeta("improvement").label).toContain("উন্নতি");
    expect(findingSeverityMeta("info").label).toContain("তথ্য");
    expect(findingSeverityMeta("anything-else")).toEqual(findingSeverityMeta("info"));
  });

  it("the Google pack offers exactly the three kinds, in connect order", () => {
    expect(GOOGLE_CONNECT_KINDS.map((k) => k.kind)).toEqual(["ga4", "merchant", "business"]);
    expect(googleKindLabel("ga4")).toContain("GA4");
    expect(googleKindLabel("merchant")).toContain("Merchant");
    expect(googleKindLabel("business")).toContain("Business Profile");
    expect(googleKindLabel("unknown-kind")).toBe("unknown-kind");
    for (const k of GOOGLE_CONNECT_KINDS) {
      expect(k.label.length).toBeGreaterThan(0);
      expect(k.blurb.length).toBeGreaterThan(0);
    }
  });

  it("marketplace notes carry the EC14 NO-BUILD verdicts — never a connect offer", () => {
    expect(MARKETPLACE_NOTES.map((n) => n.provider)).toEqual(["tiktok_shop", "daraz"]);
    for (const note of MARKETPLACE_NOTES) {
      expect(note.verdict).toBe("no_build");
      // every note must say WHY there is no button and WHAT
      // would change the verdict — a bare absence is not honest
      expect(note.reason.length).toBeGreaterThan(40);
      expect(note.revisit.length).toBeGreaterThan(20);
      expect(note.summary.length).toBeGreaterThan(0);
    }
    expect(MARKETPLACE_NOTES[0]!.reason).toContain("বাংলাদেশ");
    expect(MARKETPLACE_NOTES[1]!.reason).toContain("Lazada");
  });
});
