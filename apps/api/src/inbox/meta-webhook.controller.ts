import { Controller, Get, Headers, Param, Post, Query, Req, Res, HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { InboxService } from "./inbox.service";

/** Public Meta webhook endpoint (no auth guard: authenticity comes from
 *  the hub verify token on GET and the X-Hub-Signature-256 HMAC on POST,
 *  both checked against the integration's encrypted secrets). */
@Controller("webhooks/meta")
export class MetaWebhookController {
  constructor(private readonly inbox: InboxService) {}

  @Get(":integrationId")
  async verify(
    @Param("integrationId") integrationId: string,
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
    @Res() res: Response,
  ) {
    const ok = await this.inbox.verifySubscription(integrationId, mode, token, challenge);
    if (ok !== null) return res.status(HttpStatus.OK).send(ok);
    return res.status(HttpStatus.FORBIDDEN).send("Verification failed");
  }

  @Post(":integrationId")
  async receive(
    @Param("integrationId") integrationId: string,
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const rawBody = (req as any).rawBody?.toString("utf8") ?? JSON.stringify(req.body ?? {});
    try {
      const result = await this.inbox.handleWebhook(integrationId, rawBody, signature);
      return res.status(HttpStatus.OK).json({ ok: true, ...result });
    } catch (e) {
      // Signature failures are 403; processing errors are logged by the
      // service and answered 200-with-error so Meta does not retry storms.
      const message = e instanceof Error ? e.message : "error";
      if (message.includes("signature") || message.includes("not found")) {
        return res.status(HttpStatus.FORBIDDEN).json({ ok: false, error: message });
      }
      return res.status(HttpStatus.OK).json({ ok: false, error: message });
    }
  }
}
