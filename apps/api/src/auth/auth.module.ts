import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { GoogleSsoService } from "./google-sso.service";
import { VerificationService } from "./verification.service";
import { MessagingModule } from "../messaging/messaging.module";

@Module({
  // GC21 (GB9): MessagingModule supplies the platform
  // EmailProvider/SmsProvider for VerificationService. It does
  // not import AuthModule (no cycle).
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET ?? "dev-only-secret-change-me-32chars", signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" } }), MessagingModule],
  controllers: [AuthController],
  providers: [AuthService, VerificationService, GoogleSsoService],
  exports: [JwtModule, VerificationService],
})
export class AuthModule {}
