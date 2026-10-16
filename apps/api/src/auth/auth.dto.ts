import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
export class RegisterDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  /** Milestone 41: optional referral code from a /register?ref= link. */
  @IsOptional() @IsString() @MaxLength(24) referralCode?: string;
}
export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}
/** GC21 (GB9): email verification token from the emailed link. */
export class VerifyEmailDto {
  @IsString() @MinLength(16) @MaxLength(256) token!: string;
}
/** GC21 (GB9): the account phone number (BD mobile; normalized
 * in the service via the ON11 rules). */
export class SetPhoneDto {
  @IsString() @MinLength(10) @MaxLength(20) phone!: string;
}
/** GC21 (GB9): the 6-digit phone OTP. */
export class VerifyPhoneOtpDto {
  @IsString() @MinLength(4) @MaxLength(8) code!: string;
}
