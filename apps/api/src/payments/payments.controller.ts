import { Body, Controller, Delete, Get, Header, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Request, Response } from "express";
import { PaymentsService } from "./payments.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, Public, Roles, type AuthUser, PermissionArea } from "../common/decorators";

class CheckoutDto {
  @IsString() @MaxLength(20) plan!: string;
  @IsString() @MinLength(11) @MaxLength(15) phone!: string;
  @IsOptional() @IsString() @MaxLength(24) couponCode?: string;
  @IsOptional() @IsIn(["sslcommerz", "bkash"]) gateway?: string;
  @IsOptional() @IsIn(["monthly", "yearly"]) cycle?: string;
}

class CouponPreviewDto {
  @IsString() @MaxLength(24) code!: string;
  @IsString() @MaxLength(20) plan!: string;
}

class ScheduleChangeDto {
  @IsString() @MaxLength(20) plan!: string;
}

class AutoRenewStartDto {
  @IsString() @MinLength(11) @MaxLength(15) phone!: string;
}

@PermissionArea("billing")
@Controller("organizations")
@UseGuards(TenantGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":organizationId/billing/checkout")
  @Roles("OWNER", "ADMIN")
  checkout(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: CheckoutDto) {
    return this.payments.createCheckout(id, { userId: user.userId, email: user.email }, dto.plan, dto.phone, { couponCode: dto.couponCode, gateway: dto.gateway, cycle: dto.cycle });
  }

  @Post(":organizationId/billing/coupon-preview")
  @Roles("OWNER", "ADMIN")
  couponPreview(@Param("organizationId") id: string, @Body() dto: CouponPreviewDto) {
    return this.payments.previewCoupon(id, dto.code, dto.plan);
  }

  @Get(":organizationId/billing/credit-ledger")
  creditLedger(@CurrentUser() user: AuthUser, @Param("organizationId") id: string) {
    void user;
    return this.payments.creditLedger(id);
  }

  @Post(":organizationId/billing/schedule-change")
  @Roles("OWNER", "ADMIN")
  scheduleChange(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: ScheduleChangeDto) {
    return this.payments.schedulePlanChange(id, user.userId, dto.plan);
  }

  @Delete(":organizationId/billing/schedule-change")
  @Roles("OWNER", "ADMIN")
  cancelScheduleChange(@CurrentUser() user: AuthUser, @Param("organizationId") id: string) {
    return this.payments.cancelScheduledPlanChange(id, user.userId);
  }

  @Post(":organizationId/billing/auto-renew/start")
  @Roles("OWNER", "ADMIN")
  autoRenewStart(@CurrentUser() user: AuthUser, @Param("organizationId") id: string, @Body() dto: AutoRenewStartDto) {
    return this.payments.startAutoRenew(id, { userId: user.userId }, dto.phone);
  }

  @Post(":organizationId/billing/auto-renew/cancel")
  @Roles("OWNER", "ADMIN")
  autoRenewCancel(@CurrentUser() user: AuthUser, @Param("organizationId") id: string) {
    return this.payments.cancelAutoRenew(id, user.userId);
  }

  @Get(":organizationId/billing/payments/:paymentId/invoice")
  @Roles("OWNER", "ADMIN")
  @Header("Content-Type", "text/html; charset=utf-8")
  invoice(@Param("organizationId") id: string, @Param("paymentId") paymentId: string) {
    return this.payments.invoiceHtmlForOrgPayment(id, paymentId);
  }

  /** GC22 (GB9): the same invoice as a PDF download (binary
   * response, courier-label style). Two route shapes — the
   * payments-mirroring one and the invoices one — each with
   * its own handler (stacked @Get decorators on one method
   * register only ONE route in NestJS). */
  @Get(":organizationId/billing/payments/:paymentId/invoice.pdf")
  @Roles("OWNER", "ADMIN")
  async invoicePdf(@Param("organizationId") id: string, @Param("paymentId") paymentId: string, @Res() res: Response) {
    return this.sendInvoicePdf(id, paymentId, res);
  }

  @Get(":organizationId/billing/invoices/:paymentId/pdf")
  @Roles("OWNER", "ADMIN")
  async invoicePdfByInvoicesRoute(@Param("organizationId") id: string, @Param("paymentId") paymentId: string, @Res() res: Response) {
    return this.sendInvoicePdf(id, paymentId, res);
  }

  private async sendInvoicePdf(id: string, paymentId: string, res: Response) {
    const buf = await this.payments.invoicePdfForOrgPayment(id, paymentId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${paymentId}.pdf"`);
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
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

/**
 * bKash callback. The redirect itself proves nothing: the
 * service executes the payment server-to-server and activates
 * only on bKash's own Completed confirmation (see service).
 */
@Controller("public/payments/bkash")
export class BkashPublicController {
  constructor(private readonly payments: PaymentsService) {}

  @Public() @Get("callback")
  async callback(@Req() req: Request, @Res() res: Response) {
    const url = await this.payments.handleBkashCallback((req.query ?? {}) as Record<string, any>);
    return res.redirect(302, url);
  }

  @Public() @Get("agreement/callback")
  async agreementCallback(@Req() req: Request, @Res() res: Response) {
    const url = await this.payments.handleBkashAgreementCallback((req.query ?? {}) as Record<string, any>);
    return res.redirect(302, url);
  }
}
