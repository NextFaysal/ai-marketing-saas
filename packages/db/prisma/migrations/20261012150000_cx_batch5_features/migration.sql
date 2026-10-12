-- CreateTable
CREATE TABLE "PackingScanLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "scannedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "matchedItems" INTEGER NOT NULL DEFAULT 0,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PackingScanLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingScanItem" (
    "id" TEXT NOT NULL,
    "packingScanId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "sku" TEXT,
    "expectedQty" INTEGER NOT NULL,
    "scannedQty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "PackingScanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeScenario" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "sampleMessages" JSONB NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'beginner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scenarioId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "status" TEXT NOT NULL DEFAULT 'active',
    "score" INTEGER,
    "feedback" TEXT,
    "transcript" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackingScanLog_organizationId_orderId_idx" ON "PackingScanLog"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "PackingScanLog_organizationId_scannedAt_idx" ON "PackingScanLog"("organizationId", "scannedAt");

-- CreateIndex
CREATE INDEX "PackingScanItem_packingScanId_idx" ON "PackingScanItem"("packingScanId");

-- CreateIndex
CREATE INDEX "PracticeSession_organizationId_userId_idx" ON "PracticeSession"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "PracticeSession_organizationId_status_idx" ON "PracticeSession"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "PackingScanLog" ADD CONSTRAINT "PackingScanLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingScanItem" ADD CONSTRAINT "PackingScanItem_packingScanId_fkey" FOREIGN KEY ("packingScanId") REFERENCES "PackingScanLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "PracticeScenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
