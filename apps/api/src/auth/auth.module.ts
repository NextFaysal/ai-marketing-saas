import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET ?? "dev-only-secret-change-me-32chars", signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" } })],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
