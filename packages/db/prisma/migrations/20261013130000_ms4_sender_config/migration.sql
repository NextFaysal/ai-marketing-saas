-- MS4: Per-tenant senders & providers.
-- Additive only:
--   MessagingSenderConfig — one row per org (MessagingSetting
--     pattern). Tenant SMTP (host/port/user/from; the password is
--     AES-256-GCM sealed and verified by a real nodemailer
--     handshake BEFORE the row is saved), tenant SMS gateway
--     (sslwireless | bulksmsbd | alphasms; API key sealed), and
--     the org's own per-unit rates used ONLY for preview cost
--     estimates. A missing row = no tenant senders = the platform
--     SMTP / platform SSL Wireless fallback, exactly as pre-MS4.
--   Secrets are never returned by any API (safe view only).
CREATE TABLE "MessagingSenderConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPassEncrypted" TEXT,
    "fromAddress" TEXT,
    "fromName" TEXT,
    "dkimSelector" TEXT,
    "smsGateway" TEXT,
    "smsApiKeyEncrypted" TEXT,
    "smsSenderId" TEXT,
    "smsApiUrl" TEXT,
    "smsCostPerPartMinor" INTEGER,
    "whatsappCostPerMessageMinor" INTEGER,
    "emailCostPerMessageMinor" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingSenderConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessagingSenderConfig_organizationId_key" ON "MessagingSenderConfig"("organizationId");
