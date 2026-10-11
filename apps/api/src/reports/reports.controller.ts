import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { IsArray, IsOptional, IsString, MaxLength } from "class-validator";
import type { Response } from "express";
import { ReportCenterService } from "./report-center.service";
import { CustomReportsService } from "./custom-reports.service";
import { ReportExportService } from "./report-export.service";
import { ReportGoalsService } from "./report-goals.service";
import { ExecutiveService } from "./executive.service";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";
import { CurrentUser, PermissionArea, Roles, AuthUser } from "../common/decorators";

export class RunReportDto {
  @IsString() dimension!: string;
  @IsArray() @IsString({ each: true }) metrics!: string[];
  @IsOptional() @IsString() rangePreset?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}
export class SaveReportDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() dimension!: string;
  @IsArray() @IsString({ each: true }) metrics!: string[];
  @IsOptional() @IsString() rangePreset?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) recipients?: string[];
}
export class UpdateReportDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() dimension?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) metrics?: string[];
  @IsOptional() @IsString() rangePreset?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) recipients?: string[];
}
export class SetGoalDto {
  @IsString() month!: string;
  @IsString() metric!: string;
  @IsString() target!: string;
}

const WRITE = ["OWNER", "ADMIN", "MARKETING_MANAGER"] as const;

@PermissionArea("analytics")
@Controller("organizations/:organizationId/reports")
@UseGuards(TenantGuard, RolesGuard)
export class ReportsController {
  constructor(
    private readonly centerSvc: ReportCenterService,
    private readonly custom: CustomReportsService,
    private readonly exporter: ReportExportService,
    private readonly goals: ReportGoalsService,
    private readonly executiveSvc: ExecutiveService,
  ) {}

  @Get("center")
  center(@Param("organizationId") orgId: string) { return this.centerSvc.center(orgId); }

  @Get("executive")
  executive(@Param("organizationId") orgId: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.executiveSvc.executive(orgId, from, to);
  }

  @Get("goals")
  listGoals(@Param("organizationId") orgId: string, @Query("month") month?: string) {
    const now = new Date();
    return this.goals.list(orgId, month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  @Post("goals") @UseGuards(RolesGuard) @Roles(...WRITE)
  setGoal(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SetGoalDto) {
    return this.goals.set(orgId, user.userId, dto);
  }

  @Delete("goals/:id") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  removeGoal(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.goals.remove(orgId, user.userId, id);
  }

  @Get("overview.csv")
  async overviewCsv(@Param("organizationId") orgId: string, @Query("from") from: string | undefined, @Query("to") to: string | undefined, @Res() res: Response) {
    const { filename, csv } = await this.exporter.overviewCsv(orgId, from, to);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Get("saved/:id/export.csv")
  async savedCsv(@Param("organizationId") orgId: string, @Param("id") id: string, @Res() res: Response) {
    const { filename, csv } = await this.exporter.savedCsv(orgId, id);
    const def = await this.custom.get(orgId, id).catch(() => null);
    const utf8Name = def ? `report-${String(def.name).slice(0, 40)}.csv` : filename;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`);
    res.send(csv);
  }

  @Get("saved/:id/print") @Header("Content-Type", "text/html; charset=utf-8")
  savedPrint(@Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.exporter.savedPrintHtml(orgId, id);
  }

  @Post("custom/run") @UseGuards(RolesGuard) @Roles(...WRITE)
  run(@Param("organizationId") orgId: string, @Body() dto: RunReportDto) { return this.custom.run(orgId, dto); }

  @Post("saved") @UseGuards(RolesGuard) @Roles(...WRITE)
  create(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: SaveReportDto) {
    return this.custom.create(orgId, user.userId, dto);
  }

  @Get("saved")
  list(@Param("organizationId") orgId: string) { return this.custom.list(orgId); }

  @Get("saved/:id")
  async get(@Param("organizationId") orgId: string, @Param("id") id: string) {
    const row = await this.custom.get(orgId, id);
    return { ...row, createdAt: row.createdAt?.toISOString?.() ?? row.createdAt, updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt };
  }

  @Patch("saved/:id") @UseGuards(RolesGuard) @Roles(...WRITE)
  update(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string, @Body() dto: UpdateReportDto) {
    return this.custom.update(orgId, user.userId, id, dto);
  }

  @Delete("saved/:id") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  remove(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.custom.remove(orgId, user.userId, id);
  }

  @Post("saved/:id/run") @UseGuards(RolesGuard) @Roles(...WRITE)
  runSaved(@Param("organizationId") orgId: string, @Param("id") id: string) { return this.custom.runSaved(orgId, id); }
}
