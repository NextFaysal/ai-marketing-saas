import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
import { ReportSharesService } from "./report-shares.service";
import { CurrentUser, AuthUser, Roles, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

class CreateShareDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsNumber() days?: number;
  @IsOptional() @IsNumber() expiresInDays?: number;
  @IsOptional() @IsString() kind?: string;
  // Frontier NB8 / CN18: required when kind = "campaign".
  @IsOptional() @IsString() planId?: string;
}

@Controller("organizations/:organizationId/report-shares")
@UseGuards(TenantGuard)
export class ReportSharesController {
  constructor(private readonly shares: ReportSharesService) {}

  @Post() @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN", "MARKETING_MANAGER")
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateShareDto) {
    return this.shares.create(orgId, user.userId, dto);
  }

  @Get()
  list(@Param("organizationId") orgId: string) { return this.shares.list(orgId); }

  @Delete(":shareId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  revoke(@Param("organizationId") orgId: string, @Param("shareId") id: string) {
    return this.shares.revoke(orgId, id);
  }
}

@Controller("public/reports")
export class PublicReportsController {
  constructor(private readonly shares: ReportSharesService) {}

  @Public()
  @Get(":token")
  view(@Param("token") token: string) { return this.shares.publicReport(token); }
}
