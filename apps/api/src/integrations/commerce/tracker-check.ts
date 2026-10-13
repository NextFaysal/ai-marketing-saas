/**
 * EC10: honest tracker-presence check for a connected store.
 *
 * The S4 tracker (tracker.js + the store's public trackingKey)
 * is what makes native/Woo abandoned carts visible at all, so
 * the store-health page verifies it is actually installed by
 * fetching the store homepage. A fetch failure is "unknown",
 * never a fabricated pass/fail.
 */

export function detectTracker(html: string, trackingKey: string): boolean {
  if (!html || !trackingKey) return false;
  return html.includes("tracker.js") && html.includes(trackingKey);
}

export async function checkTrackerOnHomepage(
  storeUrl: string,
  trackingKey: string | null | undefined,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<{ status: "pass" | "fail" | "unknown"; evidence: string }> {
  if (!trackingKey) {
    return {
      status: "unknown",
      evidence: "স্টোরের trackingKey নেই — স্টোরটি পুনরায় তৈরি করলে key তৈরি হবে",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: any;
  try {
    res = await fetchFn(storeUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "QospreyStoreHealth/1.0 (tracker detection)" },
    } as any);
  } catch (e) {
    return {
      status: "unknown",
      evidence: `homepage fetch ব্যর্থ: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res?.ok) {
    return {
      status: "unknown",
      evidence: `homepage HTTP ${res?.status} — tracker যাচাই করা যায়নি`,
    };
  }

  let html = "";
  try {
    html = typeof res.text === "function" ? await res.text() : "";
  } catch (e) {
    return {
      status: "unknown",
      evidence: `homepage fetch ব্যর্থ: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (detectTracker(html, trackingKey)) {
    return {
      status: "pass",
      evidence: "homepage-এ tracker.js ও এই স্টোরের data-key পাওয়া গেছে",
    };
  }
  return {
    status: "fail",
    evidence: "homepage-এ tracker snippet পাওয়া যায়নি — গাইড অনুযায়ী বসান",
  };
}
