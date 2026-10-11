import { describe, expect, it } from "vitest";
import { filterAdAccounts, type FilterableAdAccount } from "./ad-account-filters";

const accounts: FilterableAdAccount[] = [
  { name: "Main Page Ads", label: "মেইন পেজ", externalId: "act_111", platform: "meta", health: "connected", platformStatusBucket: "active" },
  { name: "Backup Store", label: null, externalId: "act_222", platform: "meta", health: "sync_disabled", platformStatusBucket: "active" },
  { name: "Google Search BD", label: "সার্চ", externalId: "123-456", platform: "google", health: "stale", platformStatusBucket: "restricted" },
  { name: "TikTok Shop", label: null, externalId: "tt_9", platform: "tiktok", health: "error", platformStatusBucket: null },
  { name: "Old Import", label: null, externalId: null, platform: "meta", health: "manual", platformStatusBucket: null },
];

describe("filterAdAccounts (AD6)", () => {
  it("no filters → everything, order preserved", () => {
    expect(filterAdAccounts(accounts, {})).toHaveLength(5);
    expect(filterAdAccounts(accounts, { query: "  " })).toHaveLength(5);
  });

  it("text search hits name, label and externalId, case-insensitively", () => {
    expect(filterAdAccounts(accounts, { query: "মেইন" }).map((a) => a.externalId)).toEqual(["act_111"]);
    expect(filterAdAccounts(accounts, { query: "backup" }).map((a) => a.externalId)).toEqual(["act_222"]);
    expect(filterAdAccounts(accounts, { query: "ACT_111" }).map((a) => a.name)).toEqual(["Main Page Ads"]);
    expect(filterAdAccounts(accounts, { query: "123-456" })).toHaveLength(1);
    expect(filterAdAccounts(accounts, { query: "কিছুই নেই" })).toHaveLength(0);
  });

  it("platform / health / status filters match exactly, incl. the AD5 sync_disabled band", () => {
    expect(filterAdAccounts(accounts, { platform: "meta" })).toHaveLength(3);
    expect(filterAdAccounts(accounts, { health: "sync_disabled" }).map((a) => a.name)).toEqual(["Backup Store"]);
    expect(filterAdAccounts(accounts, { status: "restricted" }).map((a) => a.name)).toEqual(["Google Search BD"]);
    // null bucket never matches a chosen status bucket
    expect(filterAdAccounts(accounts, { status: "active" }).map((a) => a.name)).toEqual(["Main Page Ads", "Backup Store"]);
  });

  it("filters combine (AND)", () => {
    expect(filterAdAccounts(accounts, { platform: "meta", health: "connected" }).map((a) => a.name)).toEqual(["Main Page Ads"]);
    expect(filterAdAccounts(accounts, { platform: "meta", query: "google" })).toHaveLength(0);
    expect(filterAdAccounts(accounts, { platform: "google", health: "stale", status: "restricted", query: "সার্চ" })).toHaveLength(1);
  });
});
