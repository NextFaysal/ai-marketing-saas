import { Injectable, Optional } from "@nestjs/common";

/**
 * SMS providers (MS4 adapter set behind ONE send contract).
 *
 * A message counts as sent ONLY on the gateway's documented
 * success response — every adapter throws otherwise, with the
 * gateway's own message verbatim where it provides one.
 *
 * Gateways:
 * - sslwireless: SSL Wireless (Bangladesh) v3 API. POST
 *   {base}/api/v3/send-sms JSON { api_token, sid, msisdn, sms,
 *   csms_id }; success = HTTP 200 with JSON status "SUCCESS".
 *   This is the platform path (Admin Console / env config) and
 *   also a tenant-selectable gateway. Semantics unchanged from
 *   the pre-MS4 provider.
 * - bulksmsbd: BulkSMS BD. POST {base}/api/smsapi form fields
 *   { api_key, type: "text", number, senderid, message };
 *   success = response code 202 ("SMS Submitted Successfully").
 *   The response is either a JSON body { response_code,
 *   error_message } or the bare numeric code as plain text; both
 *   shapes are parsed. The documented response carries NO message
 *   id, so the providerMessageId is the caller reference (the SSL
 *   fallback precedent). API shape + code table per the provider's
 *   public API documentation (mirrored at
 *   github.com/codernayeem/payment-sms-courier-api-docs and the
 *   public django-bulksms-bd package); the provider's own doc page
 *   is not publicly reachable (bulksmsbd.net/api answers 404), so
 *   this adapter is marked doc-verified-from-public-mirrors in
 *   the B2 acceptance — never claimed live-proven.
 * - alphasms: Alpha SMS (sms.net.bd). POST
 *   https://api.sms.net.bd/sendsms JSON { api_key, msg, to,
 *   sender_id }; success = JSON error 0 ("Request successfully
 *   submitted") with data.request_id. Verified against the
 *   provider's public documentation at https://sms.net.bd/api.
 *
 * Without configuration, sending throws an explicit configuration
 * error — there is no silent fallback or pretend-send.
 */
import { effectiveSmsConfig } from "../common/platform-config";

type FetchFn = typeof fetch;

export type SmsGatewayId = "sslwireless" | "bulksmsbd" | "alphasms";

export interface SmsGatewayConfig {
  apiKey: string;
  senderId: string;
  apiUrl?: string;
}

export interface SmsSendInput { to: string; text: string; reference: string }

async function sendSslWireless(fetchFn: FetchFn, cfg: SmsGatewayConfig, input: SmsSendInput): Promise<{ providerMessageId: string }> {
  const base = (cfg.apiUrl ?? "https://smsplus.sslwireless.com").replace(/\/+$/, "");
  const res = await fetchFn(`${base}/api/v3/send-sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_token: cfg.apiKey, sid: cfg.senderId, msisdn: input.to, sms: input.text, csms_id: input.reference }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SMS gateway HTTP ${res.status}: ${body?.error_message ?? body?.message ?? "unknown error"}`);
  if (body?.status !== "SUCCESS") {
    throw new Error(`SMS gateway did not accept the message: ${body?.error_message ?? body?.status ?? "unknown response"}`);
  }
  return { providerMessageId: String(body.csms_id ?? input.reference) };
}

/** BulkSMS BD documented response codes (public API doc mirror). */
export const BULKSMSBD_CODE_MEANINGS: Record<number, string> = {
  202: "SMS Submitted Successfully",
  1001: "Invalid Number",
  1002: "Sender ID not correct / sender ID is disabled",
  1003: "Required fields missing",
  1005: "Internal Error",
  1006: "Balance Validity Not Available",
  1007: "Balance Insufficient",
  1011: "User ID not found",
  1012: "Masking SMS must be sent in Bengali",
  1013: "Sender ID not found by gateway for this API key",
  1018: "The owner of this account is disabled",
  1031: "Account not verified",
  1032: "IP not whitelisted",
};

async function sendBulkSmsBd(fetchFn: FetchFn, cfg: SmsGatewayConfig, input: SmsSendInput): Promise<{ providerMessageId: string }> {
  const base = (cfg.apiUrl ?? "http://bulksmsbd.net/api/smsapi").replace(/\/+$/, "");
  const form = new URLSearchParams({
    api_key: cfg.apiKey, type: "text", number: input.to, senderid: cfg.senderId, message: input.text,
  });
  const res = await fetchFn(base, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json, text/plain" },
    body: form.toString(),
  });
  const rawText = await res.text().catch(() => "");
  let code: number | null = null;
  let errorMessage = "";
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === "object" && parsed.response_code !== undefined) {
      code = Number(parsed.response_code);
      errorMessage = String(parsed.error_message ?? "");
    }
  } catch { /* not JSON — fall through to the bare-code shape */ }
  if (code === null || !Number.isFinite(code)) {
    const m = rawText.trim().match(/^-?\d+/);
    code = m ? Number(m[0]) : null;
  }
  if (!res.ok) {
    throw new Error(`BulkSMS BD gateway HTTP ${res.status}: ${errorMessage || rawText.trim().slice(0, 200) || "unknown error"}`);
  }
  if (code !== 202) {
    const meaning = code !== null ? BULKSMSBD_CODE_MEANINGS[code] : undefined;
    const detail = errorMessage || meaning || rawText.trim().slice(0, 200) || "no response code";
    throw new Error(`BulkSMS BD gateway did not accept the message: ${code ?? "unknown"} — ${detail}`);
  }
  return { providerMessageId: input.reference };
}

async function sendAlphaSms(fetchFn: FetchFn, cfg: SmsGatewayConfig, input: SmsSendInput): Promise<{ providerMessageId: string }> {
  const base = (cfg.apiUrl ?? "https://api.sms.net.bd/sendsms").replace(/\/+$/, "");
  const res = await fetchFn(base, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_key: cfg.apiKey, msg: input.text, to: input.to, sender_id: cfg.senderId }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Alpha SMS gateway HTTP ${res.status}: ${body?.msg ?? "unknown error"}`);
  if (Number(body?.error) !== 0) {
    throw new Error(`Alpha SMS gateway did not accept the message: ${body?.msg ?? `error ${body?.error ?? "unknown response"}`}`);
  }
  return { providerMessageId: String(body?.data?.request_id ?? input.reference) };
}

@Injectable()
export class SmsProvider {
  // `any` on purpose (the EmailProvider transportOverride
  // precedent): Nest has no token for a fetch function, and
  // @Optional() then simply leaves it undefined.
  constructor(@Optional() fetchFn?: any) { this.fetchFn = (fetchFn as FetchFn) ?? fetch; }
  private readonly fetchFn: FetchFn;

  isConfigured(): boolean {
    return effectiveSmsConfig() !== null;
  }

  /** The platform path (pre-MS4 contract, unchanged): the Admin
   * Console SMS setting wins; SMS_* env vars are the fallback. */
  async send(input: SmsSendInput): Promise<{ providerMessageId: string }> {
    const cfg = effectiveSmsConfig();
    const token = cfg?.apiToken;
    const senderId = cfg?.senderId;
    if (!token || !senderId) {
      throw new Error("SMS is not configured: set the SMS gateway in the Admin Console (Settings) or SMS_API_TOKEN and SMS_SENDER_ID (SSL Wireless account) in the API environment.");
    }
    return sendSslWireless(this.fetchFn, { apiKey: token, senderId, apiUrl: cfg?.apiUrl }, input);
  }

  /** MS4 — send through an explicit gateway with an explicit
   * (tenant) config, behind the same sent-only-on-success
   * contract. */
  async sendWithGateway(gateway: SmsGatewayId, cfg: SmsGatewayConfig, input: SmsSendInput): Promise<{ providerMessageId: string }> {
    if (!cfg.apiKey || !cfg.senderId) {
      throw new Error(`SMS gateway "${gateway}" is not configured for this organization: an API key and a sender ID are both required.`);
    }
    switch (gateway) {
      case "sslwireless": return sendSslWireless(this.fetchFn, cfg, input);
      case "bulksmsbd": return sendBulkSmsBd(this.fetchFn, cfg, input);
      case "alphasms": return sendAlphaSms(this.fetchFn, cfg, input);
      default: throw new Error(`Unknown SMS gateway: ${gateway}`);
    }
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

/**
 * MS4 — generic phone normalization. BD numbers behave EXACTLY
 * as normalizeBdPhone (it runs first and its result wins).
 * Beyond BD: a leading "+" followed by 10–15 digits passes
 * through in E.164 digits form; without a plus, a 12–15 digit
 * number that does not start with 0 is taken as a full
 * country-code number. Anything else (short strings, national
 * formats we cannot place) still refuses — junk never sends.
 */
export function normalizePhoneGeneric(raw: string): string | null {
  const bd = normalizeBdPhone(String(raw ?? ""));
  if (bd) return bd;
  const trimmed = String(raw ?? "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }
  if (digits.length >= 12 && digits.length <= 15 && !digits.startsWith("0")) return digits;
  return null;
}
