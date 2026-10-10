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
