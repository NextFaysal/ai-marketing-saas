import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Param, Post, UploadedFile, UseFilters, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MulterError } from "multer";
import { LabelScanService, MAX_LABEL_SCAN_BYTES } from "./label-scan.service";
import { ProductRecognitionService } from "./product-recognition.service";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { badRequest } from "../i18n/api-exception";

const STAFF_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"];

/** CX8's own multer filter (CX9's names its 10MB limit in the
 *  message — the label-scan cap is 8MB, so the message must be
 *  this package's own to stay honest). */
@Catch(MulterError)
export class Cx8MulterErrorFilter implements ExceptionFilter {
  catch(exception: MulterError, _host: ArgumentsHost) {
    if (exception.code === "LIMIT_FILE_SIZE") {
      throw badRequest("cx8.theImageIsTooLargeAt");
    }
    throw exception;
  }
}

/**
 * CX8 (ক): packing-desk label scan + plain identifier search.
 * Lives on the courier surface (packing is courier work); staff
 * roles only, org-scoped by TenantGuard like every tenant route.
 */
@PermissionArea("courier")
@Controller("organizations/:organizationId/courier")
@UseGuards(TenantGuard, RolesGuard)
export class LabelScanController {
  constructor(private readonly labelScan: LabelScanService) {}

  @Post("label-scan") @UseGuards(RolesGuard) @Roles(...STAFF_ROLES)
  @UseFilters(Cx8MulterErrorFilter)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_LABEL_SCAN_BYTES } }))
  scan(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.labelScan.scanLabel(orgId, user.userId, file);
  }

  /** The "🔢 নম্বর দিয়ে খুঁজুন" box — no AI involved. */
  @Post("label-lookup") @UseGuards(RolesGuard) @Roles(...STAFF_ROLES)
  lookup(@Param("organizationId") orgId: string, @Body() body: { query?: string }) {
    return this.labelScan.searchByNumber(orgId, body?.query ?? "");
  }
}

/**
 * CX8 (খ): agent-triggered product recognition for one inbound
 * inbox image. Returns candidates only — it never sends anything.
 */
@PermissionArea("inbox")
@Controller("organizations/:organizationId/inbox")
@UseGuards(TenantGuard, RolesGuard)
export class ProductRecognitionController {
  constructor(private readonly recognition: ProductRecognitionService) {}

  @Post("conversations/:conversationId/messages/:messageId/recognize-product") @UseGuards(RolesGuard) @Roles(...STAFF_ROLES)
  recognize(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("conversationId") conversationId: string,
    @Param("messageId") messageId: string,
  ) {
    return this.recognition.recognize(orgId, user.userId, conversationId, messageId);
  }
}
