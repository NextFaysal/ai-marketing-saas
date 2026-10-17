-- ORG11 (Organization Next OB4): org-level security policy.
-- requireMfa: when true, TenantGuard refuses this org's API to
-- members whose account has no TOTP MFA enabled. The OWNER can
-- only turn it on after enabling MFA on their own account first
-- (service-level self-lockout guard). sessionMaxAgeHours: cap on
-- how old a member's server-side session (UserSession.createdAt)
-- may be while working in this org; NULL = no org-level cap.
ALTER TABLE "Organization" ADD COLUMN "requireMfa" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "sessionMaxAgeHours" INTEGER;
