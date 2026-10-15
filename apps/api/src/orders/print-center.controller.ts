import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { PrintCenterService } from "./print-center.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

/**
 * ON10 — Print & Document Center endpoints. Same prefix as
 * OrdersController; this controller is registered FIRST in
 * OrdersModule so the literal "print-jobs" / "print-template"
 * segments win over OrdersController's ":orderId" route (the
 * ON9 pattern). PDF responses stream through the exact
 * sendPdf mechanism the courier controller uses; a failed job
 * answers 422 (the job row + Bengali error are in the body) —
 * never a PDF that does not exist.
 */
@PermissionArea("orders")
@Controller("organizations/:organizationId/orders")
@UseGuards(TenantGuard, RolesGuard)
export class PrintCenterController {
  constructor(private readonly printCenter: PrintCenterService) {}

  @Get("print-template")
  getTemplate(@Param("organizationId") orgId: string) {
    return this.printCenter.getTemplate(orgId);
  }

  @Put("print-template") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updateTemplate(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: {
    logoUrl?: string | null; footerText?: string | null; termsText?: string | null; invoiceNote?: string | null;
  }) {
    return this.printCenter.updateTemplate(orgId, user.userId, dto ?? {});
  }

  /** Binary PDF response — the courier controller's sendPdf, verbatim. */
  private sendPdf(@Res() res: Response, buf: Buffer, filename: string) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  }

  @Post("print-jobs") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  async createJob(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: {
    type?: string; orderIds?: string[];
  }, @Res() res: Response) {
    const { job, pdf } = await this.printCenter.createJob(orgId, user.userId, dto ?? {});
    if (!pdf) {
      throw new HttpException(
        { message: job.error ?? "প্রিন্ট তৈরি করা যায়নি", jobId: job.id, failedOrderIds: job.failedOrderIds },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    res.setHeader("X-Print-Job-Id", job.id);
    if (job.failedOrderIds.length) res.setHeader("X-Print-Job-Failed-Order-Ids", job.failedOrderIds.join(","));
    this.sendPdf(res, pdf, `print-${job.type}-${job.id}.pdf`);
  }

  @Get("print-jobs")
  listJobs(@Param("organizationId") orgId: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.printCenter.listJobs(orgId, page, pageSize);
  }

  @Get("print-jobs/:jobId")
  getJob(@Param("organizationId") orgId: string, @Param("jobId") jobId: string) {
    return this.printCenter.getJob(orgId, jobId);
  }
}
