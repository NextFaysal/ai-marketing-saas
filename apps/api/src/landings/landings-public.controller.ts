import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { LandingsService } from "./landings.service";
import { Public } from "../common/decorators";
import { LandingEventDto, LandingOrderDto } from "./landings.dto";

/**
 * EC13 public landing API. All routes are @Public (landing
 * visitors have no account); a landing answers only while it is
 * `published` and its product is ACTIVE — everything else is 404.
 */
@Controller("public/landing")
export class LandingsPublicController {
  constructor(private readonly landings: LandingsService) {}

  @Public()
  @Get(":slug")
  get(@Param("slug") slug: string, @Query("visitor") visitor?: string) {
    return this.landings.getPublicLanding(slug, visitor || undefined);
  }

  @Public()
  @Post(":slug/view")
  view(@Param("slug") slug: string, @Body() dto: LandingEventDto) {
    return this.landings.recordEvent(slug, "view", dto ?? {});
  }

  @Public()
  @Post(":slug/checkout-started")
  checkoutStarted(@Param("slug") slug: string, @Body() dto: LandingEventDto) {
    return this.landings.recordEvent(slug, "checkout_started", dto ?? {});
  }

  @Public()
  @Post(":slug/order")
  order(@Param("slug") slug: string, @Body() dto: LandingOrderDto) {
    return this.landings.placeOrder(slug, dto);
  }

  @Public()
  @Post(":slug/order/:orderId/upsell")
  upsell(@Param("slug") slug: string, @Param("orderId") orderId: string) {
    return this.landings.addUpsell(slug, orderId);
  }
}
