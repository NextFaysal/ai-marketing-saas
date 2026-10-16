import { Injectable } from "@nestjs/common";

/**
 * GB3 (GC9): Cloudflare Turnstile verifier — a REAL call to
 * the siteverify endpoint (no mock): form-encoded POST with a
 * 5s timeout.
 *
 * Result contract:
 *  - { ok: true } only when Cloudflare answers success=true.
 *  - providerError: true when the provider could not be judged
 *    (network error / non-200 / unparseable body) — the gate
 *    still refuses, but marks the attempt log so staff can
 *    tell an outage apart from a failed shopper check.
 *  - Missing secret or token is a plain { ok: false,
 *    providerError: false } WITHOUT a network call.
 *
 * Injectable as a plain class so specs substitute a fake with
 * the same verify() shape.
 */
@Injectable()
export class TurnstileVerifier {
  async verify(
    secret: string | null | undefined,
    token: string | null | undefined,
    remoteIp?: string | null,
  ): Promise<{ ok: boolean; providerError: boolean }> {
    if (!secret || !token) return { ok: false, providerError: false };
    try {
      const body = new URLSearchParams();
      body.set("secret", String(secret));
      body.set("response", String(token));
      if (remoteIp) body.set("remoteip", String(remoteIp));
      const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res || res.status !== 200) return { ok: false, providerError: true };
      let parsed: any = null;
      try {
        parsed = await res.json();
      } catch {
        return { ok: false, providerError: true };
      }
      return { ok: parsed?.success === true, providerError: false };
    } catch {
      return { ok: false, providerError: true };
    }
  }
}
