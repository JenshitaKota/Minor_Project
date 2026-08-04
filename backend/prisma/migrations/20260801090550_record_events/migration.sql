-- CreateEnum
CREATE TYPE "RecordEventType" AS ENUM ('CREATED', 'EDITED', 'REVISED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ANCHORED');

-- CreateTable
CREATE TABLE "RecordEvent" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "type" "RecordEventType" NOT NULL,
    "actor" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordEvent_recordId_idx" ON "RecordEvent"("recordId");

-- AddForeignKey
ALTER TABLE "RecordEvent" ADD CONSTRAINT "RecordEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ManufacturingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
