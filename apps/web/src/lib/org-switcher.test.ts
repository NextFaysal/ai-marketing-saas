import { describe, expect, it } from "vitest";
import {
  emptyOrgListPrefs, filterSwitcherOrgs, isPinnedOrg, isSwitchNeeded, orderSwitcherOrgs,
  orgArchived, orgStateBadge, orgSuspended, orgSwitcherPrefsKey, parseOrgListPrefs,
  resolveCurrentOrgId, roleLabel, switcherMode, togglePinnedOrg, touchRecentOrg,
  userIdFromAccessToken, type SwitcherOrg,
} from "./org-switcher";

const orgs: SwitcherOrg[] = [
  { id: "org-1", name: "প্রথম দোকান", slug: "prothom", currency: "BDT", myRole: "OWNER" },
  { id: "org-2", name: "দ্বিতীয় দোকান", slug: "ditiyo", currency: "USD", myRole: "ADMIN" },
];

describe("OU1 org-switcher helpers", () => {
  it("keeps the stored org when it is still an active membership", () => {
    expect(resolveCurrentOrgId(orgs, "org-2")).toBe("org-2");
  });

  it("falls back to the first membership when the stored org is gone (e.g. suspended)", () => {
    expect(resolveCurrentOrgId(orgs, "org-suspended")).toBe("org-1");
    expect(resolveCurrentOrgId(orgs, null)).toBe("org-1");
  });

  it("returns null when the user has no memberships", () => {
    expect(resolveCurrentOrgId([], "org-1")).toBeNull();
  });

  it("only switches when the target differs from the resolved current org", () => {
    expect(isSwitchNeeded(orgs, "org-1", "org-2")).toBe(true);
    expect(isSwitchNeeded(orgs, "org-1", "org-1")).toBe(false);
    // Stored id is stale: current resolves to org-1, so picking org-1 is a no-op.
    expect(isSwitchNeeded(orgs, "org-gone", "org-1")).toBe(false);
  });

  it("labels known roles in Bengali and passes unknown roles through", () => {
    expect(roleLabel("OWNER")).toContain("Owner");
    expect(roleLabel("VIEWER")).toBe("শুধু দেখতে পারেন");
    expect(roleLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(roleLabel(undefined)).toBe("");
    expect(roleLabel(null)).toBe("");
  });

  it("classifies empty / single / multi membership lists", () => {
    expect(switcherMode([])).toBe("empty");
    expect(switcherMode([orgs[0]])).toBe("single");
    expect(switcherMode(orgs)).toBe("multi");
  });
});

describe("ORG3/ORG4 org state helpers", () => {
  const live: SwitcherOrg = { id: "o1", name: "Live", status: "ACTIVE", archivedAt: null };
  const suspended: SwitcherOrg = { id: "o2", name: "Susp", status: "SUSPENDED", archivedAt: null };
  const archived: SwitcherOrg = { id: "o3", name: "Arch", status: "ACTIVE", archivedAt: "2026-10-16T00:00:00.000Z" };
  const both: SwitcherOrg = { id: "o4", name: "Both", status: "SUSPENDED", archivedAt: "2026-10-16T00:00:00.000Z" };
  const legacy: SwitcherOrg = { id: "o5", name: "Legacy" }; // pre-ORG4 payloads may omit the fields

  it("detects platform suspension only from a non-ACTIVE status", () => {
    expect(orgSuspended(suspended)).toBe(true);
    expect(orgSuspended({ ...live, status: "DELETED" })).toBe(true);
    expect(orgSuspended(live)).toBe(false);
    expect(orgSuspended(legacy)).toBe(false);
  });

  it("detects a tenant archive only from archivedAt", () => {
    expect(orgArchived(archived)).toBe(true);
    expect(orgArchived(live)).toBe(false);
    expect(orgArchived(legacy)).toBe(false);
  });

  it("badge: suspension wins over archive; live orgs get no badge", () => {
    expect(orgStateBadge(suspended)).toBe("স্থগিত");
    expect(orgStateBadge(archived)).toBe("আর্কাইভ করা");
    expect(orgStateBadge(both)).toBe("স্থগিত");
    expect(orgStateBadge(live)).toBeNull();
    expect(orgStateBadge(legacy)).toBeNull();
  });
});

describe("ORG8 switcher list personalization (search / pin / recent)", () => {
  const many: SwitcherOrg[] = [
    { id: "a", name: "Alpha Fashion", slug: "alpha", myRole: "OWNER" },
    { id: "b", name: "Beta Electronics", slug: "beta", myRole: "ADMIN" },
    { id: "c", name: "Chaya Cosmetics", slug: "chaya", myRole: "VIEWER" },
    { id: "d", name: "Delta Motors", slug: "delta", myRole: "ADMIN" },
  ];

  it("orders pinned first (pin order), then recent, then the rest in list order — no duplicates, stale ids ignored", () => {
    const prefs = { pinnedIds: ["c", "ghost"], recentIds: ["d", "a"] };
    expect(orderSwitcherOrgs(many, prefs).map((o) => o.id)).toEqual(["c", "d", "a", "b"]);
    // a pinned org that is also recent appears once, in the pin block
    const both = { pinnedIds: ["d"], recentIds: ["d", "b"] };
    expect(orderSwitcherOrgs(many, both).map((o) => o.id)).toEqual(["d", "b", "a", "c"]);
    // empty prefs keep the incoming order exactly
    expect(orderSwitcherOrgs(many, emptyOrgListPrefs()).map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("search matches name and slug case-insensitively; blank query returns everything", () => {
    expect(filterSwitcherOrgs(many, "fashion").map((o) => o.id)).toEqual(["a"]);
    expect(filterSwitcherOrgs(many, "CHAYA").map((o) => o.id)).toEqual(["c"]);
    expect(filterSwitcherOrgs(many, "delt").map((o) => o.id)).toEqual(["d"]);
    expect(filterSwitcherOrgs(many, "  ").map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterSwitcherOrgs(many, "nope")).toEqual([]);
  });

  it("touchRecent moves the org to the front, dedupes and caps the list", () => {
    let prefs = emptyOrgListPrefs();
    prefs = touchRecentOrg(prefs, "a");
    prefs = touchRecentOrg(prefs, "b");
    prefs = touchRecentOrg(prefs, "a");
    expect(prefs.recentIds).toEqual(["a", "b"]);
    const capped = touchRecentOrg({ pinnedIds: [], recentIds: ["1", "2", "3"] }, "9", 3);
    expect(capped.recentIds).toEqual(["9", "1", "2"]);
  });

  it("togglePin pins and unpins; pin order is append order", () => {
    let prefs = emptyOrgListPrefs();
    prefs = togglePinnedOrg(prefs, "b");
    prefs = togglePinnedOrg(prefs, "a");
    expect(prefs.pinnedIds).toEqual(["b", "a"]);
    expect(isPinnedOrg(prefs, "b")).toBe(true);
    prefs = togglePinnedOrg(prefs, "b");
    expect(prefs.pinnedIds).toEqual(["a"]);
    expect(isPinnedOrg(prefs, "b")).toBe(false);
  });

  it("prefs key is namespaced by user id, with an anon fallback", () => {
    expect(orgSwitcherPrefsKey("user-9")).toBe("orgSwitcherPrefs:user-9");
    expect(orgSwitcherPrefsKey(null)).toBe("orgSwitcherPrefs:anon");
    expect(orgSwitcherPrefsKey("")).toBe("orgSwitcherPrefs:anon");
  });

  it("stored prefs parse tolerantly — garbage degrades to empty, good data survives", () => {
    expect(parseOrgListPrefs(null)).toEqual(emptyOrgListPrefs());
    expect(parseOrgListPrefs("not json")).toEqual(emptyOrgListPrefs());
    expect(parseOrgListPrefs('{"pinnedIds":"oops","recentIds":[1,2]}')).toEqual(emptyOrgListPrefs());
    expect(parseOrgListPrefs('{"pinnedIds":["a"],"recentIds":["b","c"]}')).toEqual({ pinnedIds: ["a"], recentIds: ["b", "c"] });
  });

  it("user id comes out of the JWT sub claim; anything malformed yields null", () => {
    const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const token = `${b64url({ alg: "none" })}.${b64url({ sub: "user-42", email: "x@y.z" })}.sig`;
    expect(userIdFromAccessToken(token)).toBe("user-42");
    expect(userIdFromAccessToken(`${b64url({})}.${b64url({ email: "x@y.z" })}.sig`)).toBeNull();
    expect(userIdFromAccessToken("garbage")).toBeNull();
    expect(userIdFromAccessToken(null)).toBeNull();
    expect(userIdFromAccessToken("")).toBeNull();
  });
});
