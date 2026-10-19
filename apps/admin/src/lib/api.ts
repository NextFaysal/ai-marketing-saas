// Admin app API client. Same-origin /backend proxy (next.config
// rewrites to the API), token stored under a SEPARATE key so admin
// and tenant sessions never mix.
import { fmtMoneyMinor, fmtNumber, type UiLocale } from "@repo/contracts";
import { getAdminDict, resolveAdminLocale } from "./i18n";

export const API_URL = "/backend";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("admin_access_token");
}
export function setAdminToken(token: string | null) {
  if (token) localStorage.setItem("admin_access_token", token);
  else localStorage.removeItem("admin_access_token");
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  }).catch(() => { throw new Error(getAdminDict(resolveAdminLocale()).common.networkError); });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Bare two-decimal minor→major string (NO currency symbol — callers
 *  prefix ৳ themselves), now locale-aware. Built on contracts
 *  fmtMoneyMinor (bigint-exact split, locale digits + grouping, symbol
 *  off); fmtMoneyMinor omits the fraction for whole amounts, so the
 *  trailing ".00" the old contract guarantees is appended (with the
 *  locale's own decimal separator and digits) in that case only. */
export function formatMinorStr(minor: string | number, locale: UiLocale = "bn"): string {
  const v = typeof minor === "string" ? BigInt(minor) : BigInt(Math.round(minor));
  const base = fmtMoneyMinor(locale, v, { showSymbol: false });
  if (v % 100n !== 0n) return base;
  const probe = fmtNumber(locale, 1.5, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const sep = probe.replace(/[0-9০-৯]/g, "") || ".";
  const zeros = fmtNumber(locale, 0, { minimumIntegerDigits: 2, useGrouping: false });
  return `${base}${sep}${zeros}`;
}
