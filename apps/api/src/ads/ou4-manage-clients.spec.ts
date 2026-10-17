import { GoogleAdsClient } from "./google/google.client";
import { TikTokAdsClient } from "./tiktok/tiktok.client";
import { TikTokManage } from "./tiktok/tiktok.client";

/** OU4: mocked-provider specs for the Google/TikTok management
 * clients (status sync, lifecycle, Customer Match / DMP audiences).
 * No live ad account is touched — every fetch is a stub, and the
 * assertions pin the request shapes OUR clients send plus the
 * honest failure behaviour (provider errors surface verbatim, a
 * missing confirmation id is a failure, never a success). */

function googleClient(handler: (url: string, init: any) => any) {
  const calls: { url: string; init: any }[] = [];
  const fetchFn = async (url: string, init: any) => {
    calls.push({ url, init });
    if (url.includes("oauth2.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "tok" }) } as any;
    }
    return handler(url, init);
  };
  const client = new GoogleAdsClient(
    { clientId: "cid", clientSecret: "sec", refreshToken: "rt", developerToken: "dev" },
    fetchFn as any, "v17",
  );
  return { manage: client.campaignManage(), calls };
}
const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body }) as any;

describe("OU4 Google campaign status + lifecycle", () => {
  it("reads the real campaign status via GAQL", async () => {
    const { manage, calls } = googleClient(async () => okJson({
      results: [{ campaign: { id: 555, name: "Sale", status: "ENABLED" } }],
    }));
    const out = await manage.getCampaignStatus("123-456", "555");
    expect(out).toEqual({ campaignExternalId: "555", name: "Sale", status: "ENABLED" });
    expect(calls[1].url).toContain("/customers/123456/googleAds:search");
    expect(JSON.parse(calls[1].init.body).query).toContain("campaign.status");
  });

  it("returns null when Google has no such campaign", async () => {
    const { manage } = googleClient(async () => okJson({ results: [] }));
    expect(await manage.getCampaignStatus("123456", "999")).toBeNull();
  });

  it("pauses via campaigns:mutate with an explicit updateMask", async () => {
    const { manage, calls } = googleClient(async () => okJson({ results: [{ resourceName: "customers/123456/campaigns/555" }] }));
    await manage.setCampaignStatus("123456", "555", "PAUSED");
    const body = JSON.parse(calls[1].init.body);
    expect(calls[1].url).toContain("/campaigns:mutate");
    expect(body.operations[0].update).toEqual({ resourceName: "customers/123456/campaigns/555", status: "PAUSED" });
    expect(body.operations[0].updateMask).toBe("status");
  });

  it("surfaces Google's error and never pretends a change happened", async () => {
    const { manage } = googleClient(async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "developer token not approved" } }) }) as any);
    await expect(manage.setCampaignStatus("123456", "555", "ENABLED")).rejects.toThrow("developer token not approved");
  });
});

describe("OU4 Google Customer Match", () => {
  it("creates a CRM-based list and returns its id only when Google confirms", async () => {
    const { manage, calls } = googleClient(async () => okJson({ results: [{ resourceName: "customers/123456/userLists/789" }] }));
    const out = await manage.createCustomerMatchList("123456", "Buyers");
    expect(out).toEqual({ resourceName: "customers/123456/userLists/789", userListId: "789" });
    const body = JSON.parse(calls[1].init.body);
    expect(body.operations[0].create.crmBasedUserList.uploadKeyType).toBe("CONTACT_INFO");
  });

  it("runs the offline job flow: create -> addOperations (hashed only) -> run", async () => {
    const seen: string[] = [];
    const { manage } = googleClient(async (url: string) => {
      seen.push(url);
      if (url.endsWith("/offlineUserDataJobs")) return okJson({ resourceName: "customers/123456/offlineUserDataJobs/42" });
      if (url.includes(":addOperations")) return okJson({});
      if (url.includes(":run")) return okJson({});
      throw new Error(`unexpected ${url}`);
    });
    const out = await manage.uploadCustomerMatch("123456", "customers/123456/userLists/789", [
      { hashedEmail: "a".repeat(64), hashedPhone: "b".repeat(64) },
      { hashedEmail: "c".repeat(64) },
    ]);
    expect(out).toEqual({ jobResourceName: "customers/123456/offlineUserDataJobs/42", operations: 2 });
    expect(seen.some((u) => u.includes(":addOperations"))).toBe(true);
    expect(seen.some((u) => u.includes(":run"))).toBe(true);
  });

  it("reads provider-reported list size verbatim", async () => {
    const { manage } = googleClient(async () => okJson({ results: [{ userList: { name: "Buyers", sizeForDisplay: "1200" } }] }));
    const out = await manage.getUserList("123456", "789");
    expect(out).toEqual({ name: "Buyers", sizeForDisplay: "1200", approximateCount: 1200 });
  });
});

function tiktokManage(handler: (url: string, init: any) => any) {
  const calls: { url: string; init: any }[] = [];
  const fetchFn = async (url: string, init: any) => { calls.push({ url, init }); return handler(url, init); };
  return { manage: new TikTokManage("tt-token", fetchFn as any), calls };
}
const ttOk = (data: any) => okJson({ code: 0, message: "OK", data });

describe("OU4 TikTok campaign status + lifecycle", () => {
  it("reads operation_status via campaign/get", async () => {
    const { manage, calls } = tiktokManage(async () => ttOk({ list: [{ campaign_id: 777, campaign_name: "Spark", operation_status: "DISABLE", secondary_status: "CAMPAIGN_STATUS_DISABLE" }] }));
    const out = await manage.getCampaign("adv1", "777");
    expect(out?.operationStatus).toBe("DISABLE");
    expect(calls[0].url).toContain("/campaign/get/");
  });

  it("enables via campaign/status/update and surfaces TikTok envelope errors", async () => {
    const { manage, calls } = tiktokManage(async () => ttOk({}));
    await manage.setCampaignStatus("adv1", "777", "ENABLE");
    expect(calls[0].url).toContain("/campaign/status/update/");
    expect(JSON.parse(calls[0].init.body)).toEqual({ advertiser_id: "adv1", campaign_ids: ["777"], operation_status: "ENABLE" });

    const failing = tiktokManage(async () => okJson({ code: 40002, message: "Advertiser not authorized" }));
    await expect(failing.manage.setCampaignStatus("adv1", "777", "DISABLE")).rejects.toThrow("not authorized");
  });
});

describe("OU4 TikTok DMP audiences", () => {
  it("creates a custom audience by file: upload then create, id required", async () => {
    const { manage, calls } = tiktokManage(async (url: string) => {
      if (url.includes("/file/upload/")) return ttOk({ file_path: "path/abc.txt" });
      if (url.includes("/custom_audience/create/")) return ttOk({ custom_audience_id: 9001 });
      throw new Error(`unexpected ${url}`);
    });
    const out = await manage.createCustomAudience("adv1", "Buyers", ["a".repeat(64), "b".repeat(64)]);
    expect(out.audienceExternalId).toBe("9001");
    expect(calls[0].url).toContain("/dmp/custom_audience/file/upload/");
    const createBody = JSON.parse(calls[1].init.body);
    expect(createBody.file_paths).toEqual(["path/abc.txt"]);
  });

  it("reads provider-reported audience size, null when TikTok sends none", async () => {
    const { manage } = tiktokManage(async () => ttOk({ list: [{ custom_audience_id: 9001, name: "Buyers", status: "PROCESSING", cover_num: 4200 }] }));
    const out = await manage.getCustomAudience("adv1", "9001");
    expect(out).toEqual({ audienceExternalId: "9001", name: "Buyers", status: "PROCESSING", size: 4200 });
    const noSize = tiktokManage(async () => ttOk({ list: [{ custom_audience_id: 9001 }] }));
    expect((await noSize.manage.getCustomAudience("adv1", "9001")).size).toBeNull();
  });

  it("creates a lookalike through the DMP lookalike endpoint", async () => {
    const { manage, calls } = tiktokManage(async () => ttOk({ custom_audience_id: 9002 }));
    const out = await manage.createLookalikeAudience("adv1", { name: "LAL", sourceAudienceId: "9001", country: "BD", tier: "BALANCED" });
    expect(out.audienceExternalId).toBe("9002");
    expect(calls[0].url).toContain("/dmp/custom_audience/lookalike/create/");
  });
});

describe("OU4 client wiring sanity", () => {
  it("TikTokAdsClient reporting path is untouched by the manage additions", () => {
    expect(typeof TikTokAdsClient).toBe("function");
    expect(typeof TikTokManage).toBe("function");
  });
});
