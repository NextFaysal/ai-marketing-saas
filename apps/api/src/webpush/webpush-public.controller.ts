import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { WebPushService } from "./webpush.service";
import { Public } from "../common/decorators";
import { PushSubscribeDto, PushUnsubscribeDto } from "./webpush.dto";

/** AB7 (AX16): public shop-visitor push routes. All @Public
 * (guest shoppers have no account — the codebase's public-route
 * auth-skip pattern, as on PublicShopController); the org is
 * resolved by slug and an unknown slug is a 404. */
@Controller("public/shop/:orgSlug")
export class WebpushPublicController {
  constructor(private readonly webpush: WebPushService) {}

  @Public()
  @Get("push-config")
  pushConfig(@Param("orgSlug") orgSlug: string) {
    return this.webpush.publicConfig(orgSlug);
  }

  @Public()
  @Post("push-subscribe")
  subscribe(
    @Param("orgSlug") orgSlug: string,
    @Body() dto: PushSubscribeDto,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.webpush.subscribe(orgSlug, dto ?? ({} as PushSubscribeDto), userAgent);
  }

  @Public()
  @Post("push-unsubscribe")
  unsubscribe(@Param("orgSlug") orgSlug: string, @Body() dto: PushUnsubscribeDto) {
    return this.webpush.unsubscribe(orgSlug, dto ?? ({} as PushUnsubscribeDto));
  }
}
