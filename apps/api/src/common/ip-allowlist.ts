/**
 * Milestone 40 (Admin Phase A4): CIDR-aware IP allowlist matching
 * for the admin surface. Supports exact IPs and IPv4 CIDR ranges
 * (e.g. 203.0.113.0/24). IPv6 entries match exactly only.
 * An empty entry list means "no restriction".
 */
export function ipMatchesEntry(ip: string, entry: string): boolean {
  const candidate = String(ip ?? "").trim();
  const rule = String(entry ?? "").trim();
  if (!candidate || !rule) return false;
  if (!rule.includes("/")) return candidate === rule;
  const [base, bitsRaw] = rule.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (addr: string): number | null => {
    const parts = addr.split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const part of parts) {
      const v = Number(part);
      if (!Number.isInteger(v) || v < 0 || v > 255) return null;
      n = (n << 8) + v;
    }
    return n >>> 0;
  };
  const ipInt = toInt(candidate);
  const baseInt = toInt(base);
  if (ipInt === null || baseInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function ipAllowed(ip: string, entries: string[]): boolean {
  if (!entries.length) return true;
  return entries.some((entry) => ipMatchesEntry(ip, entry));
}
