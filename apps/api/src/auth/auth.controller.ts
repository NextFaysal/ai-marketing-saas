import { Body, Controller, Delete, Get, Optional, Param, Patch, Post, Query, Req, Res, ServiceUnavailableException } from "@nestjs/common";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { GoogleSsoService } from "./google-sso.service";
import { VerificationService } from "./verification.service";
import { LoginDto, RegisterDto, SetPhoneDto, VerifyEmailDto, VerifyPhoneOtpDto } from "./auth.dto";
import { CurrentUser, Public, AuthUser } from "../common/decorators";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    // GC21 (GB9): optional so direct constructions in older
    // specs keep working; the module always provides it.
    @Optional() private readonly verification?: VerificationService,
    // AB8 (AX26): optional for the same reason — older direct
    // constructions keep working; the module provides it.
    @Optional() private readonly googleSso?: GoogleSsoService,
  ) {}

  private verificationSvc(): VerificationService {
    if (!this.verification) throw new ServiceUnavailableException("Verification service is unavailable");
    return this.verification;
  }
  private googleSvc(): GoogleSsoService {
    if (!this.googleSso) throw new ServiceUnavailableException("Google sign-in is unavailable");
    return this.googleSso;
  }
  @Public() @Post("register")
  register(@Body() dto: RegisterDto, @Req() req: Request) { return this.auth.register(dto, req.ip, req.headers["user-agent"]); }
  @Public() @Post("login")
  login(@Body() dto: LoginDto, @Req() req: Request) { return this.auth.login(dto, req.ip, req.headers["user-agent"]); }
  @Public() @Post("totp/verify")
  totpVerify(@Body() body: { challengeToken: string; code: string }, @Req() req: Request) {
    return this.auth.verifyTotpLogin(body?.challengeToken ?? "", body?.code ?? "", req.ip, req.headers["user-agent"]);
  }
  // AB8 (AX26): Google SSO. config tells the login page whether
  // to render the button; start returns the authorize URL as
  // JSON (the WEB page navigates the browser there — no server
  // redirect needed, and the page stays in control); Google
  // itself redirects the browser to callback, which 302s to
  // the web (handoff fragment or ?googleError=<code>); the web
  // page then POSTs the handoff token to exchange for the same
  // result shape as login (session, or a TOTP challenge).
  @Public() @Get("google/config")
  googleConfig() { return this.googleSvc().config(); }
  @Public() @Get("google/start")
  googleStart(@Req() req: Request) { return this.googleSvc().start(req.ip); }
  @Public() @Get("google/callback")
  async googleCallback(@Query("code") code: string, @Query("state") state: string, @Req() req: Request, @Res() res: Response) {
    const url = await this.googleSvc().callback(code ?? "", state ?? "", req.ip, req.headers["user-agent"]);
    return res.redirect(302, url);
  }
  @Public() @Post("google/exchange")
  googleExchange(@Body() body: { handoffToken: string }, @Req() req: Request) {
    return this.googleSvc().exchange(body?.handoffToken ?? "", req.ip, req.headers["user-agent"]);
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
  // ML1 (Multi-Language MB1): the caller's own dashboard
  // language preference. Authenticated (no @Public): body
  // { preferredLocale: "bn" | "en" | null } — omitted field =
  // no change, null = clear back to the org default.
  @Patch("me/preferences")
  updateMyPreferences(@CurrentUser() user: AuthUser, @Body() body: { preferredLocale?: string | null }) {
    return this.auth.updateMyPreferences(user.userId, body?.preferredLocale);
  }
  // GC21 (GB9): account verification. The emailed link lands on
  // the public /verify-email web page, which posts the token
  // here — public because the click may happen logged-out.
  @Public() @Post("verify-email")
  verifyEmail(@Body() dto: VerifyEmailDto) { return this.verificationSvc().verifyEmail(dto?.token ?? ""); }
  @Post("verification/email")
  resendEmailVerification(@CurrentUser() user: AuthUser) { return this.verificationSvc().requestEmailVerification(user.userId); }
  @Post("verification/phone")
  setPhone(@CurrentUser() user: AuthUser, @Body() dto: SetPhoneDto) { return this.verificationSvc().setPhone(user.userId, dto?.phone ?? ""); }
  @Post("verification/phone/otp")
  requestPhoneOtp(@CurrentUser() user: AuthUser) { return this.verificationSvc().requestPhoneOtp(user.userId); }
  @Post("verification/phone/verify")
  verifyPhoneOtp(@CurrentUser() user: AuthUser, @Body() dto: VerifyPhoneOtpDto) {
    return this.verificationSvc().verifyPhoneOtp(user.userId, dto?.code ?? "");
  }
  // GB6 (GC16): own sessions + login history.
  @Get("sessions")
  sessions(@CurrentUser() user: AuthUser) { return this.auth.mySessions(user.userId, user.sid); }
  @Delete("sessions/:sessionId")
  revokeSession(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) {
    return this.auth.revokeMySession(user.userId, sessionId);
  }
  @Get("login-history")
  loginHistory(@CurrentUser() user: AuthUser) { return this.auth.myLoginHistory(user.userId); }
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
