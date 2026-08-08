-- CreateTable
CREATE TABLE "EquipmentCalibration" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "technician" TEXT NOT NULL,
    "calibratedAt" TIMESTAMP(3) NOT NULL,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT,
    "anchorProposedAt" TIMESTAMP(3),
    "anchorProposedBy" TEXT,
    "anchorCoSignedBy" TEXT,
    "anchoredTxHash" TEXT,
    "anchoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentCalibration_equipmentId_idx" ON "EquipmentCalibration"("equipmentId");

-- AddForeignKey
ALTER TABLE "EquipmentCalibration" ADD CONSTRAINT "EquipmentCalibration_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
