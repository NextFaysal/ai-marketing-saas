import { Module } from "@nestjs/common";
import { SocialProofPublicController, SocialProofStaffController } from "./social-proof.controller";
import { SocialProofService } from "./social-proof.service";
import { AuditModule } from "../audit/audit.module";

/**
 * AB7 (AX17) — social-proof popups (staff setting + public feed).
 * Not yet wired into app.module.ts — the coordinator registers
 * this module (per the batch split, app.module.ts is not edited
 * by this worker).
 */
@Module({
  imports: [AuditModule],
  controllers: [SocialProofStaffController, SocialProofPublicController],
  providers: [SocialProofService],
  exports: [SocialProofService],
})
export class SocialProofModule {}
