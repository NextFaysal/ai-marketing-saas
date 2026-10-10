export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
