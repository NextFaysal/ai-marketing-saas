import { Injectable, Optional } from "@nestjs/common";
import nodemailer from "nodemailer";
import { effectiveSmtpConfig, smtpFingerprint } from "../common/platform-config";

/**
 * SMTP email provider (nodemailer). Configuration is dynamic
 * (Milestone 33): the Admin Console SMTP setting wins, the SMTP_*
 * env vars are the fallback. When neither is configured, sending
 * throws an explicit configuration error — there is no silent
 * fallback or pretend-send. A send counts as sent ONLY when the
 * SMTP server returns a message id. The transport is rebuilt
 * whenever the effective config changes.
 */
@Injectable()
export class EmailProvider {
  private transport: any = null;
  private transportFingerprint = "";
  private readonly overridden: boolean;

  constructor(@Optional() transportOverride?: any) {
    this.overridden = Boolean(transportOverride);
    if (transportOverride) this.transport = transportOverride;
  }

  isConfigured(): boolean {
    return effectiveSmtpConfig() !== null;
  }

  private getTransport(): any {
    const cfg = effectiveSmtpConfig();
    if (!cfg) {
      throw new Error("Email is not configured: set SMTP in the Admin Console (Settings) or SMTP_HOST/SMTP_FROM in the API environment. For local development, docker-compose provides Mailpit on localhost:1025.");
    }
    if (this.overridden) return this.transport;
    const fp = smtpFingerprint();
    if (this.transport && this.transportFingerprint === fp) return this.transport;
    this.transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
    });
    this.transportFingerprint = fp;
    return this.transport;
  }

  /**
   * GB8 (GC19): `attachments` is an OPTIONAL pass-through — the
   * underlying nodemailer transport always supported it; the
   * provider's own API simply never exposed it. Default behaviour
   * (no attachments) is unchanged. A scheduled report may claim
   * "sent" only when this returns a message id, exactly like
   * every other send.
   */
  async send(input: { to: string; subject: string; text: string; html?: string; attachments?: EmailAttachment[]; fromName?: string }): Promise<{ providerMessageId: string }> {
    const cfg = effectiveSmtpConfig();
    const fromAddr = cfg?.from || cfg?.user;
    if (!cfg || !fromAddr) throw new Error("Email is not configured: set the SMTP From address in the Admin Console or SMTP_FROM in the API environment.");
    // AB8 (AX24): OPTIONAL sender display name — when present the
    // From header becomes `"Name" <addr>` (quotes/newlines stripped
    // from the name so it can never break the header). Absent (or
    // empty after stripping) ⇒ the bare address, byte-identical
    // to the pre-AB8 behaviour.
    const cleanName = input.fromName ? String(input.fromName).replace(/["\r\n]/g, "").trim() : "";
    const from = cleanName ? `"${cleanName}" <${fromAddr}>` : fromAddr;
    const info = await this.getTransport().sendMail({
      from, to: input.to, subject: input.subject, text: input.text,
      // AP4: optional HTML part; text stays as the fallback.
      ...(input.html ? { html: input.html } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    });
    if (!info?.messageId) throw new Error("SMTP server did not return a message id; the email is NOT counted as sent");
    return { providerMessageId: String(info.messageId) };
  }

  /**
   * MS4 — per-tenant SMTP. Public seam (social-import precedent):
   * specs substitute `tenantTransportFactory` so a tenant send
   * never opens a real socket. The default builds a real
   * nodemailer transport from the tenant's own config.
   */
  tenantTransportFactory: (cfg: TenantSmtpConfig) => any = (cfg) => nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
  });

  /** Per-org tenant transport cache, keyed by a config
   * fingerprint so an edited config takes effect immediately. */
  private readonly tenantTransports = new Map<string, { fingerprint: string; transport: any }>();

  private static tenantFingerprint(orgId: string, cfg: TenantSmtpConfig): string {
    return [orgId, cfg.host, cfg.port, cfg.user ?? "", cfg.from].join("|");
  }

  /** MS4 verify-before-save: a REAL SMTP handshake (nodemailer's
   * verify) against a FRESH transport. Throws the server's own
   * error verbatim; on failure NOTHING is cached, so a failed
   * verify can never poison a later send. */
  async verifyTenantSmtp(cfg: TenantSmtpConfig): Promise<{ ok: true }> {
    const transport = await this.tenantTransportFactory(cfg);
    if (!transport) throw new Error("SMTP transport could not be created from these settings");
    await transport.verify();
    return { ok: true };
  }

  /** MS4 — send through the org's own SMTP. Sent counts only on
   * a provider message id, exactly like the platform path. */
  async sendTenant(organizationId: string, cfg: TenantSmtpConfig, input: { to: string; subject: string; text: string; html?: string; attachments?: EmailAttachment[] }): Promise<{ providerMessageId: string }> {
    const fingerprint = EmailProvider.tenantFingerprint(organizationId, cfg);
    let entry = this.tenantTransports.get(organizationId);
    if (!entry || entry.fingerprint !== fingerprint) {
      const transport = await this.tenantTransportFactory(cfg);
      if (!transport) throw new Error("Tenant SMTP transport could not be created from this organization's settings");
      entry = { fingerprint, transport };
      this.tenantTransports.set(organizationId, entry);
    }
    const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from;
    const info = await entry.transport.sendMail({
      from, to: input.to, subject: input.subject, text: input.text,
      ...(input.html ? { html: input.html } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    });
    if (!info?.messageId) throw new Error("SMTP server did not return a message id; the email is NOT counted as sent");
    return { providerMessageId: String(info.messageId) };
  }
}

/**
 * MS4 — a tenant (per-organization) SMTP config. Defined here
 * (not in the messaging service) so the provider owns its own
 * config shape; messaging/sender-config.ts derives it from the
 * org's MessagingSenderConfig row.
 */
/** GB8: one email attachment (nodemailer shape). */
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface TenantSmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  fromName?: string;
}
