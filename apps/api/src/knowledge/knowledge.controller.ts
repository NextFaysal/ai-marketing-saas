import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { KnowledgeService } from "./knowledge.service";
import { CreatePolicyDto, UpdatePolicyDto, CreateKnowledgeDocDto, IngestKnowledgeFileDto } from "./knowledge.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const WRITE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER"];

@PermissionArea("ai")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get("policies")
  listPolicies(@Param("organizationId") orgId: string) { return this.knowledge.listPolicies(orgId); }

  @Post("policies") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createPolicy(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreatePolicyDto) {
    return this.knowledge.createPolicy(orgId, user.userId, dto);
  }

  @Patch("policies/:policyId") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  updatePolicy(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("policyId") id: string, @Body() dto: UpdatePolicyDto) {
    return this.knowledge.updatePolicy(orgId, user.userId, id, dto);
  }

  @Delete("policies/:policyId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deletePolicy(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("policyId") id: string) {
    return this.knowledge.deletePolicy(orgId, user.userId, id);
  }

  @Get("knowledge-documents")
  listDocs(@Param("organizationId") orgId: string, @Query("kind") kind?: string) { return this.knowledge.listDocs(orgId, kind); }

  @Post("knowledge-documents") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  createDoc(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: CreateKnowledgeDocDto) {
    return this.knowledge.createDoc(orgId, user.userId, dto);
  }

  // CX9: Knowledge Document file upload endpoint
  @Post("knowledge-documents/upload") @UseGuards(RolesGuard) @Roles(...WRITE_ROLES)
  uploadDoc(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Body() dto: IngestKnowledgeFileDto) {
    return this.knowledge.ingestFile(orgId, user.userId, dto);
  }

  @Delete("knowledge-documents/:docId") @UseGuards(RolesGuard) @Roles("OWNER", "ADMIN")
  deleteDoc(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("docId") id: string) {
    return this.knowledge.deleteDoc(orgId, user.userId, id);
  }
}
