/*
  Warnings:

  - You are about to drop the column `anchoredContent` on the `ManufacturingRecord` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ManufacturingRecord" DROP COLUMN "anchoredContent",
ADD COLUMN     "anchoredSnapshot" JSONB;
