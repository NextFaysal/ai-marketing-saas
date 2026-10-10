// Admin app API client. Same-origin /backend proxy (next.config
// rewrites to the API), token stored under a SEPARATE key so admin
// and tenant sessions never mix.
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
  }).catch(() => { throw new Error("নেটওয়ার্কে সমস্যা হচ্ছে। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।"); });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function formatMinorStr(minor: string | number): string {
  const v = typeof minor === "string" ? BigInt(minor) : BigInt(Math.round(minor));
  const neg = v < 0n; const abs = neg ? -v : v;
  return `${neg ? "-" : ""}${(abs / 100n).toLocaleString("en-US")}.${String(abs % 100n).padStart(2, "0")}`;
}
