import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { hashRecord, recordIdToBytes32 } from "../chain/hash";
import { anchorOnChain, verifyOnChain, findAnchorTxHash } from "../chain/anchorRegistry";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { evaluateAnomalies } from "../anomaly/rules";

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

/** Anchors a record that's already APPROVED. Safe to call more than once for the same
 * record (e.g. retrying after a prior attempt anchored on-chain but crashed before the
 * database write completed) — see the pre-check below. */
async function performAnchor(recordId: string) {
  const record = await prisma.manufacturingRecord.findUniqueOrThrow({ where: { id: recordId } });

  const snapshot = { stage: record.stage, equipmentId: record.equipmentId, content: record.content };
  const contentHash = hashRecord(record);
  const recordIdBytes32 = recordIdToBytes32(record.id);

  const preCheck = await verifyOnChain(recordIdBytes32, contentHash);

  let txHash: string;
  let timestamp: number;

  if (preCheck.anchored && preCheck.matches) {
    txHash = (await findAnchorTxHash(recordIdBytes32)) ?? "unknown (recovered from prior anchor)";
    timestamp = preCheck.timestamp;
  } else if (preCheck.anchored && !preCheck.matches) {
    throw Object.assign(new Error("This recordId is already anchored on-chain with a different content hash"), {
      statusCode: 409,
    });
  } else {
    const result = await anchorOnChain(recordIdBytes32, contentHash);
    txHash = result.txHash;
    timestamp = result.timestamp;
  }

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

/** QA approval and anchoring happen as one workflow action: a SUBMITTED record goes
 * straight to ANCHORED. If the blockchain write fails, the record is left APPROVED so
 * it's clearly "reviewed, not yet on-chain" and can be retried via /anchor. */
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

    const anchored = await performAnchor(req.params.id);
    res.json(anchored);
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

/** Manual retry for the rare case where approval succeeded but the on-chain write failed
 * (record is left APPROVED, not ANCHORED, so this stays available until it succeeds). */
recordsRouter.post(
  "/:id/anchor",
  requireRole("QA_MANAGER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const record = await prisma.manufacturingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record not found" });
    if (record.status !== "APPROVED") {
      return res.status(409).json({ error: `Cannot anchor a record with status ${record.status}` });
    }

    const updated = await performAnchor(req.params.id);
    res.json(updated);
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
