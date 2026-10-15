/**
 * CC20 — PUBLIC Google-pack OAuth callbacks.
 *
 * Lives beside the Connect Center (the Google pack's home), NOT
 * in the social module — the flows it completes store
 * Integration rows, and routing them through SocialModule would
 * cycle the modules. The prefix deliberately mirrors the social
 * callbacks' (/social/oauth/<flow>/callback) so the operator
 * registers all Google redirect URIs in one shape on the one
 * platform Google app. Never throws at the browser: every
 * outcome is a 302 back to the Connect Center with the result
 * in the query string.
 */

import { Controller, Get, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../common/decorators";
import { GoogleConnectService } from "./google-connect.service";

@Controller("social/oauth")
export class GoogleOAuthCallbackController {
  constructor(private readonly google: GoogleConnectService) {}

  @Public() @Get("google-ga4/callback")
  async ga4(@Query("code") code: string | undefined, @Query("state") state: string | undefined, @Query("error") error: string | undefined, @Res() res: Response) {
    const result = await this.google.handleCallback("ga4", { code, state, error });
    return res.redirect(this.google.webRedirect(result));
  }

  @Public() @Get("google-merchant/callback")
  async merchant(@Query("code") code: string | undefined, @Query("state") state: string | undefined, @Query("error") error: string | undefined, @Res() res: Response) {
    const result = await this.google.handleCallback("merchant", { code, state, error });
    return res.redirect(this.google.webRedirect(result));
  }

  @Public() @Get("google-business/callback")
  async business(@Query("code") code: string | undefined, @Query("state") state: string | undefined, @Query("error") error: string | undefined, @Res() res: Response) {
    const result = await this.google.handleCallback("business", { code, state, error });
    return res.redirect(this.google.webRedirect(result));
  }
}
