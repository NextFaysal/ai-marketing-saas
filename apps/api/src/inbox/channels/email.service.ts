import { Injectable } from "@nestjs/common";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import * as nodemailer from "nodemailer";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { encryptJson, decryptJson } from "../../integrations/crypto";
import { InboxService } from "../inbox.service";
import { badRequest, notFound } from "../../i18n/api-exception";

export interface EmailCredentials {
  imapHost: string; imapPort: number;
  smtpHost: string; smtpPort: number;
  user: string; password: string;
}

/**
 * Email lane (Unified Inbox U4): the tenant's OWN mailbox.
 * Connect verifies a real IMAP login AND a real SMTP handshake
 * before anything is stored. Sync (scheduler job "email_sync" or
 * the manual trigger) pulls UNREAD mail into the unified inbox
 * as channel "email" conversations, one per sender, threaded by
 * the conversation's subject. Credentials are AES-GCM encrypted
 * and never returned.
 */
@Injectable()
export class EmailChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  buildImapClient(creds: EmailCredentials) {
    return new ImapFlow({
      host: creds.imapHost, port: creds.imapPort, secure: creds.imapPort === 993,
      auth: { user: creds.user, pass: creds.password }, logger: false,
    });
  }

  buildTransport(creds: EmailCredentials) {
    return nodemailer.createTransport({
      host: creds.smtpHost, port: creds.smtpPort, secure: creds.smtpPort === 465,
      auth: { user: creds.user, pass: creds.password },
    });
  }

  async connect(organizationId: string, actorId: string, dto: EmailCredentials) {
    if (!dto.imapHost || !dto.smtpHost || !dto.user || !dto.password) {
      throw badRequest("inbox.imapHostSmtpHostUserAnd");
    }
    const creds: EmailCredentials = {
      imapHost: dto.imapHost.trim(), imapPort: Number(dto.imapPort) || 993,
      smtpHost: dto.smtpHost.trim(), smtpPort: Number(dto.smtpPort) || 587,
      user: dto.user.trim(), password: dto.password,
    };
    // Verify BOTH directions before saving — a mailbox that can
    // only read or only send is not a connected channel.
    const imap = this.buildImapClient(creds);
    try {
      await imap.connect();
      await imap.logout();
    } catch (e) {
      throw badRequest("inbox.imapLoginFailed", { p1: e instanceof Error ? e.message : "connection error" });
    }
    try {
      await this.buildTransport(creds).verify();
    } catch (e) {
      throw badRequest("inbox.smtpVerificationFailed", { p1: e instanceof Error ? e.message : "connection error" });
    }
    // CC7 (Connect Center): keyed by (organizationId, provider,
    // externalAccountId) — the key is the mailbox address, which
    // is a VERIFIED identifier here: the IMAP login and the SMTP
    // handshake above both just succeeded with exactly this user,
    // so the address is proven, not merely typed. Reconnecting the
    // SAME mailbox refreshes its row + sealed credential in place;
    // a SECOND, different mailbox gets its own row and coexists —
    // the CC2 discipline connectMessaging got in B1.
    const existing = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "email", externalAccountId: creds.user },
    });
    let integration = existing;
    if (existing) {
      integration = await (this.prisma as any).integration.update({
        where: { id: existing.id },
        data: { status: "CONNECTED", lastError: null },
      });
      const refreshed = await (this.prisma as any).integrationCredential
        .update({ where: { integrationId: existing.id }, data: { encryptedData: encryptJson(creds) } })
        .catch(() => null);
      if (!refreshed) {
        await (this.prisma as any).integrationCredential.create({
          data: { integrationId: existing.id, encryptedData: encryptJson(creds) },
        });
      }
    } else {
      integration = await (this.prisma as any).integration.create({
        data: { organizationId, provider: "email", status: "CONNECTED", externalAccountId: creds.user },
      });
      await (this.prisma as any).integrationCredential.create({
        data: { integrationId: integration.id, encryptedData: encryptJson(creds) },
      });
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "inbox.email.connected", entityType: "Integration",
      entityId: integration.id, metadata: { mailbox: creds.user, reconnected: Boolean(existing) },
    });
    return { integrationId: integration.id, mailbox: creds.user, reconnected: Boolean(existing) };
  }

  /** Pull unread mail into the inbox. Idempotent: messages are
   * deduplicated by Message-ID and flagged Seen only after they
   * are stored (or already known). */
  async syncOrganization(organizationId: string) {
    const integration = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "email", status: "CONNECTED" },
      include: { credential: true }, orderBy: { createdAt: "desc" },
    });
    if (!integration?.credential) throw notFound("inbox.noConnectedEmailIntegrationForThis");
    // CC18: a tenant-paused email connection is skipped by the
    // scheduled sync — the skip marker is the job's result
    // (channel syncs keep no SyncJob rows to record it in).
    if ((integration as any).syncPaused === true) {
      return { skipped: true, reason: "sync_paused", integrationId: integration.id, stored: 0, duplicates: 0, fetched: 0 };
    }
    const creds = decryptJson<EmailCredentials>(integration.credential.encryptedData);
    const client = this.buildImapClient(creds);
    let stored = 0;
    let duplicates = 0;
    let fetched = 0;
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const unseen = (await client.search({ seen: false }, { uid: true })) as number[] | false;
      const uids = (Array.isArray(unseen) ? unseen : []).slice(-100);
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
        if (!msg || !(msg as any).source) continue;
        fetched++;
        const parsed = await simpleParser((msg as any).source as Buffer);
        const from = parsed.from?.value?.[0];
        if (!from?.address) continue;
        const text = (parsed.text ?? "").trim() || stripHtml(parsed.html || "").slice(0, 4000);
        const result = await this.inbox.ingestExternalMessage({
          organizationId,
          integrationId: integration.id,
          channel: "email",
          externalContactId: from.address.toLowerCase(),
          contactName: from.name || from.address,
          externalId: parsed.messageId ?? `uid-${uid}`,
          content: text.slice(0, 8000) || "(খালি ইমেইল)",
          timestamp: parsed.date ?? new Date(),
          subject: parsed.subject ?? undefined,
        });
        if (result === "stored") stored++;
        else duplicates++;
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => undefined);
      }
    } finally {
      lock.release();
      await client.logout().catch(() => undefined);
    }
    await (this.prisma as any).integration.update({
      where: { id: integration.id }, data: { lastSyncAt: new Date(), lastError: null },
    }).catch(() => undefined);
    return { fetched, stored, duplicates };
  }
}

export function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
