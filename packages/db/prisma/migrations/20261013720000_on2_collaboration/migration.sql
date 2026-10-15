-- ON2 (Timeline 360 + collaboration): per-user saved Orders views
-- and the staff-only internal order comment thread. All additive.
-- OrderComment is NEVER exposed on any public/customer surface.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateTable
CREATE TABLE "OrderSavedView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "queue" TEXT,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderSavedView_organizationId_userId_idx" ON "OrderSavedView"("organizationId", "userId");

-- CreateTable
CREATE TABLE "OrderComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderComment_organizationId_orderId_createdAt_idx" ON "OrderComment"("organizationId", "orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderComment" ADD CONSTRAINT "OrderComment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
