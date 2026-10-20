import { Controller, Headers, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationsService } from "./integrations.service";
import { Public } from "../common/decorators";
import { verifyWooSignature } from "./webhooks.service";
import { webhookDispatcher } from "../common/webhook-dispatch";
import { badRequest, unauthorized } from "../i18n/api-exception";

/**
 * Public webhook endpoint for WooCommerce.
 * URL to register in WP Admin > Settings > Advanced > Webhooks:
 *   POST {API_URL}/webhooks/woocommerce/{integrationId}
 * Security: HMAC signature checked against the stored webhook secret.
 * Events with a duplicate delivery id are acknowledged without reprocessing.
 */
@Controller("webhooks/woocommerce")
export class WooWebhooksController {
  constructor(private readonly prisma: PrismaService, private readonly integrations: IntegrationsService) {}

  @Public()
  @Post(":integrationId")
  async handle(
    @Param("integrationId") integrationId: string,
    @Headers("x-wc-webhook-topic") topic: string | undefined,
    @Headers("x-wc-webhook-delivery-id") deliveryId: string | undefined,
    @Headers("x-wc-webhook-signature") signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const integration = await this.integrations.getIntegrationById(integrationId);
    if (!integration) throw badRequest("integrations.unknownIntegration");
    const secrets = this.integrations.getSecrets(integration);
    if (!secrets.webhookSecret) {
      throw badRequest("integrations.webhookSecretIsNotConfiguredFor");
    }
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const valid = verifyWooSignature(rawBody, signature, secrets.webhookSecret);
    if (!valid) throw unauthorized("integrations.invalidWebhookSignature");

    // Idempotency: Woo retries deliveries; the same delivery id must not
    // create duplicate orders/products.
    if (deliveryId) {
      const duplicate = await (this.prisma as any).webhookEvent.findFirst({
        where: { integrationId, deliveryId },
      });
      if (duplicate) return { received: true, duplicate: true };
    }

    const payload = (req.body ?? {}) as any;
    const event = await (this.prisma as any).webhookEvent.create({
      data: {
        integrationId, provider: "woocommerce", topic: topic ?? null,
        deliveryId: deliveryId ?? null, payload, signatureValid: true,
      },
    });

    // Milestone 63: with a queue available, the upsert half runs
    // in the worker (the event row above is the durable record
    // either way); without one it processes inline as before.
    if (await webhookDispatcher.enqueue({
      source: "woocommerce", integrationId, eventId: event.id,
    })) {
      return { received: true, queued: true };
    }
    const out = await this.integrations.processWooWebhookEvent(event.id);
    return { received: true, processed: out.processed };
  }
}
