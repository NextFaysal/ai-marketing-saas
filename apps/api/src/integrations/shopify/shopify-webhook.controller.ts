import { Controller, Headers, Param, Post, Req, Res, HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { ShopifyService } from "./shopify.service";

/** Public Shopify webhook endpoint. Authenticity = HMAC-SHA256 (base64)
 *  header checked against the app secret stored encrypted at connect. */
@Controller("webhooks/shopify")
export class ShopifyWebhookController {
  constructor(private readonly shopify: ShopifyService) {}

  @Post(":integrationId")
  async receive(
    @Param("integrationId") integrationId: string,
    @Headers("x-shopify-hmac-sha256") hmac: string | undefined,
    @Headers("x-shopify-topic") topic: string | undefined,
    @Headers("x-shopify-webhook-id") webhookId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const rawBody = (req as any).rawBody?.toString("utf8") ?? JSON.stringify(req.body ?? {});
    try {
      const result = await this.shopify.handleWebhook(integrationId, rawBody, hmac, topic, webhookId);
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
