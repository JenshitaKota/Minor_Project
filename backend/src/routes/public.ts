import { Router } from "express";
import { prisma } from "../db/client";
import { hashRecord, recordIdToBytes32 } from "../chain/hash";
import { verifyOnChain } from "../chain/anchorRegistry";
import { asyncHandler } from "../middleware/asyncHandler";

export const publicRouter = Router();

/** Unauthenticated: anyone with a batch number (e.g. from packaging) can check whether every
 * manufacturing record behind it still matches what was anchored at approval time. */
publicRouter.get(
  "/verify/:batchNumber",
  asyncHandler(async (req, res) => {
    const batch = await prisma.batch.findUnique({
      where: { batchNumber: req.params.batchNumber },
      include: { records: { orderBy: { createdAt: "asc" } } },
    });

    if (!batch) {
      return res.status(404).json({ error: "No batch found with this batch number" });
    }

    const results = await Promise.all(
      batch.records.map(async (record) => {
        if (record.status !== "ANCHORED" || !record.contentHash) {
          return {
            recordId: record.id,
            label: record.stage,
            status: record.status,
            anchored: false,
            matches: null,
            anchoredAt: null,
          };
        }

        const currentHash = hashRecord(record);
        const recordIdBytes32 = recordIdToBytes32(record.id);
        const { anchored, matches } = await verifyOnChain(recordIdBytes32, currentHash);

        return {
          recordId: record.id,
          label: record.stage,
          status: record.status,
          anchored,
          matches,
          anchoredAt: record.anchoredAt,
        };
      })
    );

    res.json({
      batchId: batch.batchNumber,
      product: batch.product,
      plannedQuantity: batch.plannedQuantity,
      records: results,
    });
  })
);
