-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('DRAFT', 'APPROVED', 'ANCHORED');

-- CreateTable
CREATE TABLE "ManufacturingRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'DRAFT',
    "contentHash" TEXT,
    "anchoredTxHash" TEXT,
    "anchoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManufacturingRecord_batchId_idx" ON "ManufacturingRecord"("batchId");
