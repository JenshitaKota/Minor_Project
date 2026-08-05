-- AlterEnum
ALTER TYPE "RecordEventType" ADD VALUE 'ANCHOR_PROPOSED';

-- AlterTable
ALTER TABLE "ManufacturingRecord" ADD COLUMN     "anchorCoSignedBy" TEXT,
ADD COLUMN     "anchorProposedAt" TIMESTAMP(3),
ADD COLUMN     "anchorProposedBy" TEXT;
