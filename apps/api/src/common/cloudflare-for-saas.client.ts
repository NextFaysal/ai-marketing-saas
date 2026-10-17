/**
 * OU2 — Cloudflare for SaaS (Custom Hostnames) adapter.
 *
 * ⚠️ ISOLATION: this file is the ONLY place in the codebase that
 * speaks HTTP to the Cloudflare API for custom hostnames. Every
 * request/response mapping for that API lives here and nowhere
 * else, so when the live contract is finally proven (owner's
 * spare-domain test, TD checklist D3) any correction lands in
 * this one file.
 *
 * What the REPO evidences about the contract (docs/td-tb4-ssl-spike.md
 * §3, sourced there to Cloudflare's own docs):
 *  - a custom hostname is created per merchant domain in OUR zone;
 *  - hostname ownership validation is the hostname's `status`;
 *  - certificate validation/DCV is the SEPARATE `ssl.status`;
 *  - BOTH must be active before the hostname serves production;
 *  - the cert validation method is chosen at create (`ssl.method`:
 *    http | txt | email) — we use "http" (the spike's default path;
 *    merchant CNAMEs the name at the SaaS target first);
 *  - the API token is zone-scoped with SSL/custom-hostname
 *    permissions (exact permission names were NOT confirmable from
 *    the repo — the runbook marks them যাচাই সাপেক্ষে).
 *
 * What is NOT evidenced in the repo and is therefore an adapter
 * assumption, isolated here: the exact API v4 URL shapes
 * (/zones/{zoneId}/custom_hostnames…), the Bearer-token auth
 * header, the { success, errors, result } envelope, and the full
 * ssl.status vocabulary. The response parsing below is defensive
 * (unknown shapes → a failed/unknown result, never a fabricated
 * "active"), and LIVE API PROOF IS OWED — nothing in this file
 * has ever run against the real Cloudflare API.
 *
 * Honesty discipline (package-wide): a hostname is reported
 * "active" ONLY when Cloudflare's own response says both the
 * hostname status and the ssl status are active. Anything else
 * is pending or failed, with the provider's words carried in the
 * detail where it gave any.
 */

export interface CloudflareSaasCredentials {
  apiToken: string;
  zoneId: string;
}

/** Merchant-facing HTTPS provisioning state. `not_configured`
 * is decided by the CALLER (no usable platform config) — the
 * adapter itself only ever yields pending | active | failed. */
export type DomainHttpsStatus = "not_configured" | "pending" | "active" | "failed";

/** Normalised view of one Cloudflare custom-hostname record. */
export interface CfsCustomHostname {
  id: string;
  hostname: string;
  /** Raw provider hostname-validation status (e.g. "active",
   * "pending") — kept verbatim for diagnostics. */
  hostnameStatus: string | null;
  /** Raw provider certificate status (e.g. "pending_validation",
   * "active") — kept verbatim for diagnostics. */
  sslStatus: string | null;
  /** Provider-reported validation problems, verbatim. */
  validationProblems: string[];
}

/** The create-request body for one hostname. `ssl.method: "http"`
 * is the spike-evidenced DCV choice (§3.2: HTTP DCV runs once the
 * merchant points the name at the SaaS target; no extra merchant
 * TXT is demanded). Everything else in the body is the adapter's
 * isolated mapping. */
export function buildCreateCustomHostnameBody(hostname: string): Record<string, unknown> {
  return {
    hostname,
    ssl: { method: "http", type: "dv" },
  };
}

/** Provider ssl/hostname statuses that mean the certificate or
 * the hostname validation has FAILED (as opposed to still
 * working). Matched case-insensitively as substrings so provider
 * variants ("validation_failed", "issuance_failed", …) all land
 * on failed instead of being silently read as pending forever. */
const FAILED_MARKERS = ["fail", "blocked", "error", "expired", "revoked"] as const;

function statusFailed(raw: string | null): boolean {
  if (!raw) return false;
  const s = raw.toLowerCase();
  return FAILED_MARKERS.some((m) => s.includes(m));
}

/**
 * THE status mapping (ours — unit-tested as ours):
 *  - active  ⇔ hostname status AND ssl status are both "active"
 *    (the spike's production-ready rule, §3.1).
 *  - failed  ⇔ either status carries a failure marker, or the
 *    provider reported validation problems alongside a
 *    non-active state… no: validation problems ALONE stay
 *    pending (HTTP DCV commonly reports transient problems while
 *    DNS propagates); failed requires a failure marker.
 *  - pending ⇔ everything else (including unknown vocabularies —
 *    an unrecognised status is NEVER promoted to active).
 */
export function mapHttpsStatus(h: Pick<CfsCustomHostname, "hostnameStatus" | "sslStatus">): Exclude<DomainHttpsStatus, "not_configured"> {
  if (statusFailed(h.hostnameStatus) || statusFailed(h.sslStatus)) return "failed";
  if (h.hostnameStatus === "active" && h.sslStatus === "active") return "active";
  return "pending";
}

/** Human detail for a mapped state, built ONLY from provider
 * fields (statuses + validation problems verbatim). */
export function httpsStatusDetail(h: CfsCustomHostname, mapped: Exclude<DomainHttpsStatus, "not_configured">): string {
  const parts: string[] = [];
  if (mapped === "active") {
    parts.push("Cloudflare hostname ও সার্টিফিকেট দুটোই active বলেছে।");
  } else if (mapped === "failed") {
    parts.push("Cloudflare যাচাই ব্যর্থ বলেছে।");
  } else {
    parts.push("Cloudflare-এ সার্টিফিকেট ইস্যু/যাচাই চলমান।");
  }
  if (h.hostnameStatus) parts.push(`hostname status: ${h.hostnameStatus}`);
  if (h.sslStatus) parts.push(`ssl status: ${h.sslStatus}`);
  if (h.validationProblems.length > 0) parts.push(`সমস্যা: ${h.validationProblems.join(" | ")}`);
  return parts.join(" · ").slice(0, 900);
}

/** Defensive parse of one custom-hostname record out of the
 * provider envelope's `result`. Returns null when the shape is
 * unrecognisable (no id) — callers treat that as a failure,
 * never as success. */
export function parseCustomHostname(result: any): CfsCustomHostname | null {
  if (!result || typeof result !== "object") return null;
  const id = typeof result.id === "string" ? result.id : "";
  if (!id) return null;
  const problems: string[] = [];
  const sslErrors = result.ssl?.validation_errors;
  if (Array.isArray(sslErrors)) {
    for (const e of sslErrors) {
      const m = typeof e === "string" ? e : (typeof e?.message === "string" ? e.message : "");
      if (m) problems.push(m);
    }
  }
  const ownershipErrors = result.ownership_verification?.errors;
  if (Array.isArray(ownershipErrors)) {
    for (const e of ownershipErrors) {
      if (typeof e === "string" && e) problems.push(e);
    }
  }
  return {
    id,
    hostname: typeof result.hostname === "string" ? result.hostname : "",
    hostnameStatus: typeof result.status === "string" ? result.status : null,
    sslStatus: typeof result.ssl?.status === "string" ? result.ssl.status : null,
    validationProblems: problems,
  };
}

/** Provider error text out of the envelope, verbatim where the
 * provider gave any. */
function envelopeError(json: any, httpStatus: number): string {
  const errs = Array.isArray(json?.errors) ? json.errors : [];
  const msgs = errs.map((e: any) => (typeof e?.message === "string" ? e.message : "")).filter(Boolean);
  if (msgs.length > 0) return msgs.join(" | ");
  return `Cloudflare উত্তর দিয়েছে HTTP ${httpStatus} — কোনো ত্রুটি-বার্তা দেয়নি।`;
}

type FetchImpl = (url: string, init?: any) => Promise<any>;

/**
 * The CfS HTTP client. Injectable as a plain class (Turnstile
 * precedent) with a fetch seam so specs substitute a fake with
 * the same shape; production uses the global fetch. All methods
 * THROW an Error carrying the provider's own words on failure —
 * callers decide how to record that (the storefront hook records
 * status "failed"; the admin verify refuses the save).
 */
export class CloudflareForSaasClient {
  private readonly fetchImpl: FetchImpl;
  private readonly baseUrl: string;

  constructor(fetchImpl?: FetchImpl, baseUrl = "https://api.cloudflare.com/client/v4") {
    this.fetchImpl = fetchImpl ?? ((url: string, init?: any) => fetch(url, init));
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request(cfg: CloudflareSaasCredentials, method: string, path: string, body?: unknown): Promise<any> {
    let res: any;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${cfg.apiToken}`,
          "content-type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new Error(`Cloudflare API-তে পৌঁছানো যায়নি: ${e instanceof Error ? e.message : String(e)}`);
    }
    const json: any = await res.json().catch(() => null);
    const httpOk = typeof res.status === "number" ? res.status >= 200 && res.status < 300 : res.ok === true;
    if (!httpOk || json?.success !== true) {
      throw new Error(envelopeError(json, typeof res.status === "number" ? res.status : 0));
    }
    return json.result;
  }

  /** Zone read — the cheapest TRUE credential proof for the
   * admin verify-before-save / test button: the token must be
   * accepted AND scoped to this zone for Cloudflare to answer. */
  async getZone(cfg: CloudflareSaasCredentials): Promise<{ id: string; name: string | null }> {
    const result = await this.request(cfg, "GET", `/zones/${encodeURIComponent(cfg.zoneId)}`);
    if (!result || typeof result !== "object" || typeof result.id !== "string") {
      throw new Error("Cloudflare zone উত্তরের আকার বোঝা যায়নি — zone যাচাই করা গেল না।");
    }
    return { id: result.id, name: typeof result.name === "string" ? result.name : null };
  }

  async createCustomHostname(cfg: CloudflareSaasCredentials, hostname: string): Promise<CfsCustomHostname> {
    const result = await this.request(
      cfg,
      "POST",
      `/zones/${encodeURIComponent(cfg.zoneId)}/custom_hostnames`,
      buildCreateCustomHostnameBody(hostname),
    );
    const parsed = parseCustomHostname(result);
    if (!parsed) throw new Error("Cloudflare custom hostname তৈরি হয়েছে বলে উত্তর দিলেও record-এর আকার বোঝা যায়নি — অবস্থা অজানা, সফল ধরা হয়নি।");
    return parsed;
  }

  async getCustomHostname(cfg: CloudflareSaasCredentials, customHostnameId: string): Promise<CfsCustomHostname> {
    const result = await this.request(
      cfg,
      "GET",
      `/zones/${encodeURIComponent(cfg.zoneId)}/custom_hostnames/${encodeURIComponent(customHostnameId)}`,
    );
    const parsed = parseCustomHostname(result);
    if (!parsed) throw new Error("Cloudflare custom hostname উত্তরের আকার বোঝা যায়নি — অবস্থা অজানা, আগের অবস্থাই সত্য বলে ধরা হয়নি।");
    return parsed;
  }
}
