import { decryptJson, encryptJson } from "../integrations/crypto";
import { setMetaGraphVersionOverride } from "./meta-graph";

/**
 * Dynamic platform configuration (Milestone 33).
 *
 * The SaaS operator configures platform-level integrations from the
 * Admin Console — LLM provider, the platform Meta app, SMTP and the
 * SMS gateway — without touching server env or restarting. Values
 * live in the SystemSetting store (keys below); secrets are stored
 * AES-256-GCM encrypted and are NEVER returned by any API (the
 * admin safe view reports only `secretConfigured: boolean`).
 *
 * Resolution order everywhere: admin setting -> environment ->
 * built-in default. Boot secrets (DATABASE_URL, JWT_SECRET,
 * ENCRYPTION_KEY, ports) deliberately stay in env: ENCRYPTION_KEY
 * is what decrypts everything stored here, so it can never itself
 * be stored in the database.
 *
 * Reads go through a process-wide snapshot: refreshed at boot, on
 * every admin write, and by the scheduler tick (worst case ~60s
 * propagation). Sync consumers (LLM factory, email/SMS providers)
 * read the snapshot; async consumers may refresh on demand. All
 * loaders are defensive — a missing table/row/decrypt failure
 * means "not configured", never a crash.
 */

export interface LlmConfig { provider: string; model?: string; apiKey: string }
export interface MetaAppConfig { appId?: string; appSecret?: string; adLibraryToken?: string; graphVersion?: string }
export interface SmtpConfig { host: string; port: number; user?: string; pass?: string; from?: string }
export interface SmsConfig { apiToken: string; senderId: string; apiUrl?: string }
export interface SslcommerzConfig { storeId: string; storePass: string; sandbox: boolean }
export interface BkashConfig { appKey: string; appSecret: string; username: string; password: string; sandbox: boolean }
export interface ImageConfig { provider: string; model?: string; apiKey: string }
/** SP8: the OPERATOR's TikTok app (one app for the whole SaaS;
 * tenants OAuth their own creator accounts into it). `audited`
 * is the operator's declaration that TikTok has approved the app
 * for direct posting — it unlocks the direct-post adapter path
 * and the video.publish scope; it is never inferred. */
export interface TiktokAppConfig { clientKey: string; clientSecret: string; redirectUri?: string; audited: boolean }
/** SP9: the OPERATOR's Google app for YouTube (same one-app
 * model). Tenants OAuth their own Google accounts into it. */
export interface GoogleAppConfig { clientId: string; clientSecret: string; redirectUri?: string }
/** CC20: the OPERATOR's LinkedIn app for Page connect +
 * organic posting (same one-app model as Google/TikTok).
 * Live posting additionally requires LinkedIn's Community
 * Management API approval for THIS app — a platform-side gate
 * the config cannot declare away; the app carries no such flag
 * because approval is LinkedIn's to grant, not ours to assert. */
export interface LinkedinAppConfig { clientId: string; clientSecret: string; redirectUri?: string }
/** SN7: the OPERATOR's Threads app (a Threads use-case app
 * inside a Meta app — its App ID/Secret are DISTINCT from the
 * Facebook app's). Same one-app model as LinkedIn. Production
 * publishing additionally requires Meta App Review (Advanced
 * Access for threads_content_publish) — Meta's gate, surfaced
 * verbatim when it refuses; the config cannot declare it away. */
export interface ThreadsAppConfig { clientId: string; clientSecret: string; redirectUri?: string }
/** CC10: platform-payment wallet settings. `feeBps` is the
 * platform fee on PLATFORM-gateway payments, in basis points
 * (200 = 2%). It is read at the moment a verified payment is
 * credited — the fee applied is the CURRENT configured value,
 * computed server-side. Absent/invalid config means feeBps 0:
 * a fee is never invented. */
export interface WalletConfig {
  feeBps: number;
  /** CC23: four-eyes payout threshold in minor units. When
   * set (a non-negative integer), a payout at/above this
   * amount may not be marked paid by the same admin who
   * approved it. Null/absent = the feature is OFF — mark-paid
   * behaves exactly as CC10 defined it. */
  payoutFourEyesThresholdMinor?: number | null;
}

export interface PlatformConfigSnapshot {
  llm: LlmConfig | null;
  metaApp: MetaAppConfig | null;
  smtp: SmtpConfig | null;
  sms: SmsConfig | null;
  sslcommerz: SslcommerzConfig | null;
  bkash: BkashConfig | null;
  image: ImageConfig | null;
  tiktokApp: TiktokAppConfig | null;
  googleApp: GoogleAppConfig | null;
  linkedinApp: LinkedinAppConfig | null;
  threadsApp: ThreadsAppConfig | null;
  wallet: WalletConfig | null;
  loadedAt: number;
}

export const PLATFORM_CONFIG_KEYS = ["llmConfig", "metaAppConfig", "smtpConfig", "smsConfig", "sslcommerzConfig", "bkashConfig", "imageConfig", "tiktokAppConfig", "googleAppConfig", "walletConfig", "linkedinAppConfig", "threadsAppConfig"] as const;

let snapshot: PlatformConfigSnapshot = { llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null, image: null, tiktokApp: null, googleApp: null, linkedinApp: null, threadsApp: null, wallet: null, loadedAt: 0 };

export function getPlatformConfigSync(): PlatformConfigSnapshot {
  return snapshot;
}

/** Test hook + admin-write hook: replace the snapshot directly.
 * Newer areas are optional for callers so older test setups keep
 * working when the snapshot grows (sslcommerz arrived in M36). */
export function setPlatformConfigSnapshot(next: Omit<PlatformConfigSnapshot, "sslcommerz" | "bkash" | "image" | "tiktokApp" | "googleApp" | "wallet" | "linkedinApp" | "threadsApp"> & { sslcommerz?: SslcommerzConfig | null; bkash?: BkashConfig | null; image?: ImageConfig | null; tiktokApp?: TiktokAppConfig | null; googleApp?: GoogleAppConfig | null; wallet?: WalletConfig | null; linkedinApp?: LinkedinAppConfig | null; threadsApp?: ThreadsAppConfig | null }) {
  snapshot = { sslcommerz: null, bkash: null, image: null, tiktokApp: null, googleApp: null, wallet: null, linkedinApp: null, threadsApp: null, ...next };
  setMetaGraphVersionOverride(next.metaApp?.graphVersion ?? null);
}

export function unseal(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const out = decryptJson<{ v: string }>(value);
    return typeof out?.v === "string" ? out.v : undefined;
  } catch {
    return undefined;
  }
}

export function seal(secret: string): string {
  return encryptJson({ v: secret });
}

async function readKey(prisma: any, key: string): Promise<any> {
  try {
    const row = await prisma.systemSetting?.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/** Load + decrypt all areas from the store into the snapshot. */
export async function refreshPlatformConfig(prisma: any): Promise<PlatformConfigSnapshot> {
  const [llmRaw, metaRaw, smtpRaw, smsRaw, sslRaw, bkashRaw, imageRaw, tiktokRaw, googleRaw, walletRaw, linkedinRaw, threadsRaw] = await Promise.all([
    readKey(prisma, "llmConfig"), readKey(prisma, "metaAppConfig"),
    readKey(prisma, "smtpConfig"), readKey(prisma, "smsConfig"),
    readKey(prisma, "sslcommerzConfig"), readKey(prisma, "bkashConfig"),
    readKey(prisma, "imageConfig"),
    readKey(prisma, "tiktokAppConfig"), readKey(prisma, "googleAppConfig"),
    readKey(prisma, "walletConfig"), readKey(prisma, "linkedinAppConfig"),
    readKey(prisma, "threadsAppConfig"),
  ]);
  const llm: LlmConfig | null = llmRaw?.provider
    ? { provider: String(llmRaw.provider), model: llmRaw.model ? String(llmRaw.model) : undefined, apiKey: unseal(llmRaw.apiKeyEncrypted) ?? "" }
    : null;
  const metaApp: MetaAppConfig | null = metaRaw && (metaRaw.appId || metaRaw.appSecretEncrypted || metaRaw.adLibraryTokenEncrypted || metaRaw.graphVersion)
    ? {
        appId: metaRaw.appId ? String(metaRaw.appId) : undefined,
        appSecret: unseal(metaRaw.appSecretEncrypted),
        adLibraryToken: unseal(metaRaw.adLibraryTokenEncrypted),
        graphVersion: metaRaw.graphVersion ? String(metaRaw.graphVersion) : undefined,
      }
    : null;
  const smtp: SmtpConfig | null = smtpRaw?.host
    ? {
        host: String(smtpRaw.host), port: Number(smtpRaw.port ?? 587),
        user: smtpRaw.user ? String(smtpRaw.user) : undefined,
        pass: unseal(smtpRaw.passEncrypted),
        from: smtpRaw.from ? String(smtpRaw.from) : undefined,
      }
    : null;
  const sms: SmsConfig | null = smsRaw?.senderId
    ? { apiToken: unseal(smsRaw.apiTokenEncrypted) ?? "", senderId: String(smsRaw.senderId), apiUrl: smsRaw.apiUrl ? String(smsRaw.apiUrl) : undefined }
    : null;
  const sslcommerz: SslcommerzConfig | null = sslRaw?.storeId
    ? { storeId: String(sslRaw.storeId), storePass: unseal(sslRaw.storePassEncrypted) ?? "", sandbox: sslRaw.sandbox !== false }
    : null;
  const bkash: BkashConfig | null = bkashRaw?.appKey
    ? {
        appKey: String(bkashRaw.appKey), appSecret: unseal(bkashRaw.appSecretEncrypted) ?? "",
        username: bkashRaw.username ? String(bkashRaw.username) : "",
        password: unseal(bkashRaw.passwordEncrypted) ?? "", sandbox: bkashRaw.sandbox !== false,
      }
    : null;
  const image: ImageConfig | null = imageRaw?.provider
    ? { provider: String(imageRaw.provider), model: imageRaw.model ? String(imageRaw.model) : undefined, apiKey: unseal(imageRaw.apiKeyEncrypted) ?? "" }
    : null;
  const tiktokApp: TiktokAppConfig | null = tiktokRaw?.clientKey
    ? {
        clientKey: String(tiktokRaw.clientKey),
        clientSecret: unseal(tiktokRaw.clientSecretEncrypted) ?? "",
        redirectUri: tiktokRaw.redirectUri ? String(tiktokRaw.redirectUri) : undefined,
        audited: tiktokRaw.audited === true,
      }
    : null;
  const googleApp: GoogleAppConfig | null = googleRaw?.clientId
    ? {
        clientId: String(googleRaw.clientId),
        clientSecret: unseal(googleRaw.clientSecretEncrypted) ?? "",
        redirectUri: googleRaw.redirectUri ? String(googleRaw.redirectUri) : undefined,
      }
    : null;
  const walletFeeBps = Number(walletRaw?.feeBps);
  const walletThresholdRaw = walletRaw?.payoutFourEyesThresholdMinor;
  const walletThreshold: number | null = walletThresholdRaw !== null && walletThresholdRaw !== undefined
    && Number.isInteger(Number(walletThresholdRaw)) && Number(walletThresholdRaw) >= 0
    ? Number(walletThresholdRaw)
    : null;
  const wallet: WalletConfig | null = walletRaw && Number.isInteger(walletFeeBps) && walletFeeBps >= 0 && walletFeeBps <= 10_000
    ? { feeBps: walletFeeBps, payoutFourEyesThresholdMinor: walletThreshold }
    : walletRaw && walletThreshold !== null
      ? { feeBps: 0, payoutFourEyesThresholdMinor: walletThreshold }
      : null;
  const linkedinApp: LinkedinAppConfig | null = linkedinRaw?.clientId
    ? {
        clientId: String(linkedinRaw.clientId),
        clientSecret: unseal(linkedinRaw.clientSecretEncrypted) ?? "",
        redirectUri: linkedinRaw.redirectUri ? String(linkedinRaw.redirectUri) : undefined,
      }
    : null;
  const threadsApp: ThreadsAppConfig | null = threadsRaw?.clientId
    ? {
        clientId: String(threadsRaw.clientId),
        clientSecret: unseal(threadsRaw.clientSecretEncrypted) ?? "",
        redirectUri: threadsRaw.redirectUri ? String(threadsRaw.redirectUri) : undefined,
      }
    : null;
  const next: PlatformConfigSnapshot = { llm, metaApp, smtp, sms, sslcommerz, bkash, image, tiktokApp, googleApp, linkedinApp, threadsApp, wallet, loadedAt: Date.now() };
  setPlatformConfigSnapshot(next);
  return next;
}

/** Refresh if the snapshot is older than `maxAgeMs` (default 30s). */
export async function ensurePlatformConfig(prisma: any, maxAgeMs = 30_000): Promise<PlatformConfigSnapshot> {
  if (Date.now() - snapshot.loadedAt <= maxAgeMs && snapshot.loadedAt > 0) return snapshot;
  return refreshPlatformConfig(prisma);
}

/** Effective LLM config: admin setting wins, env is the fallback. */
export function effectiveLlmConfig(): { provider: string; apiKey: string; model?: string; source: "admin" | "env" | "none" } {
  const dyn = snapshot.llm;
  if (dyn?.provider) return { provider: dyn.provider, apiKey: dyn.apiKey, model: dyn.model, source: "admin" };
  const provider = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  if (provider) return { provider, apiKey: process.env.LLM_API_KEY ?? "", model: process.env.LLM_MODEL || undefined, source: "env" };
  return { provider: "", apiKey: "", source: "none" };
}

/** Effective image-generation config: admin setting wins, env is the fallback. */
export function effectiveImageConfig(): { provider: string; apiKey: string; model?: string; source: "admin" | "env" | "none" } {
  const dyn = snapshot.image;
  if (dyn?.provider) return { provider: dyn.provider, apiKey: dyn.apiKey, model: dyn.model, source: "admin" };
  const provider = (process.env.IMAGE_PROVIDER ?? "").toLowerCase();
  if (provider) return { provider, apiKey: process.env.IMAGE_API_KEY ?? "", model: process.env.IMAGE_MODEL || undefined, source: "env" };
  return { provider: "", apiKey: "", source: "none" };
}

export function llmFingerprint(): string {
  const c = effectiveLlmConfig();
  return `${c.source}|${c.provider}|${c.model ?? ""}|${c.apiKey.length}|${c.apiKey.slice(0, 4)}`;
}

export function effectiveSmtpConfig(): (SmtpConfig & { source: "admin" | "env" }) | null {
  if (snapshot.smtp?.host) return { ...snapshot.smtp, source: "admin" };
  if (process.env.SMTP_HOST) {
    return {
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587),
      user: process.env.SMTP_USER || undefined, pass: process.env.SMTP_PASS || undefined,
      from: process.env.SMTP_FROM || undefined, source: "env",
    };
  }
  return null;
}

export function smtpFingerprint(): string {
  const c = effectiveSmtpConfig();
  return c ? `${c.source}|${c.host}|${c.port}|${c.user ?? ""}|${(c.pass ?? "").length}` : "none";
}

export function effectiveSmsConfig(): (SmsConfig & { source: "admin" | "env" }) | null {
  if (snapshot.sms?.senderId && snapshot.sms.apiToken) return { ...snapshot.sms, source: "admin" };
  if (process.env.SMS_API_TOKEN && process.env.SMS_SENDER_ID) {
    return { apiToken: process.env.SMS_API_TOKEN, senderId: process.env.SMS_SENDER_ID, apiUrl: process.env.SMS_API_URL || undefined, source: "env" };
  }
  return null;
}

/** Milestone 36: SSLCommerz merchant config — admin snapshot
 * wins, env is the fallback. Null means online payment is not
 * configured and checkout must refuse honestly. */
export function effectiveSslcommerzConfig(): (SslcommerzConfig & { source: "admin" | "env" }) | null {
  if (snapshot.sslcommerz?.storeId && snapshot.sslcommerz.storePass) {
    return { ...snapshot.sslcommerz, source: "admin" };
  }
  if (process.env.SSLCOMMERZ_STORE_ID && process.env.SSLCOMMERZ_STORE_PASS) {
    return {
      storeId: process.env.SSLCOMMERZ_STORE_ID,
      storePass: process.env.SSLCOMMERZ_STORE_PASS,
      sandbox: process.env.SSLCOMMERZ_SANDBOX !== "false",
      source: "env",
    };
  }
  return null;
}

export function sslcommerzBase(cfg: SslcommerzConfig): string {
  return cfg.sandbox ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com";
}

/** Milestone 39: bKash tokenized-checkout merchant config —
 * same admin → env resolution as SSLCommerz. */
export function effectiveBkashConfig(): (BkashConfig & { source: "admin" | "env" }) | null {
  if (snapshot.bkash?.appKey && snapshot.bkash.appSecret && snapshot.bkash.username && snapshot.bkash.password) {
    return { ...snapshot.bkash, source: "admin" };
  }
  if (process.env.BKASH_APP_KEY && process.env.BKASH_APP_SECRET && process.env.BKASH_USERNAME && process.env.BKASH_PASSWORD) {
    return {
      appKey: process.env.BKASH_APP_KEY, appSecret: process.env.BKASH_APP_SECRET,
      username: process.env.BKASH_USERNAME, password: process.env.BKASH_PASSWORD,
      sandbox: process.env.BKASH_SANDBOX !== "false", source: "env",
    };
  }
  return null;
}

/** CC10: the CURRENT platform wallet fee in basis points, from
 * the admin-configured walletConfig (snapshot, refreshed on
 * admin writes + the scheduler tick — the M33 pattern). No valid
 * config ⇒ 0. A fee is never invented or hardcoded. */
export function effectiveWalletFeeBps(): number {
  const feeBps = Number(snapshot.wallet?.feeBps);
  return Number.isInteger(feeBps) && feeBps >= 0 && feeBps <= 10_000 ? feeBps : 0;
}

/** CC23: the four-eyes payout threshold (minor units) from the
 * admin walletConfig, or null when the feature is off (unset,
 * null, or invalid in the stored config — never guessed). */
export function effectivePayoutFourEyesThresholdMinor(): number | null {
  const v = snapshot.wallet?.payoutFourEyesThresholdMinor;
  return v !== null && v !== undefined && Number.isInteger(v) && v >= 0 ? v : null;
}

export function bkashBase(cfg: BkashConfig): string {
  return cfg.sandbox ? "https://tokenized.sandbox.bka.sh/v1.2.0-beta" : "https://tokenized.pay.bka.sh/v1.2.0-beta";
}

/** SP8: the operator's TikTok app — admin snapshot wins, env is
 * the fallback (same discipline as every other area). Null means
 * TikTok connect must refuse HONESTLY (a Bengali "app configure
 * করা হয়নি"), never emit a broken authorize URL. A config with a
 * client key but NO secret is treated as not configured: the
 * token exchange could never succeed with it. */
export function effectiveTiktokAppConfig(): (TiktokAppConfig & { source: "admin" | "env" }) | null {
  if (snapshot.tiktokApp?.clientKey && snapshot.tiktokApp.clientSecret) {
    return { ...snapshot.tiktokApp, source: "admin" };
  }
  if (process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET) {
    return {
      clientKey: process.env.TIKTOK_CLIENT_KEY,
      clientSecret: process.env.TIKTOK_CLIENT_SECRET,
      redirectUri: process.env.TIKTOK_REDIRECT_URI || undefined,
      audited: process.env.TIKTOK_APP_AUDITED === "true",
      source: "env",
    };
  }
  return null;
}

/** SP9: the operator's Google app for YouTube — same resolution. */
export function effectiveGoogleAppConfig(): (GoogleAppConfig & { source: "admin" | "env" }) | null {
  if (snapshot.googleApp?.clientId && snapshot.googleApp.clientSecret) {
    return { ...snapshot.googleApp, source: "admin" };
  }
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI || undefined,
      source: "env",
    };
  }
  return null;
}

/** CC20: the operator's LinkedIn app — same resolution as Google. */
export function effectiveLinkedinAppConfig(): (LinkedinAppConfig & { source: "admin" | "env" }) | null {
  if (snapshot.linkedinApp?.clientId && snapshot.linkedinApp.clientSecret) {
    return { ...snapshot.linkedinApp, source: "admin" };
  }
  if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    return {
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      redirectUri: process.env.LINKEDIN_REDIRECT_URI || undefined,
      source: "env",
    };
  }
  return null;
}

/** SN7: the operator's Threads app — same resolution as LinkedIn. */
export function effectiveThreadsAppConfig(): (ThreadsAppConfig & { source: "admin" | "env" }) | null {
  if (snapshot.threadsApp?.clientId && snapshot.threadsApp.clientSecret) {
    return { ...snapshot.threadsApp, source: "admin" };
  }
  if (process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET) {
    return {
      clientId: process.env.THREADS_APP_ID,
      clientSecret: process.env.THREADS_APP_SECRET,
      redirectUri: process.env.THREADS_REDIRECT_URI || undefined,
      source: "env",
    };
  }
  return null;
}

/** The OAuth callback URL for a social platform: the operator's
 * configured redirect URI wins (it must match what is registered
 * in the TikTok/Google app console EXACTLY); otherwise it is
 * derived from API_PUBLIC_URL + the API's public callback route
 * (payments.service apiBase convention). CC20 widens the segment
 * vocabulary for the Google pack + LinkedIn callback routes —
 * each flow's segment is its own registered redirect path. */
export function socialOAuthRedirectUri(platform: "tiktok" | "youtube" | "google-ga4" | "google-merchant" | "google-business" | "linkedin" | "threads", configured?: string): string {
  if (configured) return configured.replace(/\/$/, "");
  const apiBase = (process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return `${apiBase}/social/oauth/${platform}/callback`;
}

/** The app secret a messaging webhook should be verified against:
 * the integration's own secret wins; the platform Meta app secret
 * (admin-configured) is the fallback for tenants who connected
 * under the platform app. */
export function resolveMessagingAppSecret(storedSecret: string | undefined | null): string | null {
  if (storedSecret) return storedSecret;
  return snapshot.metaApp?.appSecret ?? null;
}
