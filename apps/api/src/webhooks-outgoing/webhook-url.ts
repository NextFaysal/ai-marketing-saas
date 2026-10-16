import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * GC23 — SSRF screen for outgoing webhook URLs.
 *
 * A merchant-supplied webhook URL is fetched by OUR server, so it
 * must never be able to reach the server itself, the LAN, cloud
 * metadata endpoints (169.254.169.254) or any other non-public
 * address. Rules:
 *  - https only;
 *  - the hostname is resolved (ALL A/AAAA records) and the URL is
 *    refused when ANY resolved address is private / loopback /
 *    link-local / reserved / multicast — a single bad record is
 *    enough to refuse (an attacker-controlled zone can mix one
 *    public and one private record);
 *  - literal private IPs and "localhost" are refused without DNS.
 *
 * The check runs at subscription create/update AND again inside
 * every delivery attempt.
 *
 * RESIDUAL RISK (honest note): validation and the actual fetch
 * resolve DNS separately, so a hostile zone with a very short TTL
 * can in theory rebind between the check and the connection
 * (TOCTOU). Closing that fully needs a connect-time address pin
 * (custom agent/dispatcher), which Node's global fetch does not
 * expose cleanly; the re-check at attempt time shrinks the window
 * to a single request and is the documented trade-off here.
 */

export type WebhookLookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

export const defaultWebhookLookup: WebhookLookupFn = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true }) as Promise<Array<{ address: string; family: number }>>;

const blocked = new BlockList();
// IPv4 non-public ranges (RFC 6890 / IANA special-purpose).
blocked.addSubnet("0.0.0.0", 8, "ipv4"); // "this network" / unspecified source
blocked.addSubnet("10.0.0.0", 8, "ipv4"); // private
blocked.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT shared address space
blocked.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blocked.addSubnet("169.254.0.0", 16, "ipv4"); // link-local (incl. cloud metadata)
blocked.addSubnet("172.16.0.0", 12, "ipv4"); // private
blocked.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
blocked.addSubnet("192.0.2.0", 24, "ipv4"); // TEST-NET-1 (documentation)
blocked.addSubnet("192.168.0.0", 16, "ipv4"); // private
blocked.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
blocked.addSubnet("198.51.100.0", 24, "ipv4"); // TEST-NET-2
blocked.addSubnet("203.0.113.0", 24, "ipv4"); // TEST-NET-3
blocked.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
blocked.addSubnet("240.0.0.0", 4, "ipv4"); // reserved / broadcast
// IPv6 non-public ranges.
blocked.addAddress("::1", "ipv6"); // loopback
blocked.addAddress("::", "ipv6"); // unspecified
blocked.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 well-known prefix (can embed private v4)
blocked.addSubnet("100::", 64, "ipv6"); // discard-only
blocked.addSubnet("2001:db8::", 32, "ipv6"); // documentation
blocked.addSubnet("fc00::", 7, "ipv6"); // unique local (fc00::/8 + fd00::/8)
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
blocked.addSubnet("ff00::", 8, "ipv6"); // multicast

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) must be judged by the
    // embedded IPv4 address, not the v6 wrapper.
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(address);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true; // not an IP at all — treat as blocked
}

export type WebhookUrlVerdict =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/**
 * Validate a webhook URL for SSRF safety. `lookupFn` is injectable
 * so specs can pin DNS answers without touching the network.
 */
export async function validateWebhookUrl(
  raw: unknown,
  lookupFn: WebhookLookupFn = defaultWebhookLookup,
): Promise<WebhookUrlVerdict> {
  const text = String(raw ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, reason: "URL টি সঠিক নয়" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Webhook URL অবশ্যই https:// দিয়ে শুরু হতে হবে" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Webhook URL-এ user/password থাকতে পারবে না" };
  }
  // URL keeps the brackets on an IPv6 literal hostname — strip
  // them so isIP() can judge the address itself.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[(.*)\]$/, "$1");
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    return { ok: false, reason: "localhost বা অভ্যন্তরীণ ঠিকানায় Webhook পাঠানো যাবে না" };
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      return { ok: false, reason: "এই IP ঠিকানাটি ব্যক্তিগত/সংরক্ষিত — পাবলিক ঠিকানা দিন" };
    }
    return { ok: true, url: parsed.toString() };
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupFn(host);
  } catch {
    return { ok: false, reason: "ডোমেইনটি resolve করা যাচ্ছে না" };
  }
  if (!addresses?.length) {
    return { ok: false, reason: "ডোমেইনটি resolve করা যাচ্ছে না" };
  }
  for (const a of addresses) {
    if (isBlockedAddress(a.address)) {
      return { ok: false, reason: "ডোমেইনটি ব্যক্তিগত/সংরক্ষিত ঠিকানায় resolve হচ্ছে — Webhook গ্রহণ করা যাবে না" };
    }
  }
  return { ok: true, url: parsed.toString() };
}
