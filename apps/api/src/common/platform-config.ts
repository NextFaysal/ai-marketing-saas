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

export interface PlatformConfigSnapshot {
  llm: LlmConfig | null;
  metaApp: MetaAppConfig | null;
  smtp: SmtpConfig | null;
  sms: SmsConfig | null;
  loadedAt: number;
}

export const PLATFORM_CONFIG_KEYS = ["llmConfig", "metaAppConfig", "smtpConfig", "smsConfig"] as const;

let snapshot: PlatformConfigSnapshot = { llm: null, metaApp: null, smtp: null, sms: null, loadedAt: 0 };

export function getPlatformConfigSync(): PlatformConfigSnapshot {
  return snapshot;
}

/** Test hook + admin-write hook: replace the snapshot directly. */
export function setPlatformConfigSnapshot(next: PlatformConfigSnapshot) {
  snapshot = next;
  setMetaGraphVersionOverride(next.metaApp?.graphVersion ?? null);
}

function unseal(value: unknown): string | undefined {
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

/** Load + decrypt all four areas from the store into the snapshot. */
export async function refreshPlatformConfig(prisma: any): Promise<PlatformConfigSnapshot> {
  const [llmRaw, metaRaw, smtpRaw, smsRaw] = await Promise.all([
    readKey(prisma, "llmConfig"), readKey(prisma, "metaAppConfig"),
    readKey(prisma, "smtpConfig"), readKey(prisma, "smsConfig"),
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
  const next: PlatformConfigSnapshot = { llm, metaApp, smtp, sms, loadedAt: Date.now() };
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

/** The app secret a messaging webhook should be verified against:
 * the integration's own secret wins; the platform Meta app secret
 * (admin-configured) is the fallback for tenants who connected
 * under the platform app. */
export function resolveMessagingAppSecret(storedSecret: string | undefined | null): string | null {
  if (storedSecret) return storedSecret;
  return snapshot.metaApp?.appSecret ?? null;
}
