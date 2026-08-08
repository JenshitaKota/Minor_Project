import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { hashContent, recordIdToBytes32 } from "../chain/hash";
import { proposeAnchorOnChain, coSignAnchorOnChain, verifyOnChain } from "../chain/anchorRegistry";

export const equipmentRouter = Router();

const createEquipmentSchema = z.object({
  code: z.string().min(1, "code is required"),
  name: z.string().min(1, "name is required"),
  type: z.string().min(1, "type is required"),
});

const updateStatusSchema = z.object({
  status: z.enum(["ACTIVE", "MAINTENANCE", "RETIRED"]),
});

const calibrateSchema = z.object({
  certificateNumber: z.string().min(1, "certificateNumber is required"),
  technician: z.string().min(1, "technician is required"),
  calibratedAt: z.coerce.date(),
  nextDueAt: z.coerce.date(),
});

interface CalibrationRow {
  equipmentId: string;
  certificateNumber: string;
  technician: string;
  calibratedAt: Date;
  nextDueAt: Date;
}

/** The canonical, reproducible payload a calibration's hash is computed over -
 * mirrors hashRecord in chain/hash.ts: recompute this from the DB row at any later
 * point and get the identical hash, the same property that makes on-chain
 * verification meaningful. */
function calibrationContent(calibration: CalibrationRow) {
  return {
    equipmentId: calibration.equipmentId,
    certificateNumber: calibration.certificateNumber,
    technician: calibration.technician,
    calibratedAt: calibration.calibratedAt.toISOString(),
    nextDueAt: calibration.nextDueAt.toISOString(),
  };
}

equipmentRouter.use(authenticate);

equipmentRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const equipment = await prisma.equipment.findMany({ orderBy: { code: "asc" } });
    res.json(equipment);
  })
);

equipmentRouter.post(
  "/",
  requireRole("OPERATOR", "ADMIN"),
  validate(createEquipmentSchema),
  asyncHandler(async (req, res) => {
    const { code, name, type } = req.body;

    const equipment = await prisma.equipment.create({ data: { code, name, type } });
    res.status(201).json(equipment);
  })
);

equipmentRouter.patch(
  "/:id/status",
  requireRole("OPERATOR", "ADMIN"),
  validate(updateStatusSchema),
  asyncHandler(async (req, res) => {
    const { status } = req.body;

    const equipment = await prisma.equipment.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(equipment);
  })
);

/** Calibrations proposed but not yet independently co-signed - same purpose as
 * records' /pending-cosign. Registered before /:id/calibrations so it isn't
 * swallowed as an equipment id. */
equipmentRouter.get(
  "/pending-cosign",
  asyncHandler(async (req, res) => {
    const calibrations = await prisma.equipmentCalibration.findMany({
      where: {
        anchorProposedAt: { not: null },
        anchoredAt: null,
        anchorProposedBy: { not: req.user!.email },
      },
      orderBy: { anchorProposedAt: "asc" },
      include: { equipment: true },
    });

    res.json({ count: calibrations.length, items: calibrations });
  })
);

equipmentRouter.get(
  "/:id/calibrations",
  asyncHandler(async (req, res) => {
    const calibrations = await prisma.equipmentCalibration.findMany({
      where: { equipmentId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(calibrations);
  })
);

/** Logs a calibration and proposes anchoring it. Equipment moves to MAINTENANCE
 * immediately (it's mid-calibration, not to be trusted until an independent
 * co-signature confirms the work) and only returns to ACTIVE once that co-sign
 * happens - see /cosign below. */
equipmentRouter.post(
  "/:id/calibrate",
  requireRole("OPERATOR", "ADMIN"),
  validate(calibrateSchema),
  asyncHandler(async (req, res) => {
    const equipment = await prisma.equipment.findUnique({ where: { id: req.params.id } });
    if (!equipment) return res.status(404).json({ error: "Equipment not found" });

    const { certificateNumber, technician, calibratedAt, nextDueAt } = req.body;
    const content = calibrationContent({ equipmentId: equipment.id, certificateNumber, technician, calibratedAt, nextDueAt });

    const calibration = await prisma.$transaction(async (tx) => {
      const calibration = await tx.equipmentCalibration.create({
        data: { equipmentId: equipment.id, certificateNumber, technician, calibratedAt, nextDueAt, content },
      });
      await tx.equipment.update({ where: { id: equipment.id }, data: { status: "MAINTENANCE" } });
      return calibration;
    });

    const recordIdBytes32 = recordIdToBytes32(calibration.id);
    const contentHash = hashContent(calibrationContent(calibration));
    const result = await proposeAnchorOnChain(recordIdBytes32, contentHash, []);

    const updated = await prisma.equipmentCalibration.update({
      where: { id: calibration.id },
      data: {
        contentHash,
        anchorProposedAt: new Date(result.timestamp * 1000),
        anchorProposedBy: req.user!.email,
      },
    });

    res.status(201).json(updated);
  })
);

/** Manual retry for the rare case where the calibration row was created but the
 * on-chain propose failed (contentHash/anchorProposedAt still null). */
equipmentRouter.post(
  "/:id/calibration/:calibrationId/retry-propose",
  requireRole("OPERATOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const calibration = await prisma.equipmentCalibration.findUnique({ where: { id: req.params.calibrationId } });
    if (!calibration || calibration.equipmentId !== req.params.id) {
      return res.status(404).json({ error: "Calibration not found" });
    }
    if (calibration.anchorProposedAt) {
      return res.status(409).json({ error: "Already proposed - awaiting an independent Auditor co-signature" });
    }

    const recordIdBytes32 = recordIdToBytes32(calibration.id);
    const contentHash = hashContent(calibrationContent(calibration));
    const result = await proposeAnchorOnChain(recordIdBytes32, contentHash, []);

    const updated = await prisma.equipmentCalibration.update({
      where: { id: calibration.id },
      data: {
        contentHash,
        anchorProposedAt: new Date(result.timestamp * 1000),
        anchorProposedBy: req.user!.email,
      },
    });

    res.json(updated);
  })
);

/** Independently confirms a pending calibration proposal, finalizing the anchor
 * and returning the equipment to ACTIVE. Must be a different person than whoever
 * proposed it - checked here for a clear error, enforced again on-chain regardless
 * (AnchorRegistry.coSignAnchor reverts if called by the same attestor). */
equipmentRouter.post(
  "/:id/calibration/:calibrationId/cosign",
  requireRole("AUDITOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const calibration = await prisma.equipmentCalibration.findUnique({ where: { id: req.params.calibrationId } });
    if (!calibration || calibration.equipmentId !== req.params.id) {
      return res.status(404).json({ error: "Calibration not found" });
    }
    if (!calibration.anchorProposedAt || calibration.anchoredAt) {
      return res.status(409).json({ error: "No pending calibration proposal for this equipment" });
    }
    if (req.user!.email === calibration.anchorProposedBy) {
      return res.status(403).json({ error: "You proposed this calibration - a different reviewer must independently co-sign it" });
    }

    const recordIdBytes32 = recordIdToBytes32(calibration.id);
    const result = await coSignAnchorOnChain(recordIdBytes32, calibration.contentHash!, []);

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.equipmentCalibration.update({
        where: { id: calibration.id },
        data: {
          anchoredTxHash: result.txHash,
          anchoredAt: new Date(result.timestamp * 1000),
          anchorCoSignedBy: req.user!.email,
        },
      });
      await tx.equipment.update({ where: { id: calibration.equipmentId }, data: { status: "ACTIVE" } });
      return updated;
    });

    res.json(updated);
  })
);

equipmentRouter.get(
  "/:id/calibration/:calibrationId/verify",
  asyncHandler(async (req, res) => {
    const calibration = await prisma.equipmentCalibration.findUnique({ where: { id: req.params.calibrationId } });
    if (!calibration || calibration.equipmentId !== req.params.id) {
      return res.status(404).json({ error: "Calibration not found" });
    }
    if (!calibration.anchoredAt || !calibration.contentHash) {
      return res.status(409).json({ error: "Calibration has not been anchored yet" });
    }

    const recordIdBytes32 = recordIdToBytes32(calibration.id);
    const currentHash = hashContent(calibrationContent(calibration));

    const { anchored, matches, timestamp } = await verifyOnChain(recordIdBytes32, currentHash);

    res.json({
      calibrationId: calibration.id,
      anchored,
      matches,
      anchoredAt: new Date(timestamp * 1000),
      anchoredHash: calibration.contentHash,
      currentHash,
    });
  })
);
