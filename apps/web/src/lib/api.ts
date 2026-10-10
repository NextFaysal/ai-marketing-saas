// Browser calls go through the same-origin /backend proxy
// (next.config rewrites it to the API service), so the app works
// on any domain with no build-time configuration. Setting
// NEXT_PUBLIC_API_URL at build time overrides this for exotic
// split-origin deployments.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/backend";

/**
 * Absolute, publicly reachable API base for copy-paste surfaces
 * (tracker snippet, webhook URLs). Without an explicit
 * NEXT_PUBLIC_API_URL it is this app's own origin + /backend,
 * which reaches the API on any standard deployment.
 */
export function publicApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") return `${window.location.origin}/backend`;
  return "/backend";
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("accessToken");
}

const NETWORK_ERROR_MESSAGE = "নেটওয়ার্কে সমস্যা হচ্ছে। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।";

async function fetchOnce(path: string, init: RequestInit, token: string | null): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const method = (init.method ?? "GET").toUpperCase();
  let res: Response;
  try {
    res = await fetchOnce(path, init, token);
  } catch (err) {
    // Transient network failures (tunnel hiccups, brief drops) surface as
    // TypeError "Failed to fetch". GETs are idempotent: retry with
    // backoff, then report a clear message instead of the raw browser one.
    if (method !== "GET") throw new Error(NETWORK_ERROR_MESSAGE);
    res = await fetchOnce(path, init, token).catch(async () => {
      await new Promise((r) => setTimeout(r, 800));
      return fetchOnce(path, init, token).catch(async () => {
        await new Promise((r) => setTimeout(r, 1600));
        return fetchOnce(path, init, token);
      });
    }).catch(() => { throw new Error(NETWORK_ERROR_MESSAGE); });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
