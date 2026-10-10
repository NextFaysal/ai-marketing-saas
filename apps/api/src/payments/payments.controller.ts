import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import { Request, Response } from "express";
import { PaymentsService } from "./payments.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, Public, Roles, type AuthUser } from "../common/decorators";

class CheckoutDto {
  @IsString() @MaxLength(20) plan!: string;
  @IsString() @MinLength(11) @MaxLength(15) phone!: string;
}

@Controller("organizations")
@UseGuards(TenantGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":organizationId/billing/checkout")
  @Roles("OWNER", "ADMIN")
  checkout(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: CheckoutDto) {
    return this.payments.createCheckout(id, { userId: user.userId, email: user.email }, dto.plan, dto.phone);
  }
}

/**
 * Gateway endpoints. IPN is the ONLY activation path; the
 * browser return just redirects to the billing page with an
 * informational flag.
 */
@Controller("public/payments/sslcommerz")
export class PaymentsPublicController {
  constructor(private readonly payments: PaymentsService) {}

  @Public() @Post("ipn")
  ipn(@Body() body: Record<string, any>) {
    return this.payments.handleIpn(body ?? {});
  }

  @Public() @Post("return")
  browserReturnPost(@Body() body: Record<string, any>, @Res() res: Response) {
    return res.redirect(302, this.payments.returnRedirect(body ?? {}));
  }

  @Public() @Get("return")
  browserReturnGet(@Req() req: Request, @Res() res: Response) {
    return res.redirect(302, this.payments.returnRedirect((req.query ?? {}) as Record<string, any>));
  }
}
