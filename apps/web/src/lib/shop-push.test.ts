import { describe, expect, it } from "vitest";
import {
  isPushDismissedRecently,
  pushConfigFromPayload,
  pushDismissedKey,
  pushSubscribedKey,
  shouldShowPushPrompt,
  urlBase64ToUint8Array,
  type PushConfig,
} from "./shop-push";

/**
 * AB7 (AX16) — shop push helpers. Pinned rules: the VAPID key
 * converts byte-exactly (base64url, padding restored), a
 * dismissal silences the prompt for 30 days, and the prompt
 * shows only when config + APIs + undecided permission + no
 * prior subscribe/dismiss ALL line up.
 */

describe("urlBase64ToUint8Array", () => {
  it("decodes a known base64url value byte-exactly", () => {
    // "hello" in base64 is aGVsbG8=
    expect(Array.from(urlBase64ToUint8Array("aGVsbG8"))).toEqual([104, 101, 108, 108, 111]);
    expect(Array.from(urlBase64ToUint8Array("aGVsbG8="))).toEqual([104, 101, 108, 108, 111]);
  });

  it("handles the base64url alphabet (- and _) and missing padding", () => {
    // bytes [251, 255, 190] are "+/++" in base64, "-_--" in base64url
    expect(Array.from(urlBase64ToUint8Array("-_--"))).toEqual([251, 255, 190]);
    // single byte [255] is "/w==" in base64, "_w" unpadded base64url
    expect(Array.from(urlBase64ToUint8Array("_w"))).toEqual([255]);
  });

  it("round-trips a VAPID-shaped 65-byte key", () => {
    const bytes = new Uint8Array(65);
    bytes[0] = 0x04;
    for (let i = 1; i < 65; i++) bytes[i] = (i * 7) % 256;
    const b64url = Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(Array.from(urlBase64ToUint8Array(b64url))).toEqual(Array.from(bytes));
  });
});

describe("push storage keys", () => {
  it("are per-org", () => {
    expect(pushSubscribedKey("shop-a")).toBe("shop-push-subscribed:shop-a");
    expect(pushDismissedKey("shop-a")).toBe("shop-push-dismissed:shop-a");
    expect(pushSubscribedKey("shop-a")).not.toBe(pushSubscribedKey("shop-b"));
  });
});

describe("isPushDismissedRecently", () => {
  const now = 40 * 24 * 3600 * 1000; // day 40
  it("is true inside 30 days and false after", () => {
    expect(isPushDismissedRecently(String(now - 1000), now)).toBe(true);
    expect(isPushDismissedRecently(String(now - 29 * 24 * 3600 * 1000), now)).toBe(true);
    expect(isPushDismissedRecently(String(now - 31 * 24 * 3600 * 1000), now)).toBe(false);
  });
  it("is false for missing/corrupt values", () => {
    expect(isPushDismissedRecently(null, now)).toBe(false);
    expect(isPushDismissedRecently(undefined, now)).toBe(false);
    expect(isPushDismissedRecently("abc", now)).toBe(false);
    expect(isPushDismissedRecently("0", now)).toBe(false);
  });
});

describe("pushConfigFromPayload", () => {
  it("accepts an enabled config with a key", () => {
    expect(pushConfigFromPayload({ enabled: true, publicKey: "KEY", promptDelaySec: 5 })).toEqual({
      enabled: true,
      publicKey: "KEY",
      promptDelaySec: 5,
    });
  });
  it("rejects disabled, keyless, or malformed payloads", () => {
    expect(pushConfigFromPayload({ enabled: false, publicKey: "KEY" })).toBeNull();
    expect(pushConfigFromPayload({ enabled: true, publicKey: null })).toBeNull();
    expect(pushConfigFromPayload({ enabled: true, publicKey: "  " })).toBeNull();
    expect(pushConfigFromPayload(null)).toBeNull();
    expect(pushConfigFromPayload("nope")).toBeNull();
  });
  it("defaults a missing/invalid delay to 0", () => {
    expect(pushConfigFromPayload({ enabled: true, publicKey: "K" })?.promptDelaySec).toBe(0);
  });
});

describe("shouldShowPushPrompt", () => {
  const config: PushConfig = { enabled: true, publicKey: "KEY", promptDelaySec: 3 };
  const base = {
    config,
    hasNotificationApi: true,
    hasServiceWorker: true,
    hasPushManager: true,
    permission: "default",
    alreadySubscribed: false,
    dismissedRecently: false,
  };
  it("shows only when every gate passes", () => {
    expect(shouldShowPushPrompt(base)).toBe(true);
  });
  it("hides for each single failing gate", () => {
    expect(shouldShowPushPrompt({ ...base, config: null })).toBe(false);
    expect(shouldShowPushPrompt({ ...base, config: { ...config, publicKey: null } })).toBe(false);
    expect(shouldShowPushPrompt({ ...base, hasNotificationApi: false })).toBe(false);
    expect(shouldShowPushPrompt({ ...base, hasServiceWorker: false })).toBe(false);
    expect(shouldShowPushPrompt({ ...base, hasPushManager: false })).toBe(false);
    expect(shouldShowPushPrompt({ ...base, permission: "granted" })).toBe(false);
    expect(shouldShowPushPrompt({ ...base, permission: "denied" })).toBe(false);
    expect(shouldShowPushPrompt({ ...base, alreadySubscribed: true })).toBe(false);
    expect(shouldShowPushPrompt({ ...base, dismissedRecently: true })).toBe(false);
  });
});
