import { Router } from "express";
import { prisma } from "../db/client";
import { hashContent, recordIdToBytes32 } from "../chain/hash";
import { verifyOnChain, coSignAnchorOnChain } from "../chain/anchorRegistry";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";

export const equipmentRouter = Router();

interface CalibrationRow {
  equipmentId: string;
  certificateNumber: string;
  technician: string;
  calibratedAt: Date;
  nextDueAt: Date;
}

/** Must stay byte-for-byte identical to backend/src/routes/equipment.ts's
 * calibrationContent - both processes have to independently arrive at the same hash
 * from the same row. */
function calibrationContent(calibration: CalibrationRow) {
  return {
    equipmentId: calibration.equipmentId,
    certificateNumber: calibration.certificateNumber,
    technician: calibration.technician,
    calibratedAt: calibration.calibratedAt.toISOString(),
    nextDueAt: calibration.nextDueAt.toISOString(),
  };
}

equipmentRouter.use(authenticate, requireRole("AUDITOR", "ADMIN"));

/** Independently confirms and co-signs a pending equipment-calibration anchor
 * proposal - same pattern as records.ts's /cosign, applied to the generic recordId
 * an equipment calibration anchors under (see AnchorRegistry's genericity, §4.7 of
 * the technical disclosure). Never writes to the database. */
equipmentRouter.post(
  "/:id/calibration/:calibrationId/cosign",
  asyncHandler(async (req, res) => {
    const calibration = await prisma.equipmentCalibration.findUnique({ where: { id: req.params.calibrationId } });
    if (!calibration || calibration.equipmentId !== req.params.id) {
      return res.status(404).json({ error: "Calibration not found" });
    }
    if (req.user!.email === calibration.anchorProposedBy) {
      return res.status(403).json({ error: "You proposed this calibration - a different reviewer must independently co-sign it" });
    }

    const recordIdBytes32 = recordIdToBytes32(calibration.id);
    const contentHash = hashContent(calibrationContent(calibration));

    const existing = await verifyOnChain(recordIdBytes32, contentHash);
    if (existing.anchored && existing.matches) {
      return res.json({
        calibrationId: calibration.id,
        contentHash,
        anchored: true,
        timestamp: existing.timestamp,
        alreadyAnchored: true,
      });
    }

    const result = await coSignAnchorOnChain(recordIdBytes32, contentHash, []);
    res.json({
      calibrationId: calibration.id,
      contentHash,
      txHash: result.txHash,
      timestamp: result.timestamp,
      alreadyAnchored: false,
    });
  })
);
