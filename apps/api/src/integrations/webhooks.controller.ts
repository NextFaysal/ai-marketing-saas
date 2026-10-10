import { Controller, Headers, Param, Post, Req, UnauthorizedException, BadRequestException } from "@nestjs/common";
import { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationsService } from "./integrations.service";
import { Public } from "../common/decorators";
import { verifyWooSignature } from "./webhooks.service";
import { normalizeWooOrder, normalizeWooProduct } from "./woocommerce/normalize";

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
    if (!integration) throw new BadRequestException("Unknown integration");
    const secrets = this.integrations.getSecrets(integration);
    if (!secrets.webhookSecret) {
      throw new BadRequestException("Webhook secret is not configured for this integration");
    }
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const valid = verifyWooSignature(rawBody, signature, secrets.webhookSecret);
    if (!valid) throw new UnauthorizedException("Invalid webhook signature");

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

    try {
      if (topic?.startsWith("order.") && payload?.id) {
        await this.integrations.upsertOrder(integration.organizationId, integration.storeId, normalizeWooOrder(payload));
      } else if (topic?.startsWith("product.") && payload?.id) {
        const currency = integration.store?.currency ?? "BDT";
        await this.integrations.upsertProduct(integration.organizationId, normalizeWooProduct(payload, currency));
      }
      await (this.prisma as any).webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return { received: true, processed: true };
    } catch (e) {
      await (this.prisma as any).webhookEvent.update({
        where: { id: event.id }, data: { error: e instanceof Error ? e.message : "Processing failed" },
      });
      // Return 200 so Woo does not retry a payload we can never process;
      // the failure is recorded on the event for inspection.
      return { received: true, processed: false };
    }
  }
}
