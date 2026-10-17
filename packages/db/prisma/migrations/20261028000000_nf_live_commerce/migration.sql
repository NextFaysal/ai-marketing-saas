-- NF1 (FB1): Facebook Live Commerce — LiveSession /
-- LiveSessionProduct / LiveComment / LiveSessionOrder.
-- Hand-written to match schema.prisma exactly (the repo's
-- hand-written migration style). Attribution lives ONLY in
-- LiveSessionOrder; no columns are added to "Order".
-- LiveComment unique note: Postgres treats NULLs as distinct in
-- a unique index, so manual comments (externalCommentId NULL)
-- never collide, while a meta comment's (liveSessionId,
-- externalCommentId) pair is stored at most once — the provider
-- upsert relies on exactly that.

CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "externalLiveVideoId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveSessionProduct" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isNowShowing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSessionProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveComment" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalCommentId" TEXT,
    "commenterExternalId" TEXT,
    "commenterName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "commentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveSessionOrder" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "liveCommentId" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveSessionOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveSession_organizationId_status_idx" ON "LiveSession"("organizationId", "status");
CREATE INDEX "LiveSession_organizationId_createdAt_idx" ON "LiveSession"("organizationId", "createdAt");
CREATE INDEX "LiveSession_socialAccountId_idx" ON "LiveSession"("socialAccountId");

CREATE UNIQUE INDEX "LiveSessionProduct_liveSessionId_productId_key" ON "LiveSessionProduct"("liveSessionId", "productId");
CREATE INDEX "LiveSessionProduct_liveSessionId_displayOrder_idx" ON "LiveSessionProduct"("liveSessionId", "displayOrder");
CREATE INDEX "LiveSessionProduct_productId_idx" ON "LiveSessionProduct"("productId");

CREATE UNIQUE INDEX "LiveComment_liveSessionId_externalCommentId_key" ON "LiveComment"("liveSessionId", "externalCommentId");
CREATE INDEX "LiveComment_organizationId_liveSessionId_commentedAt_idx" ON "LiveComment"("organizationId", "liveSessionId", "commentedAt");
CREATE INDEX "LiveComment_liveSessionId_commentedAt_idx" ON "LiveComment"("liveSessionId", "commentedAt");

CREATE UNIQUE INDEX "LiveSessionOrder_orderId_key" ON "LiveSessionOrder"("orderId");
CREATE INDEX "LiveSessionOrder_organizationId_liveSessionId_idx" ON "LiveSessionOrder"("organizationId", "liveSessionId");
CREATE INDEX "LiveSessionOrder_liveSessionId_idx" ON "LiveSessionOrder"("liveSessionId");
CREATE INDEX "LiveSessionOrder_liveCommentId_idx" ON "LiveSessionOrder"("liveCommentId");

ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LiveSessionProduct" ADD CONSTRAINT "LiveSessionProduct_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSessionProduct" ADD CONSTRAINT "LiveSessionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveComment" ADD CONSTRAINT "LiveComment_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveSessionOrder" ADD CONSTRAINT "LiveSessionOrder_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSessionOrder" ADD CONSTRAINT "LiveSessionOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSessionOrder" ADD CONSTRAINT "LiveSessionOrder_liveCommentId_fkey" FOREIGN KEY ("liveCommentId") REFERENCES "LiveComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
