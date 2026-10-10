import { Injectable, Optional } from "@nestjs/common";

/**
 * SMS provider: SSL Wireless (Bangladesh) v3 API.
 * POST {SMS_API_URL}/api/v3/send-sms with api_token, sid (sender id),
 * msisdn, sms and a client reference (csms_id). SSL Wireless answers
 * JSON { status: "SUCCESS" | "FAILED", ... } - a message counts as
 * sent ONLY on status SUCCESS. Other BD gateways with different shapes
 * need their own provider class implementing the same send() contract;
 * nothing here pretends to be generic.
 * Without SMS_API_TOKEN/SMS_SENDER_ID, sending throws an explicit
 * configuration error.
 */
import { effectiveSmsConfig } from "../common/platform-config";

type FetchFn = typeof fetch;

@Injectable()
export class SmsProvider {
  constructor(@Optional() fetchFn?: FetchFn) { this.fetchFn = fetchFn ?? fetch; }
  private readonly fetchFn: FetchFn;

  isConfigured(): boolean {
    return effectiveSmsConfig() !== null;
  }

  async send(input: { to: string; text: string; reference: string }): Promise<{ providerMessageId: string }> {
    // Dynamic config (Milestone 33): the Admin Console SMS setting
    // wins; SMS_* env vars are the fallback.
    const cfg = effectiveSmsConfig();
    const token = cfg?.apiToken;
    const senderId = cfg?.senderId;
    if (!token || !senderId) {
      throw new Error("SMS is not configured: set the SMS gateway in the Admin Console (Settings) or SMS_API_TOKEN and SMS_SENDER_ID (SSL Wireless account) in the API environment.");
    }
    const base = (cfg?.apiUrl ?? "https://smsplus.sslwireless.com").replace(/\/+$/, "");
    const res = await this.fetchFn(`${base}/api/v3/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ api_token: token, sid: senderId, msisdn: input.to, sms: input.text, csms_id: input.reference }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`SMS gateway HTTP ${res.status}: ${body?.error_message ?? body?.message ?? "unknown error"}`);
    if (body?.status !== "SUCCESS") {
      throw new Error(`SMS gateway did not accept the message: ${body?.error_message ?? body?.status ?? "unknown response"}`);
    }
    return { providerMessageId: String(body.csms_id ?? input.reference) };
  }
}

/** Normalize a Bangladeshi mobile number to the gateway's 8801XXXXXXXXX form. */
export function normalizeBdPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("01")) return `880${digits.slice(1)}`;
  if (digits.length === 13 && digits.startsWith("8801")) return digits;
  if (digits.length === 10 && digits.startsWith("1")) return `880${digits}`;
  return null;
}
