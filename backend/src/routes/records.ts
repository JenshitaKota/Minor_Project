import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../db/client";
import { hashRecord, hashAnomalyFinding, recordIdToBytes32, type HashableAnomalyFinding } from "../chain/hash";
import {
  verifyOnChain,
  findAnchorTxHash,
  proposeAnchorOnChain,
  coSignAnchorOnChain,
  getPendingAnchorOnChain,
  getAnomalyFindingsOnChain,
} from "../chain/anchorRegistry";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { evaluateAnomalies, type Anomaly } from "../anomaly/rules";
import { getReviewerBaseline, type ReviewerBaseline } from "../anomaly/baseline";

export const recordsRouter = Router();

const withRelations = { batch: true, equipment: true } as const;

const contentSchema = z.record(z.string(), z.union([z.string(), z.number()]));

const createRecordSchema = z.object({
  batchId: z.string().min(1, "batchId is required"),
  stage: z.string().min(1, "stage is required"),
  equipmentId: z.string().nullish(),
  content: contentSchema,
});

const editRecordSchema = z.object({
  content: contentSchema,
  equipmentId: z.string().nullish(),
});

const rejectSchema = z.object({
  reason: z.string().min(1, "reason is required"),
});

function withAnomalies<T extends { submittedAt: Date | null; reviewedAt: Date | null }>(record: T) {
  return { ...record, anomalies: evaluateAnomalies(record) };
}

interface AnchorableRecord {
  id: string;
  stage: string;
  equipmentId: string | null;
  content: Prisma.JsonValue;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
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

/** The content hash and any anomaly-finding hashes for a reviewed record, computed
 * deterministically so propose and co-sign independently arrive at the identical
 * package (the record itself can't change between them - PATCH blocks edits while
 * APPROVED - and the reviewer baseline is time-bounded to stay reproducible). */
async function computeAnchorPackage(record: AnchorableRecord) {
  const snapshot = { stage: record.stage, equipmentId: record.equipmentId, content: record.content };
  const contentHash = hashRecord(record);

  let findingHashes: string[] = [];
  if (record.reviewedBy && record.submittedAt && record.reviewedAt) {
    const baseline = await getReviewerBaseline(prisma, record.reviewedBy, record.reviewedAt);
    const anomalies = evaluateAnomalies(record, baseline);
    findingHashes = anomalies.map((a) => hashAnomalyFinding(buildAnomalyFinding(record, a, baseline)));
  }

  return { contentHash, snapshot, findingHashes };
}

/** Persists a chain-write failure as a durable, queryable RecordEvent instead of
 * letting it vanish into a transient console.error (the errorHandler middleware still
 * logs it too) - so a failed anchor attempt is visible in the record's own timeline
 * to anyone looking, not only to someone watching server logs at the exact moment it
 * happened. Swallows its own failure (falls back to console) rather than letting a
 * logging problem mask the original error. */
async function recordAnchorFailure(record: AnchorableRecord, step: "propose" | "co-sign", err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.recordEvent
    .create({
      data: {
        recordId: record.id,
        stage: record.stage,
        type: "ANCHOR_FAILED",
        detail: `Failed to ${step} anchor: ${message.slice(0, 500)}`,
      },
    })
    .catch((loggingErr) => {
      console.error(`Failed to record ANCHOR_FAILED event for record ${record.id}:`, loggingErr);
    });
}

/** Recovers a record whose co-sign actually succeeded on-chain but crashed before the
 * DB write landed - syncs straight to ANCHORED instead of re-proposing (which would
 * revert - the record is already anchored). */
async function syncAnchoredFromChain(record: AnchorableRecord, timestamp: number) {
  const recordIdBytes32 = recordIdToBytes32(record.id);
  const { contentHash, snapshot } = await computeAnchorPackage(record);
  const txHash = (await findAnchorTxHash(recordIdBytes32)) ?? "unknown (recovered from prior anchor)";

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.manufacturingRecord.update({
      where: { id: record.id },
      data: {
        status: "ANCHORED",
        contentHash,
        anchoredSnapshot: snapshot,
        anchoredTxHash: txHash,
        anchoredAt: new Date(timestamp * 1000),
      },
      include: withRelations,
    });
    await tx.recordEvent.create({
      data: { recordId: record.id, stage: record.stage, type: "ANCHORED", detail: txHash },
    });
    return updated;
  });

  return withAnomalies(updated);
}

/** Proposes anchoring a just-approved record's content hash, plus any anomaly
 * findings detected at review time, as one package. This does not anchor anything by
 * itself - a *different*, independent Auditor must separately co-sign (see
 * coSignAnchor below) before it becomes permanent; see AnchorRegistry.proposeAnchor.
 * Safe to call more than once for the same record (e.g. retrying after a crash before
 * the DB write landed). */
async function proposeAnchor(recordId: string) {
  const record = await prisma.manufacturingRecord.findUniqueOrThrow({ where: { id: recordId } });
  const recordIdBytes32 = recordIdToBytes32(record.id);

  // Everything from here on touches the chain (even the read calls can fail if the RPC
  // endpoint is unreachable) - wrapping the whole sequence, not just the write, so a
  // failure at any point still gets durably logged rather than only the write failures.
  try {
    const { anchored, matches, timestamp } = await verifyOnChain(recordIdBytes32, hashRecord(record));
    if (anchored && matches) {
      return await syncAnchoredFromChain(record, timestamp);
    }

    const pending = await getPendingAnchorOnChain(recordIdBytes32);
    let proposedAt: number;
    if (pending.proposedAt !== 0) {
      // Already proposed on-chain (e.g. a crash before this DB write landed last time) -
      // re-proposing would revert, so just sync the DB state instead.
      proposedAt = pending.proposedAt;
    } else {
      const { contentHash, findingHashes } = await computeAnchorPackage(record);
      const result = await proposeAnchorOnChain(recordIdBytes32, contentHash, findingHashes);
      proposedAt = result.timestamp;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.manufacturingRecord.update({
        where: { id: record.id },
        data: { anchorProposedAt: new Date(proposedAt * 1000), anchorProposedBy: record.reviewedBy },
        include: withRelations,
      });
      await tx.recordEvent.create({
        data: { recordId: record.id, stage: record.stage, type: "ANCHOR_PROPOSED", actor: record.reviewedBy },
      });
      return updated;
    });

    return withAnomalies(updated);
  } catch (err) {
    await recordAnchorFailure(record, "propose", err);
    throw err;
  }
}

/** Independently confirms a pending anchor proposal, finalizing it on-chain (the
 * content hash and every bundled anomaly finding, atomically) and updating the record
 * to ANCHORED. The caller must not be the same person who proposed it - checked here
 * for a clear error message, and enforced again on-chain regardless (the real
 * guarantee: coSignAnchor reverts if called by the same *attestor address* that
 * proposed).
 *
 * Honest scope note: this reference deployment holds both attestor private keys
 * (QA_ATTESTOR_PRIVATE_KEY, AUDITOR_ATTESTOR_PRIVATE_KEY) in the same backend process,
 * so the on-chain guarantee here is "two distinct signatures required," not yet "two
 * independently-operated systems required" - a fully compromised backend still holds
 * both keys. A production deployment would have the Auditor's key held and operated
 * by a separate system, ideally gated by that Auditor's own authentication rather
 * than this backend's. */
async function coSignAnchor(record: AnchorableRecord, coSignedBy: string) {
  const recordIdBytes32 = recordIdToBytes32(record.id);

  try {
    const { contentHash, snapshot, findingHashes } = await computeAnchorPackage(record);
    const result = await coSignAnchorOnChain(recordIdBytes32, contentHash, findingHashes);

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.manufacturingRecord.update({
        where: { id: record.id },
        data: {
          status: "ANCHORED",
          contentHash,
          anchoredSnapshot: snapshot,
          anchoredTxHash: result.txHash,
          anchoredAt: new Date(result.timestamp * 1000),
          anchorCoSignedBy: coSignedBy,
        },
        include: withRelations,
      });
      await tx.recordEvent.create({
        data: { recordId: record.id, stage: record.stage, type: "ANCHORED", actor: coSignedBy, detail: result.txHash },
      });
      return updated;
    });

    return withAnomalies(updated);
  } catch (err) {
    await recordAnchorFailure(record, "co-sign", err);
    throw err;
  }
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

recordsRouter.use(authenticate);

recordsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));

    const [records, total] = await Promise.all([
      prisma.manufacturingRecord.findMany({
        orderBy: { createdAt: "desc" },
        include: withRelations,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.manufacturingRecord.count(),
    ]);

    res.json({ items: records.map(withAnomalies), total, page, pageSize });
  })
);

/** Records proposed for anchoring but not yet independently co-signed - nothing
 * today tells an Auditor something is waiting on them otherwise, they'd have to go
 * looking. Excludes records the caller themself proposed, since they can't co-sign
 * their own proposal anyway (see coSignAnchor's same-person check). Registered
 * before GET /:id so "pending-cosign" isn't swallowed as a record id. */
recordsRouter.get(
  "/pending-cosign",
  asyncHandler(async (req, res) => {
    const records = await prisma.manufacturingRecord.findMany({
      where: {
        status: "APPROVED",
        anchorProposedAt: { not: null },
        anchoredAt: null,
        anchorProposedBy: { not: req.user!.email },
      },
      orderBy: { anchorProposedAt: "asc" },
      include: withRelations,
    });

    res.json({ count: records.length, items: records.map(withAnomalies) });
  })
);

recordsRouter.post(
  "/",
  requireRole("OPERATOR", "ADMIN"),
  validate(createRecordSchema),
  asyncHandler(async (req, res) => {
    const { batchId, stage, equipmentId, content } = req.body;

    if (equipmentId) {
      const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
      if (!equipment) return res.status(400).json({ error: "Unknown equipmentId" });
      if (equipment.status !== "ACTIVE") {
        return res.status(409).json({ error: `Equipment ${equipment.code} is not ACTIVE (currently ${equipment.status})` });
      }
    }

    const record = await prisma.$transaction(async (tx) => {
      const record = await tx.manufacturingRecord.create({
        data: { batchId, stage, equipmentId: equipmentId ?? null, content },
        include: withRelations,
      });
      await tx.recordEvent.create({
        data: { recordId: record.id, stage, type: "CREATED", actor: req.user!.email },
      });
      return record;
    });
    res.status(201).json(withAnomalies(record));
  })
);

recordsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({
      where: { id: req.params.id },
      include: withRelations,
    });
    if (!record) return res.status(404).json({ error: "Record not found" });
    res.json(withAnomalies(record));
  })
);

recordsRouter.get(
  "/:id/events",
  asyncHandler(async (req, res) => {
    const events = await prisma.recordEvent.findMany({
      where: { recordId: req.params.id },
      orderBy: { createdAt: "asc" },
    });
    res.json(events);
  })
);

/** Only editable while DRAFT or REJECTED — a SUBMITTED record is locked so QA reviews
 * exactly what was submitted. Editing a REJECTED record moves it back to DRAFT, since
 * the operator is now addressing the rejection. */
recordsRouter.patch(
  "/:id",
  requireRole("OPERATOR", "ADMIN"),
  validate(editRecordSchema),
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record not found" });
    if (record.status === "SUBMITTED" || record.status === "APPROVED") {
      return res.status(409).json({ error: `Cannot edit a record with status ${record.status}` });
    }

    const { content, equipmentId } = req.body;

    // ANCHORED stays ANCHORED - a direct DB edit after anchoring doesn't announce itself
    // by resetting the workflow status; that's exactly the scenario this platform exists
    // to catch, and it's caught by re-verifying against the unchanged on-chain hash.
    const statusUpdate =
      record.status === "ANCHORED" ? {} : { status: "DRAFT" as const, rejectionReason: null };
    const eventType =
      record.status === "ANCHORED" ? "MODIFIED_AFTER_ANCHOR" : record.status === "REJECTED" ? "REVISED" : "EDITED";

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.manufacturingRecord.update({
        where: { id: req.params.id },
        data: {
          content,
          equipmentId: equipmentId ?? record.equipmentId,
          ...statusUpdate,
        },
        include: withRelations,
      });
      await tx.recordEvent.create({
        data: { recordId: record.id, stage: record.stage, type: eventType, actor: req.user!.email },
      });
      return updated;
    });
    res.json(withAnomalies(updated));
  })
);

recordsRouter.post(
  "/:id/submit",
  requireRole("OPERATOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record not found" });
    if (record.status !== "DRAFT") {
      return res.status(409).json({ error: `Cannot submit a record with status ${record.status}` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.manufacturingRecord.update({
        where: { id: req.params.id },
        data: { status: "SUBMITTED", submittedAt: new Date() },
        include: withRelations,
      });
      await tx.recordEvent.create({
        data: { recordId: record.id, stage: record.stage, type: "SUBMITTED", actor: req.user!.email },
      });
      return updated;
    });
    res.json(withAnomalies(updated));
  })
);

/** QA approval proposes an anchor - it does not finalize one. A SUBMITTED record
 * moves to APPROVED and its content hash (plus any anomaly findings) are proposed
 * on-chain; the record only reaches ANCHORED once a *different*, independent Auditor
 * co-signs via /anchor-cosign. If the on-chain propose fails, the record is left
 * APPROVED with no pending proposal and can be retried via /anchor. */
recordsRouter.post(
  "/:id/approve",
  requireRole("QA_MANAGER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record not found" });
    if (record.status !== "SUBMITTED") {
      return res.status(409).json({ error: `Cannot approve a record with status ${record.status}` });
    }

    await prisma.$transaction(async (tx) => {
      await tx.manufacturingRecord.update({
        where: { id: req.params.id },
        data: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: req.user!.email, rejectionReason: null },
      });
      await tx.recordEvent.create({
        data: { recordId: record.id, stage: record.stage, type: "APPROVED", actor: req.user!.email },
      });
    });

    const proposed = await proposeAnchor(req.params.id);
    res.json(proposed);
  })
);

recordsRouter.post(
  "/:id/reject",
  requireRole("QA_MANAGER", "ADMIN"),
  validate(rejectSchema),
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record not found" });
    if (record.status !== "SUBMITTED") {
      return res.status(409).json({ error: `Cannot reject a record with status ${record.status}` });
    }

    const { reason } = req.body;

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.manufacturingRecord.update({
        where: { id: req.params.id },
        data: { status: "REJECTED", reviewedAt: new Date(), reviewedBy: req.user!.email, rejectionReason: reason },
        include: withRelations,
      });
      await tx.recordEvent.create({
        data: { recordId: record.id, stage: record.stage, type: "REJECTED", actor: req.user!.email, detail: reason },
      });
      return updated;
    });
    res.json(withAnomalies(updated));
  })
);

/** Manual retry for the rare case where approval succeeded but the on-chain propose
 * failed (record is left APPROVED with no pending proposal). This only re-proposes -
 * finalizing still requires a separate, independent Auditor co-signature. */
recordsRouter.post(
  "/:id/anchor",
  requireRole("QA_MANAGER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record not found" });
    if (record.status !== "APPROVED") {
      return res.status(409).json({ error: `Cannot propose an anchor for a record with status ${record.status}` });
    }
    if (record.anchorProposedAt) {
      return res.status(409).json({ error: "Anchor already proposed - awaiting an independent Auditor co-signature" });
    }

    const updated = await proposeAnchor(req.params.id);
    res.json(updated);
  })
);

/** Independently confirms a pending anchor proposal. Must be a different person than
 * whoever proposed it (see coSignAnchor above for why - checked here for a clear
 * error, enforced again on-chain as the real guarantee). */
recordsRouter.post(
  "/:id/anchor-cosign",
  requireRole("AUDITOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record not found" });
    if (record.status !== "APPROVED" || !record.anchorProposedAt) {
      return res.status(409).json({ error: "No pending anchor proposal for this record" });
    }
    if (req.user!.email === record.anchorProposedBy) {
      return res.status(403).json({ error: "You proposed this anchor - a different reviewer must independently co-sign it" });
    }

    const updated = await coSignAnchor(record, req.user!.email);
    res.json(updated);
  })
);

/** Recomputes anomaly findings for a reviewed record (the reviewer's baseline is
 * reproducible - see getReviewerBaseline) and cross-references each against what's
 * anchored on-chain, so the UI can show not just "this was flagged" but "and that flag
 * has been independently verifiable on-chain since <timestamp>". */
recordsRouter.get(
  "/:id/anomaly-findings",
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record not found" });

    if (!record.reviewedBy || !record.submittedAt || !record.reviewedAt) {
      return res.json({ recordId: record.id, findings: [] });
    }

    const baseline = await getReviewerBaseline(prisma, record.reviewedBy, record.reviewedAt);
    const anomalies = evaluateAnomalies(record, baseline);

    const recordIdBytes32 = recordIdToBytes32(record.id);
    const onChainFindings = await getAnomalyFindingsOnChain(recordIdBytes32);

    const findings = anomalies.map((anomaly) => {
      const findingHash = hashAnomalyFinding(buildAnomalyFinding(record, anomaly, baseline));
      const onChain = onChainFindings.find((f) => f.findingHash === findingHash);
      return {
        id: anomaly.id,
        label: anomaly.label,
        anchored: Boolean(onChain),
        anchoredAt: onChain ? new Date(onChain.timestamp * 1000) : null,
      };
    });

    res.json({ recordId: record.id, findings });
  })
);

recordsRouter.get(
  "/:id/verify",
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record not found" });

    if (record.status !== "ANCHORED" || !record.contentHash) {
      return res.status(409).json({ error: "Record has not been anchored yet" });
    }

    const currentHash = hashRecord(record);
    const recordIdBytes32 = recordIdToBytes32(record.id);

    const { anchored, matches, timestamp } = await verifyOnChain(recordIdBytes32, currentHash);

    res.json({
      recordId: record.id,
      anchored,
      matches,
      anchoredAt: new Date(timestamp * 1000),
      anchoredHash: record.contentHash,
      currentHash,
      anchoredSnapshot: record.anchoredSnapshot,
      currentSnapshot: { stage: record.stage, equipmentId: record.equipmentId, content: record.content },
    });
  })
);
