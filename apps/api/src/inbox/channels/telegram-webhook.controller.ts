import { Controller, Headers, HttpStatus, Param, Post, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";
import { Public } from "../../common/decorators";
import { TelegramService } from "./telegram.service";
import { webhookDispatcher } from "../../common/webhook-dispatch";

/** Public Telegram webhook (no auth guard: authenticity comes
 * from the per-integration secret token Telegram echoes in the
 * x-telegram-bot-api-secret-token header, checked inside the
 * service with a timing-safe compare). */
@Controller("webhooks/telegram")
@Public()
export class TelegramWebhookController {
  constructor(private readonly telegram: TelegramService) {}

  @Post(":integrationId")
  async receive(
    @Param("integrationId") integrationId: string,
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Milestone 63: queue mode — the secret + update travel to
    // the worker callback, which re-runs handleWebhook (its
    // timing-safe secret check included) unchanged.
    if (await webhookDispatcher.enqueue({
      source: "telegram", integrationId, secret, update: req.body ?? {},
    })) {
      return res.status(HttpStatus.OK).json({ ok: true, queued: true });
    }
    try {
      const result = await this.telegram.handleWebhook(integrationId, secret, req.body ?? {});
      return res.status(HttpStatus.OK).json({ ok: true, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : "error";
      const forbidden = message.includes("secret") || message.includes("not found");
      return res.status(forbidden ? HttpStatus.FORBIDDEN : HttpStatus.OK).json({ ok: false, error: message });
    }
  }
}
