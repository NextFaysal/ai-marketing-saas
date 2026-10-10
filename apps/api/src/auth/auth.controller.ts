import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthService } from "./auth.service";
import { LoginDto, RegisterDto } from "./auth.dto";
import { CurrentUser, Public, AuthUser } from "../common/decorators";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post("register")
  register(@Body() dto: RegisterDto, @Req() req: Request) { return this.auth.register(dto, req.ip); }
  @Public() @Post("login")
  login(@Body() dto: LoginDto, @Req() req: Request) { return this.auth.login(dto, req.ip); }
  @Public() @Post("totp/verify")
  totpVerify(@Body() body: { challengeToken: string; code: string }, @Req() req: Request) {
    return this.auth.verifyTotpLogin(body?.challengeToken ?? "", body?.code ?? "", req.ip);
  }
  @Public() @Post("reset-password")
  resetPassword(@Body() body: { token: string; newPassword: string }) {
    if (!body?.token || !body?.newPassword || body.newPassword.length < 8) {
      return { reset: false, message: "A valid token and a new password of at least 8 characters are required" };
    }
    return this.auth.resetPasswordWithAdminToken(body.token, body.newPassword);
  }
  @Get("me")
  me(@CurrentUser() user: AuthUser) { return this.auth.me(user.userId); }
  @Get("referral")
  referral(@CurrentUser() user: AuthUser) { return this.auth.myReferral(user.userId); }
  @Get("totp/status")
  totpStatus(@CurrentUser() user: AuthUser) { return this.auth.totpStatus(user.userId); }
  @Post("totp/enroll")
  totpEnroll(@CurrentUser() user: AuthUser, @Req() req: Request) { return this.auth.totpEnroll(user.userId, req.ip); }
  @Post("totp/confirm")
  totpConfirm(@CurrentUser() user: AuthUser, @Body() body: { code: string }, @Req() req: Request) {
    return this.auth.totpConfirm(user.userId, body?.code ?? "", req.ip);
  }
  @Post("totp/disable")
  totpDisable(@CurrentUser() user: AuthUser, @Body() body: { code: string }, @Req() req: Request) {
    return this.auth.totpDisable(user.userId, body?.code ?? "", req.ip);
  }
}
