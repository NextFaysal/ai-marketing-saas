import { Controller, Get, Post } from "@nestjs/common";
import { PortfolioService } from "./portfolio.service";
import { CurrentUser, AuthUser } from "../common/decorators";

@Controller("portfolio")
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) { return this.portfolio.portfolioForUser(user.userId); }

  @Post("digest")
  digest(@CurrentUser() user: AuthUser) { return this.portfolio.sendWeeklyDigest(user.userId); }
}
