-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RecordStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "RecordStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "ManufacturingRecord" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);
