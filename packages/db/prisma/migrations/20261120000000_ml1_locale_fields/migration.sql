-- ML1 (Multi-Language MB1): locale fields — the foundation of
-- the English + Bangla multi-language program.
--
-- User.preferredLocale is the signed-in person's OWN dashboard
-- language preference (bn | en). Nullable: null honestly means
-- "no personal preference recorded" — the dashboard then
-- follows the organization's default below.
--
-- Organization.dashboardLocale is that org default (bn | en),
-- NOT NULL with a 'bn' default: existing organizations are
-- Bangla-first today, so every existing row backfills to 'bn'
-- and nothing changes visually until an org switches it.
-- StorefrontSetting.locale (the shop surface) already exists
-- and is deliberately untouched — shop and dashboard languages
-- are separate choices.
-- Hand-written to match schema.prisma exactly.
ALTER TABLE "User" ADD COLUMN "preferredLocale" TEXT;
ALTER TABLE "Organization" ADD COLUMN "dashboardLocale" TEXT NOT NULL DEFAULT 'bn';
