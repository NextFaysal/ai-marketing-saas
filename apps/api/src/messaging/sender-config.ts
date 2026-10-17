import { unseal } from "../common/platform-config";
import type { SmsGatewayId } from "./sms.provider";
import type { TenantSmtpConfig } from "./email.provider";

/**
 * MS4 — per-tenant sender configuration shapes, derived from the
 * org's MessagingSenderConfig row. Secrets live in the row
 * AES-256-GCM sealed (platform-config seal/unseal); the shapes
 * here are the DECRYPTED runtime configs and are never returned
 * by any API — senderConfigSafeView is the only outward view and
 * it carries configured-booleans + non-secret fields only.
 */

export type { TenantSmtpConfig };

export interface TenantSmsConfig {
  gateway: SmsGatewayId;
  apiKey: string;
  senderId: string;
  apiUrl?: string;
  /** MX2: failover priority (lower sends first) + the stable
   * breaker key for this gateway within a run. */
  priority?: number;
  gatewayKey?: string;
}

/** MX2: the stable circuit-breaker / dedupe key of one SMS
 * gateway config. */
export function smsGatewayKey(cfg: { gateway: string; senderId: string }): string {
  return `${cfg.gateway}:${cfg.senderId}`;
}

/** MX2: a MessagingSmsGatewayConfig row (an ADDITIONAL tenant
 * SMS gateway) → runtime config, same "fully configured or
 * null" discipline as tenantSmsFromRow. Disabled rows read as
 * not configured — kept in storage, never sent through. */
export function tenantSmsFromGatewayRow(row: any): TenantSmsConfig | null {
  if (!row || row.isEnabled === false) return null;
  if (!row.smsGateway || !(SMS_GATEWAYS as readonly string[]).includes(row.smsGateway)) return null;
  if (!row.smsSenderId || !row.smsApiKeyEncrypted) return null;
  const apiKey = unseal(row.smsApiKeyEncrypted);
  if (!apiKey) return null;
  const cfg: TenantSmsConfig = {
    gateway: row.smsGateway as SmsGatewayId,
    apiKey,
    senderId: String(row.smsSenderId),
    apiUrl: row.smsApiUrl ? String(row.smsApiUrl) : undefined,
    priority: Number.isInteger(row.priority) ? row.priority : 10,
  };
  cfg.gatewayKey = smsGatewayKey(cfg);
  return cfg;
}

export const SMS_GATEWAYS: readonly SmsGatewayId[] = ["sslwireless", "bulksmsbd", "alphasms"];

/** Fully configured = host + From address present (user/pass are
 * optional, exactly like the platform SMTP resolution). A row
 * that fails to decrypt its password reads as NOT configured —
 * never a half-broken send. */
export function tenantSmtpFromRow(row: any): TenantSmtpConfig | null {
  if (!row?.smtpHost || !row?.fromAddress) return null;
  let pass: string | undefined;
  if (row.smtpPassEncrypted) {
    pass = unseal(row.smtpPassEncrypted);
    if (pass === undefined) return null;
  }
  return {
    host: String(row.smtpHost),
    port: Number(row.smtpPort ?? 587),
    user: row.smtpUser ? String(row.smtpUser) : undefined,
    pass,
    from: String(row.fromAddress),
    fromName: row.fromName ? String(row.fromName) : undefined,
  };
}

/** Fully configured = a known gateway + a decryptable API key +
 * a sender ID. */
export function tenantSmsFromRow(row: any): TenantSmsConfig | null {
  if (!row?.smsGateway || !(SMS_GATEWAYS as readonly string[]).includes(row.smsGateway)) return null;
  if (!row.smsSenderId || !row.smsApiKeyEncrypted) return null;
  const apiKey = unseal(row.smsApiKeyEncrypted);
  if (!apiKey) return null;
  const cfg: TenantSmsConfig = {
    gateway: row.smsGateway as SmsGatewayId,
    apiKey,
    senderId: String(row.smsSenderId),
    apiUrl: row.smsApiUrl ? String(row.smsApiUrl) : undefined,
    priority: Number.isInteger(row.smsPriority) ? row.smsPriority : 0,
  };
  cfg.gatewayKey = smsGatewayKey(cfg);
  return cfg;
}

/** The ONLY outward view of a sender-config row: non-secret
 * fields + configured booleans. Asserted secret-free by spec. */
export function senderConfigSafeView(row: any, platform: { emailConfigured: boolean; smsConfigured: boolean }) {
  const tenantSmtp = tenantSmtpFromRow(row);
  const tenantSms = tenantSmsFromRow(row);
  return {
    email: {
      path: tenantSmtp ? "tenant" : platform.emailConfigured ? "platform" : "none",
      tenantConfigured: Boolean(tenantSmtp),
      platformConfigured: platform.emailConfigured,
      smtpHost: row?.smtpHost ?? null,
      smtpPort: row?.smtpPort ?? null,
      smtpUser: row?.smtpUser ?? null,
      smtpPassConfigured: Boolean(row?.smtpPassEncrypted),
      fromAddress: row?.fromAddress ?? null,
      fromName: row?.fromName ?? null,
      dkimSelector: row?.dkimSelector ?? null,
    },
    sms: {
      path: tenantSms ? "tenant" : platform.smsConfigured ? "platform" : "none",
      tenantConfigured: Boolean(tenantSms),
      platformConfigured: platform.smsConfigured,
      gateway: tenantSms ? tenantSms.gateway : platform.smsConfigured ? "sslwireless" : null,
      smsApiKeyConfigured: Boolean(row?.smsApiKeyEncrypted),
      smsSenderId: row?.smsSenderId ?? null,
      smsApiUrl: row?.smsApiUrl ?? null,
    },
    rates: {
      smsCostPerPartMinor: row?.smsCostPerPartMinor ?? null,
      whatsappCostPerMessageMinor: row?.whatsappCostPerMessageMinor ?? null,
      // MX9: org-entered per-category WhatsApp rates (null = not set).
      whatsappMarketingCostPerMessageMinor: row?.whatsappMarketingCostPerMessageMinor ?? null,
      whatsappUtilityCostPerMessageMinor: row?.whatsappUtilityCostPerMessageMinor ?? null,
      whatsappAuthenticationCostPerMessageMinor: row?.whatsappAuthenticationCostPerMessageMinor ?? null,
      emailCostPerMessageMinor: row?.emailCostPerMessageMinor ?? null,
    },
  };
}
