import { Router } from "express";
import { prisma } from "../db/client";
import { hashRecord, recordIdToBytes32 } from "../chain/hash";
import { verifyOnChain } from "../chain/anchorRegistry";
import { evaluateAnomalies } from "../anomaly/rules";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate } from "../middleware/auth";

export const analyticsRouter = Router();

analyticsRouter.use(authenticate);

analyticsRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const [totalBatches, records] = await Promise.all([
      prisma.batch.count(),
      prisma.manufacturingRecord.findMany(),
    ]);

    const statusBreakdown = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, ANCHORED: 0, REJECTED: 0 };
    for (const record of records) {
      statusBreakdown[record.status]++;
    }

    // "Pass rate" is computed live: every anchored record's current DB content is re-hashed
    // and checked against the chain right now, not read from a cached/stale flag. The
    // per-record checks are read-only chain calls, so they're fired concurrently rather
    // than one round-trip at a time - this is what keeps that live check cheap as the
    // number of anchored records grows.
    const anchoredRecords = records.filter((r) => r.status === "ANCHORED" && r.contentHash);
    const verifications = await Promise.all(
      anchoredRecords.map((record) => verifyOnChain(recordIdToBytes32(record.id), hashRecord(record)))
    );
    const passed = verifications.filter((v) => v.matches).length;
    const checked = anchoredRecords.length;
    const passRatePercent = checked > 0 ? Math.round((passed / checked) * 1000) / 10 : null;

    const reviewed = records.filter((r) => r.submittedAt && r.reviewedAt);
    const averageApprovalTimeMinutes =
      reviewed.length > 0
        ? Math.round(
            (reviewed.reduce((sum, r) => sum + (r.reviewedAt!.getTime() - r.submittedAt!.getTime()), 0) /
              reviewed.length /
              60000) *
              10
          ) / 10
        : null;

    const anomalyCount = records.filter((r) => evaluateAnomalies(r).length > 0).length;

    res.json({
      totalBatches,
      totalRecords: records.length,
      statusBreakdown,
      verification: { checked, passed, passRatePercent },
      averageApprovalTimeMinutes,
      anomalyCount,
    });
  })
);
