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

  async send(input: { to: string; subject: string; text: string; html?: string }): Promise<{ providerMessageId: string }> {
    const cfg = effectiveSmtpConfig();
    const from = cfg?.from || cfg?.user;
    if (!cfg || !from) throw new Error("Email is not configured: set the SMTP From address in the Admin Console or SMTP_FROM in the API environment.");
    const info = await this.getTransport().sendMail({
      from, to: input.to, subject: input.subject, text: input.text,
      // AP4: optional HTML part; text stays as the fallback.
      ...(input.html ? { html: input.html } : {}),
    });
    if (!info?.messageId) throw new Error("SMTP server did not return a message id; the email is NOT counted as sent");
    return { providerMessageId: String(info.messageId) };
  }
}
