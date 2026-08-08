import { Router } from "express";
import { prisma } from "../db/client";
import type { Prisma } from "../generated/prisma/client";
import { hashRecord, hashAnomalyFinding, recordIdToBytes32, type HashableAnomalyFinding } from "../chain/hash";
import { verifyOnChain, coSignAnchorOnChain } from "../chain/anchorRegistry";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { evaluateAnomalies, type Anomaly } from "../anomaly/rules";
import { getReviewerBaseline, type ReviewerBaseline } from "../anomaly/baseline";

export const recordsRouter = Router();

interface AnchorableRecord {
  id: string;
  stage: string;
  equipmentId: string | null;
  content: Prisma.JsonValue;
  status: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  anchorProposedBy: string | null;
}

function buildAnomalyFinding(record: AnchorableRecord, anomaly: Anomaly, baseline: ReviewerBaseline): HashableAnomalyFinding {
  return {
    recordId: record.id,
    anomalyId: anomaly.id,
    reviewerEmail: record.reviewedBy!,
    submittedAt: record.submittedAt!.toISOString(),
    reviewedAt: record.reviewedAt!.toISOString(),
    durationMs: record.reviewedAt!.getTime() - record.submittedAt!.getTime(),
    baseline: baseline.sampleSize > 0 ? baseline : null,
  };
}

/** Independently recomputes exactly the same package the main backend computed when
 * proposing - the whole point of this service is to arrive at this value on its own,
 * not to trust whatever the caller says was proposed. A threshold config mismatch
 * against the main backend's ANOMALY_* env vars will surface here as a finding-hash
 * mismatch when co-signing, not as data tampering - see .env.example. */
async function computeAnchorPackage(record: AnchorableRecord) {
  const contentHash = hashRecord(record);

  let findingHashes: string[] = [];
  if (record.reviewedBy && record.submittedAt && record.reviewedAt) {
    const baseline = await getReviewerBaseline(prisma, record.reviewedBy, record.reviewedAt);
    const anomalies = evaluateAnomalies(record, baseline);
    findingHashes = anomalies.map((a) => hashAnomalyFinding(buildAnomalyFinding(record, a, baseline)));
  }

  return { contentHash, findingHashes };
}

recordsRouter.use(authenticate, requireRole("AUDITOR", "ADMIN"));

/** Independently confirms and co-signs a pending anchor proposal. This process never
 * writes to the database - it verifies identity, recomputes the expected package from
 * a read-only view of the data, checks on-chain state for idempotency, and calls
 * coSignAnchor with the Auditor's own key. Persisting the result is the main backend's
 * job (see backend/src/routes/records.ts's confirm step), which independently
 * re-verifies on-chain rather than trusting this response. */
recordsRouter.post(
  "/:id/cosign",
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record not found" });
    if (req.user!.email === record.anchorProposedBy) {
      return res.status(403).json({ error: "You proposed this anchor - a different reviewer must independently co-sign it" });
    }

    const recordIdBytes32 = recordIdToBytes32(record.id);
    const { contentHash, findingHashes } = await computeAnchorPackage(record);

    // Idempotency: if this exact package is already anchored (e.g. a prior call's
    // on-chain write succeeded but its response was lost), re-calling coSignAnchor
    // would revert "no pending proposal" - short-circuit instead of erroring on a
    // legitimate retry.
    const existing = await verifyOnChain(recordIdBytes32, contentHash);
    if (existing.anchored && existing.matches) {
      return res.json({ recordId: record.id, contentHash, anchored: true, timestamp: existing.timestamp, alreadyAnchored: true });
    }

    const result = await coSignAnchorOnChain(recordIdBytes32, contentHash, findingHashes);
    res.json({ recordId: record.id, contentHash, txHash: result.txHash, timestamp: result.timestamp, alreadyAnchored: false });
  })
);
