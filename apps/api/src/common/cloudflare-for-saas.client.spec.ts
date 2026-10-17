import {
  CloudflareForSaasClient,
  buildCreateCustomHostnameBody,
  httpsStatusDetail,
  mapHttpsStatus,
  parseCustomHostname,
} from "./cloudflare-for-saas.client";

/**
 * OU2 — CfS adapter specs. These prove OUR mapping and OUR
 * request shapes against stubbed provider responses modelled on
 * the shapes the TD spike evidenced (status + ssl.status). They
 * do NOT prove the live Cloudflare API contract — that proof is
 * owed via the owner's spare-domain test (TD D3).
 */

const CFG = { apiToken: "cf-token-1", zoneId: "zone-1" };

const jsonRes = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function recordingFetch(impl: (url: string, init?: any) => Promise<any>) {
  const calls: { url: string; init?: any }[] = [];
  const fn = async (url: string, init?: any) => {
    calls.push({ url, init });
    return impl(url, init);
  };
  return { calls, fn };
}

describe("OU2 adapter — request mapping (isolated in the client)", () => {
  it("create body carries the hostname + the spike-evidenced http DCV method", () => {
    expect(buildCreateCustomHostnameBody("shop.example.com")).toEqual({
      hostname: "shop.example.com",
      ssl: { method: "http", type: "dv" },
    });
  });

  it("create POSTs to the zone custom_hostnames path with Bearer auth and parses the record", async () => {
    const { calls, fn } = recordingFetch(async () =>
      jsonRes({ success: true, errors: [], result: { id: "ch-1", hostname: "shop.example.com", status: "pending", ssl: { status: "pending_validation" } } }),
    );
    const client = new CloudflareForSaasClient(fn as any);
    const out = await client.createCustomHostname(CFG, "shop.example.com");
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/custom_hostnames");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.authorization).toBe("Bearer cf-token-1");
    expect(JSON.parse(calls[0].init.body)).toEqual(buildCreateCustomHostnameBody("shop.example.com"));
    expect(out).toEqual({
      id: "ch-1", hostname: "shop.example.com",
      hostnameStatus: "pending", sslStatus: "pending_validation", validationProblems: [],
    });
  });

  it("getZone reads the zone and returns id + name", async () => {
    const { calls, fn } = recordingFetch(async () => jsonRes({ success: true, errors: [], result: { id: "zone-1", name: "qosprey.com" } }));
    const client = new CloudflareForSaasClient(fn as any);
    await expect(client.getZone(CFG)).resolves.toEqual({ id: "zone-1", name: "qosprey.com" });
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1");
    expect(calls[0].init.method).toBe("GET");
  });

  it("getCustomHostname GETs the record by id", async () => {
    const { calls, fn } = recordingFetch(async () =>
      jsonRes({ success: true, errors: [], result: { id: "ch-9", hostname: "a.com", status: "active", ssl: { status: "active" } } }),
    );
    const client = new CloudflareForSaasClient(fn as any);
    const out = await client.getCustomHostname(CFG, "ch-9");
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/custom_hostnames/ch-9");
    expect(out.hostnameStatus).toBe("active");
    expect(out.sslStatus).toBe("active");
  });

  it("a provider refusal throws the provider's own words (never a fake success)", async () => {
    const { fn } = recordingFetch(async () =>
      jsonRes({ success: false, errors: [{ code: 9109, message: "Invalid zone identifier" }], result: null }, 404),
    );
    const client = new CloudflareForSaasClient(fn as any);
    await expect(client.getZone(CFG)).rejects.toThrow("Invalid zone identifier");
  });

  it("an unparseable success envelope is a failure, not a hostname", async () => {
    const { fn } = recordingFetch(async () => jsonRes({ success: true, errors: [], result: { unexpected: true } }));
    const client = new CloudflareForSaasClient(fn as any);
    await expect(client.createCustomHostname(CFG, "shop.example.com")).rejects.toThrow(/সফল ধরা হয়নি/);
  });

  it("a network failure throws with the cause, token never in the message", async () => {
    const { fn } = recordingFetch(async () => { throw new Error("socket hangup"); });
    const client = new CloudflareForSaasClient(fn as any);
    const err = await client.getZone(CFG).catch((e) => e);
    expect(err.message).toContain("socket hangup");
    expect(err.message).not.toContain("cf-token-1");
  });
});

describe("OU2 adapter — status mapping (pending / active / failed)", () => {
  it("active requires BOTH hostname and ssl active", () => {
    expect(mapHttpsStatus({ hostnameStatus: "active", sslStatus: "active" })).toBe("active");
    expect(mapHttpsStatus({ hostnameStatus: "active", sslStatus: "pending_validation" })).toBe("pending");
    expect(mapHttpsStatus({ hostnameStatus: "pending", sslStatus: "active" })).toBe("pending");
  });

  it("pending is the default for in-flight and unknown vocabularies", () => {
    expect(mapHttpsStatus({ hostnameStatus: "pending", sslStatus: "pending_issuance" })).toBe("pending");
    expect(mapHttpsStatus({ hostnameStatus: "some_future_status", sslStatus: null })).toBe("pending");
    expect(mapHttpsStatus({ hostnameStatus: null, sslStatus: null })).toBe("pending");
  });

  it("failure markers on either leg map to failed", () => {
    expect(mapHttpsStatus({ hostnameStatus: "active", sslStatus: "validation_failed" })).toBe("failed");
    expect(mapHttpsStatus({ hostnameStatus: "blocked", sslStatus: "pending_validation" })).toBe("failed");
    expect(mapHttpsStatus({ hostnameStatus: "active", sslStatus: "certificate_expired" })).toBe("failed");
  });

  it("parse carries ssl validation errors verbatim into the detail", () => {
    const parsed = parseCustomHostname({
      id: "ch-2", hostname: "b.com", status: "pending",
      ssl: { status: "pending_validation", validation_errors: [{ message: "DNS target does not point to the fallback origin" }] },
    });
    expect(parsed?.validationProblems).toEqual(["DNS target does not point to the fallback origin"]);
    const detail = httpsStatusDetail(parsed!, "pending");
    expect(detail).toContain("DNS target does not point to the fallback origin");
    expect(detail).toContain("ssl status: pending_validation");
  });

  it("parse returns null without an id", () => {
    expect(parseCustomHostname(null)).toBeNull();
    expect(parseCustomHostname({ hostname: "x.com" })).toBeNull();
  });
});
