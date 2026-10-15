import { Body, Controller, Post } from "@nestjs/common";
import { Public } from "../common/decorators";
import { WooAuthService } from "./woo-auth.service";

/**
 * EC12: public WooCommerce wc-auth callback.
 * URL Woo POSTs the generated keys to:
 *   POST {API_URL}/integrations/woo/wc-auth/callback
 * Public like the webhook controllers (no tenant session exists
 * on this call — Woo's server makes it). Safety comes from the
 * attempt binding in WooAuthService.handleCallback: user_id must
 * name a pending, unexpired attempt whose store snapshot still
 * matches, and the attempt is single-use.
 */
@Controller("integrations/woo")
export class WooAuthController {
  constructor(private readonly wooAuth: WooAuthService) {}

  @Public()
  @Post("wc-auth/callback")
  handleCallback(@Body() body: { key_id?: unknown; user_id?: unknown; consumer_key?: unknown; consumer_secret?: unknown; key_permissions?: unknown }) {
    return this.wooAuth.handleCallback(body ?? {});
  }
}
