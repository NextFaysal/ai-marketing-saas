import { Body, Controller, Headers, HttpException, HttpStatus, Optional, Post } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { Public } from "../common/decorators";
import { AutomationService } from "./automation.service";
import { InboxService } from "../inbox/inbox.service";
import { TelegramService } from "../inbox/channels/telegram.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { ShopifyService } from "../integrations/shopify/shopify.service";
import { ApiException, forbidden } from "../i18n/api-exception";

/**
 * Milestone 57: the dedicated worker's callback surface.
 * Not user auth — a shared secret header (INTERNAL_JOB_SECRET)
 * checked timing-safe. When the secret is not configured the
 * surface refuses everything (503): queue mode is opt-in by
 * configuration, never silently open.
 */
/** A failure the worker must NOT retry (bad signature, unknown
 * integration): answered 422 so the worker maps it to an
 * UnrecoverableError. Everything else is a 500 (retryable). */
function isPermanentWebhookError(message: string): boolean {
  return /signature|not found|secret|unknown integration/i.test(message);
}

@Controller("internal")
@Public()
export class InternalJobsController {
  constructor(
    private readonly automation: AutomationService,
    // Milestone 63: webhook re-entry points (the existing
    // handlers, verification included).
    @Optional() private readonly inbox?: InboxService,
    @Optional() private readonly shopify?: ShopifyService,
    @Optional() private readonly telegram?: TelegramService,
    @Optional() private readonly integrations?: IntegrationsService,
  ) {}

  private checkSecret(header: string | undefined) {
    const expected = process.env.INTERNAL_JOB_SECRET ?? "";
    if (!expected) {
      throw new ApiException("automation.internalJobSurfaceIsNotConfigured", undefined, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const given = Buffer.from(header ?? "");
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw forbidden("automation.invalidInternalSecret");
    }
  }

  @Post("jobs/execute")
  async execute(@Headers("x-internal-secret") secret: string | undefined, @Body() body: { scheduledJobId?: string }) {
    this.checkSecret(secret);
    if (!body?.scheduledJobId) throw new ApiException("automation.scheduledjobidIsRequired", undefined, HttpStatus.BAD_REQUEST);
    try {
      return await this.automation.executeScheduledJobById(body.scheduledJobId);
    } catch (e) {
      // A failed job must surface as a failure so BullMQ retries
      // and eventually dead-letters it.
      throw new HttpException(
        { ok: false, error: e instanceof Error ? e.message : "Job failed" },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("jobs/dlq")
  async dlq(@Headers("x-internal-secret") secret: string | undefined, @Body() body: { scheduledJobId?: string; error?: string; attempts?: number; jobType?: string }) {
    this.checkSecret(secret);
    if (!body?.scheduledJobId) throw new ApiException("automation.scheduledjobidIsRequired", undefined, HttpStatus.BAD_REQUEST);
    const row = await this.automation.recordDlq({
      scheduledJobId: body.scheduledJobId,
      error: body.error ?? "unknown error",
      attempts: body.attempts ?? 0,
      jobType: body.jobType,
    });
    return { ok: true, id: row.id };
  }

  /**
   * Milestone 63: the worker's webhook re-entry point. Runs the
   * EXISTING handler for the source — signature verification
   * included — and classifies failures for BullMQ: permanent
   * (signature / unknown integration) as 422, transient as 500.
   */
  @Post("webhooks/process")
  async processWebhook(@Headers("x-internal-secret") secret: string | undefined, @Body() body: any) {
    this.checkSecret(secret);
    const source = body?.source as string;
    const integrationId = body?.integrationId as string;
    if (!source || !integrationId) throw new ApiException("automation.sourceAndIntegrationidAreRequired", undefined, HttpStatus.BAD_REQUEST);
    try {
      switch (source) {
        case "meta": {
          if (!this.inbox) throw new Error("Inbox service is not available in this deployment");
          return { ok: true, ...(await this.inbox.handleWebhook(integrationId, String(body.rawBody ?? ""), body.headers?.signature)) };
        }
        case "shopify": {
          if (!this.shopify) throw new Error("Shopify service is not available in this deployment");
          return { ok: true, ...(await this.shopify.handleWebhook(integrationId, String(body.rawBody ?? ""), body.headers?.hmac, body.headers?.topic, body.headers?.webhookId)) };
        }
        case "telegram": {
          if (!this.telegram) throw new Error("Telegram service is not available in this deployment");
          return { ok: true, ...(await this.telegram.handleWebhook(integrationId, body.secret, body.update ?? {})) };
        }
        case "woocommerce": {
          if (!this.integrations) throw new Error("Integrations service is not available in this deployment");
          if (!body.eventId) throw new ApiException("automation.eventidIsRequiredForWoocommerce", undefined, HttpStatus.BAD_REQUEST);
          return { ok: true, ...(await this.integrations.processWooWebhookEvent(body.eventId)) };
        }
        default:
          throw new ApiException("automation.unknownWebhookSource", { source: source }, HttpStatus.BAD_REQUEST);
      }
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === HttpStatus.BAD_REQUEST && (/source|integrationId|eventId/.test(e.message) || (e instanceof ApiException && /source|integrationId|eventId/i.test(e.code)))) throw e;
      const message = e instanceof Error ? e.message : "Webhook processing failed";
      // Permanent = the payload can never succeed: a signature/
      // secret/not-found failure, or any 4xx the handler raised
      // (e.g. Telegram's BadRequestException for a bad secret).
      const status = e instanceof HttpException ? e.getStatus() : 500;
      const permanent = isPermanentWebhookError(message) || (status >= 400 && status < 500);
      throw new HttpException(
        { ok: false, error: message, permanent },
        permanent ? 422 : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
