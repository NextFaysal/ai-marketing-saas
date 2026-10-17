-- MX7: Drag-drop Email Builder & Content Library.
-- Additive only, no backfill beyond column defaults:
--   Organization.brandFont / brandSecondaryColor — brand-kit
--     completion on the EXISTING Org Settings branding (M59 put
--     brandName/logoUrl/primaryColor on this row; no second
--     brand store is created). brandFont is an allowlist key
--     (messaging/email-blocks.ts BRAND_FONT_STACKS), never
--     free-text CSS; brandSecondaryColor is #RRGGBB like
--     primaryColor. NULL = not set (platform defaults render).
--   MessageTemplate.blocks — the builder source for templates
--     built with the block builder ([{type, ...}], validated by
--     messaging/email-blocks.ts). Rendering writes the SAME
--     body/htmlBody the send path already uses; NULL on every
--     pre-MX7 / hand-authored template = body/htmlBody remain
--     the source, byte-identical to before.
--   MessageTemplate.version — starts at 1 (default covers every
--     existing row), increments on every content edit.
--   MessageTemplateVersion — one snapshot row per version;
--     restore creates a NEW version, history is never rewritten.
--   MessagingContentBlock — the per-org content library: one
--     saved, validated email block per row.
--   Broadcast.templateVersion — the template version a
--     broadcast's content was taken from, stamped at creation;
--     NULL when not built from a template / pre-MX7.
ALTER TABLE "Organization" ADD COLUMN "brandFont" TEXT;
ALTER TABLE "Organization" ADD COLUMN "brandSecondaryColor" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "blocks" JSONB;
ALTER TABLE "MessageTemplate" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Broadcast" ADD COLUMN "templateVersion" INTEGER;

CREATE TABLE "MessageTemplateVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "htmlBody" TEXT,
    "blocks" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageTemplateVersion_templateId_version_key" ON "MessageTemplateVersion"("templateId", "version");
CREATE INDEX "MessageTemplateVersion_organizationId_templateId_idx" ON "MessageTemplateVersion"("organizationId", "templateId");

CREATE TABLE "MessagingContentBlock" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingContentBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessagingContentBlock_organizationId_kind_idx" ON "MessagingContentBlock"("organizationId", "kind");
