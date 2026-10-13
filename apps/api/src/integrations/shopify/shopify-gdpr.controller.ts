import { Controller, Headers, Post, Req, Res, HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { ShopifyService } from "./shopify.service";

/**
 * Public Shopify GDPR webhook endpoints (mandatory for App Store /
 * Dev Dashboard apps). These are deliberately NOT routed through
 * webhookDispatcher: GDPR handling is inline by design — the topics
 * carry no integration id for the queued dispatcher to key on, the
 * handler itself resolves the integration by HMAC verification, and
 * Shopify requires a direct, timely 200/403 answer.
 */
@Controller("webhooks/shopify/gdpr")
export class ShopifyGdprController {
  constructor(private readonly shopify: ShopifyService) {}

  @Post("customers-data-request")
  async customersDataRequest(
    @Headers("x-shopify-hmac-sha256") hmac: string | undefined,
    @Headers("x-shopify-webhook-id") webhookId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handle("customers/data_request", hmac, webhookId, req, res);
  }

  @Post("customers-redact")
  async customersRedact(
    @Headers("x-shopify-hmac-sha256") hmac: string | undefined,
    @Headers("x-shopify-webhook-id") webhookId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handle("customers/redact", hmac, webhookId, req, res);
  }

  @Post("shop-redact")
  async shopRedact(
    @Headers("x-shopify-hmac-sha256") hmac: string | undefined,
    @Headers("x-shopify-webhook-id") webhookId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handle("shop/redact", hmac, webhookId, req, res);
  }

  private async handle(topic: string, hmac: string | undefined, webhookId: string | undefined, req: Request, res: Response) {
    const rawBody = (req as any).rawBody?.toString("utf8") ?? JSON.stringify(req.body ?? {});
    try {
      const result = await this.shopify.handleGdpr(topic, rawBody, hmac, webhookId);
      return res.status(HttpStatus.OK).json({ ok: true, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : "error";
      if (message.includes("signature") || message.includes("not found")) {
        return res.status(HttpStatus.FORBIDDEN).json({ ok: false, error: message });
      }
      return res.status(HttpStatus.OK).json({ ok: false, error: message });
    }
  }
}
