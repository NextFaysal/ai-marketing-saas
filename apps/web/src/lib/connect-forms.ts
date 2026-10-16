/**
 * CC5/CC6/CC7 (Connect Center B3) — request-body builders for the
 * connect forms embedded in the Connect Center.
 *
 * These builders produce EXACTLY the request shapes the existing
 * pages already send to the existing APIs (integrations page →
 * stores/woocommerce/shopify connects, orders page → courier
 * connect, inbox page → messaging/telegram/email connects). The
 * panels in `components/connect/` call the same endpoints with
 * these bodies — no new backend path is invented here, and the
 * original pages keep sending their own identical shapes.
 */

export interface WooConnectForm {
  storeId: string;
  consumerKey: string;
  consumerSecret: string;
  webhookSecret: string;
}

/** Integrations page shape: webhookSecret is omitted when blank. */
export function buildWooConnectBody(form: WooConnectForm) {
  return { ...form, webhookSecret: form.webhookSecret || undefined };
}

export type ShopifyAuthMode = "legacy" | "client-credentials";

export interface ShopifyLegacyForm { storeId: string; accessToken: string; apiSecret: string }
export interface ShopifyCcForm { clientId: string; clientSecret: string }

/** Integrations page shape: legacy sends the access token + app
 * secret; client-credentials sends the Dev Dashboard pair against
 * the same storeId. */
export function buildShopifyConnectBody(mode: ShopifyAuthMode, legacy: ShopifyLegacyForm, cc: ShopifyCcForm) {
  return mode === "client-credentials"
    ? { storeId: legacy.storeId, clientId: cc.clientId, clientSecret: cc.clientSecret }
    : { storeId: legacy.storeId, accessToken: legacy.accessToken, apiSecret: legacy.apiSecret };
}

export type CourierProvider = "steadfast" | "pathao" | "redx" | "ecourier";

export interface SteadfastForm { apiKey: string; secretKey: string }
export interface PathaoForm { clientId: string; clientSecret: string; username: string; password: string; sandbox: boolean }
export interface RedxForm { accessToken: string; baseUrl: string }
/** GB5: eCourier's self-serve API credentials (API Key + Secret + User ID). */
export interface EcourierForm { apiKey: string; apiSecret: string; userId: string; baseUrl: string }

export const PATHAO_SANDBOX_BASE = "https://courier-api-sandbox.pathao.com";

/** Orders page shapes for POST courier/connect. Steadfast is the
 * server default, but the panel names the provider explicitly —
 * CourierService.providerOf accepts it identically. Pathao's
 * sandbox checkbox maps to the sandbox base URL; RedX's optional
 * base URL is omitted when blank. */
export function buildCourierConnectBody(provider: CourierProvider, forms: { steadfast: SteadfastForm; pathao: PathaoForm; redx: RedxForm; ecourier?: EcourierForm }) {
  if (provider === "steadfast") {
    return { provider, apiKey: forms.steadfast.apiKey, secretKey: forms.steadfast.secretKey };
  }
  if (provider === "pathao") {
    return {
      provider,
      clientId: forms.pathao.clientId, clientSecret: forms.pathao.clientSecret,
      username: forms.pathao.username, password: forms.pathao.password,
      baseUrl: forms.pathao.sandbox ? PATHAO_SANDBOX_BASE : undefined,
    };
  }
  if (provider === "ecourier") {
    return {
      provider,
      apiKey: forms.ecourier?.apiKey, apiSecret: forms.ecourier?.apiSecret,
      userId: forms.ecourier?.userId, baseUrl: forms.ecourier?.baseUrl || undefined,
    };
  }
  return { provider, accessToken: forms.redx.accessToken, baseUrl: forms.redx.baseUrl || undefined };
}

export interface MessagingConnectForm {
  channel: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  phoneNumberId: string;
  pageId: string;
  appSource: string;
}

/** Inbox page shape: the form state is posted verbatim to
 * POST inbox/connect (ConnectMessagingDto), appSource included
 * (CC4). */
export function buildMessagingConnectBody(form: MessagingConnectForm) {
  return { ...form };
}

/** The appSource the messaging form starts with: the Connect
 * Center's "নিজের অ্যাপ দিয়ে" entry points pass ?appSource=own;
 * anything else starts on the platform app (inbox page logic). */
export function initialAppSource(search: string): "own" | "platform" {
  return new URLSearchParams(search).get("appSource") === "own" ? "own" : "platform";
}

export interface EmailChannelForm {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  password: string;
}

/** Inbox page shape for POST inbox/connect/email (ConnectEmailDto). */
export function buildEmailConnectBody(form: EmailChannelForm) {
  return { ...form };
}

/** Human line for the telegram connect result, mirroring the
 * inbox page: the webhook outcome is reported as the API states
 * it — registered, or NOT registered with its real reason. */
export function telegramResultText(res: { bot?: string; webhook?: { registered?: boolean; error?: string }; reconnected?: boolean }): string {
  const head = res.reconnected ? `আবার কানেক্ট হয়েছে (একই বটের রো হালনাগাদ হয়েছে): ${res.bot}` : `কানেক্ট হয়েছে: ${res.bot}`;
  return `${head} · Webhook: ${res.webhook?.registered ? "নিবন্ধিত ✅" : `হয়নি — ${res.webhook?.error ?? ""}`}`;
}

/** Human line for the email connect result (inbox page wording,
 * plus the CC7 reconnect truth). */
export function emailResultText(res: { mailbox?: string; reconnected?: boolean }): string {
  return res.reconnected ? `আবার কানেক্ট হয়েছে (একই মেইলবক্সের রো হালনাগাদ হয়েছে): ${res.mailbox}` : `কানেক্ট হয়েছে: ${res.mailbox}`;
}

// ---------- CC8: senders (MS4 endpoints) + own LLM key ----------

export interface SenderEmailForm {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  fromName: string;
  dkimSelector: string;
}

/** Messaging page shape for PUT messaging/senders/email: blank
 * optional fields are omitted (an omitted password keeps the
 * stored one; the server verifies by a real SMTP handshake). */
export function buildSenderEmailBody(form: SenderEmailForm) {
  return {
    smtpHost: form.smtpHost,
    smtpPort: Number(form.smtpPort),
    smtpUser: form.smtpUser || undefined,
    smtpPass: form.smtpPass || undefined,
    fromAddress: form.fromAddress,
    fromName: form.fromName || undefined,
    dkimSelector: form.dkimSelector || undefined,
  };
}

export interface SenderSmsForm {
  smsGateway: string;
  smsApiKey: string;
  smsSenderId: string;
  smsApiUrl: string;
}

/** Messaging page shape for PUT messaging/senders/sms. */
export function buildSenderSmsBody(form: SenderSmsForm) {
  return {
    smsGateway: form.smsGateway,
    smsApiKey: form.smsApiKey || undefined,
    smsSenderId: form.smsSenderId,
    smsApiUrl: form.smsApiUrl || undefined,
  };
}

export interface LlmConfigForm {
  provider: string;
  apiKey: string;
  model: string;
}

/** CC8 shape for PUT connections/llm-config: a blank model is
 * omitted (the provider's default model then applies). */
export function buildLlmConfigBody(form: LlmConfigForm) {
  return {
    provider: form.provider,
    apiKey: form.apiKey,
    model: form.model.trim() || undefined,
  };
}

// ---------- CC9: the tenant's OWN payment gateways ----------

export type GatewayProviderId = "sslcommerz" | "bkash" | "nagad" | "shurjopay" | "aamarpay";

export interface GatewayForm {
  storeId: string;
  storePass: string;
  username: string;
  password: string;
  appKey: string;
  appSecret: string;
  merchantId: string;
  privateKey: string;
  prefix: string;
  signatureKey: string;
  sandbox: boolean;
  /** GC12: gateway fee inputs as DISPLAYED (percent string /
   * taka string), prefilled from the gateway view. Optional so
   * legacy callers that never render fee inputs send NO fee keys
   * at all (the API then leaves stored fees untouched). */
  feePercent?: string;
  feeFixedTaka?: string;
}

// ---------- GC12: gateway fee conversions ----------

/** bps → percent input string (250 → "2.5", 200 → "2") — the
 * accounting page's bpsToPercent style. */
export function feeBpsToPercentInput(bps: number | null | undefined): string {
  if (bps == null) return "";
  return String(bps / 100);
}

/** minor string → taka input string (150 → "1.5", 155 → "1.55",
 * 100 → "1"), integer math only. Bad input → "". */
export function feeMinorToTakaInput(minor: string | null | undefined): string {
  if (minor == null || minor === "") return "";
  try {
    const v = BigInt(minor);
    const whole = v / 100n;
    const frac = v % 100n;
    if (frac === 0n) return whole.toString();
    return `${whole.toString()}.${frac.toString().padStart(2, "0").replace(/0+$/, "")}`;
  } catch { return ""; }
}

/** Percent input → bps. Empty input is a legitimate "no rate"
 * (bps: null — the caller sends an explicit clear ONLY in the
 * always-send panel flow; see buildGatewayBody). */
export function parseFeePercentToBps(input: string): { ok: true; bps: number | null } | { ok: false } {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: true, bps: null };
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false };
  return { ok: true, bps: Math.round(pct * 100) };
}

/** Taka input → minor string, exact string math (≤2 decimals).
 * Empty input → minor: null (same "no fixed fee" meaning). */
export function parseFeeTakaToMinor(input: string): { ok: true; minor: string | null } | { ok: false } {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: true, minor: null };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { ok: false };
  const [whole, frac = ""] = raw.split(".");
  const minor = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return { ok: true, minor: minor.toString() };
}

export interface PayoutForm {
  amountTaka: string;
  method: "bkash" | "bank";
  bkashNumber: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  branch: string;
}

/** CC10 shape for POST connections/payout-requests — the amount
 * is typed in taka and converted to minor units here (the API
 * validates the integer server-side and re-checks it against
 * the available balance); destination carries ONLY the chosen
 * method's fields. */
export function buildPayoutBody(form: PayoutForm) {
  const taka = Number(form.amountTaka);
  const amountMinor = Number.isFinite(taka) ? String(Math.round(taka * 100)) : "0";
  const destination = form.method === "bkash"
    ? { number: form.bkashNumber.trim() }
    : {
        accountName: form.accountName.trim(),
        accountNumber: form.accountNumber.trim(),
        bankName: form.bankName.trim(),
        ...(form.branch.trim() ? { branch: form.branch.trim() } : {}),
      };
  return { amountMinor, method: form.method, destination };
}

/** CC9 shape for PUT connections/payment-gateways/:provider —
 * only the provider's own field subset is sent; nothing of the
 * other providers leaks into a request.
 *
 * GC12 fee keys: the API applies KEY-PRESENCE semantics (present
 * key — even null — sets/clears; absent key leaves the stored
 * fee untouched). The gateway panel ALWAYS renders the fee
 * inputs prefilled from the stored view, so when either fee
 * field is defined this builder ALWAYS sends both keys with the
 * currently displayed values: an untouched re-save re-sends the
 * stored values (nothing can be wiped), and an input the
 * merchant deliberately cleared sends an explicit null (a real
 * clear). Callers that never define the fee fields (legacy
 * shapes) send no fee keys at all. The panel validates both
 * inputs before saving, so an unparseable value never reaches
 * this builder from the UI; the null fallback here is only a
 * defensive default. */
export function buildGatewayBody(provider: GatewayProviderId, form: GatewayForm) {
  let body: Record<string, unknown>;
  if (provider === "sslcommerz") {
    body = { storeId: form.storeId, storePass: form.storePass, sandbox: form.sandbox };
  } else if (provider === "bkash") {
    body = { username: form.username, password: form.password, appKey: form.appKey, appSecret: form.appSecret, sandbox: form.sandbox };
  } else if (provider === "shurjopay") {
    // Store ID is optional for ShurjoPay — omitted when blank
    // (the API then falls back to the prefix at checkout).
    body = {
      username: form.username, password: form.password, prefix: form.prefix,
      storeId: form.storeId.trim() || undefined, sandbox: form.sandbox,
    };
  } else if (provider === "aamarpay") {
    body = { storeId: form.storeId, signatureKey: form.signatureKey, sandbox: form.sandbox };
  } else {
    body = { merchantId: form.merchantId, privateKey: form.privateKey };
  }
  if (form.feePercent !== undefined || form.feeFixedTaka !== undefined) {
    const bps = parseFeePercentToBps(form.feePercent ?? "");
    const fixed = parseFeeTakaToMinor(form.feeFixedTaka ?? "");
    body.feeBps = bps.ok ? bps.bps : null;
    body.feeFixedMinor = fixed.ok ? fixed.minor : null;
  }
  return body;
}
