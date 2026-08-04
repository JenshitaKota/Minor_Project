import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { evaluateAnomalies } from "../anomaly/rules";

export const batchesRouter = Router();

batchesRouter.use(authenticate);

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const createBatchSchema = z.object({
  batchNumber: z.string().min(1, "batchNumber is required"),
  product: z.string().min(1, "product is required"),
  plannedQuantity: z.coerce.number().positive("plannedQuantity must be a positive number"),
});

batchesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));

    const [batches, total] = await Promise.all([
      prisma.batch.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { records: true } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.batch.count(),
    ]);

    res.json({ items: batches, total, page, pageSize });
  })
);

batchesRouter.post(
  "/",
  requireRole("OPERATOR", "ADMIN"),
  validate(createBatchSchema),
  asyncHandler(async (req, res) => {
    const { batchNumber, product, plannedQuantity } = req.body;

    const batch = await prisma.batch.create({
      data: { batchNumber, product, plannedQuantity },
    });
    res.status(201).json(batch);
  })
);

batchesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const batch = await prisma.batch.findUnique({
      where: { id: req.params.id },
      include: {
        records: {
          orderBy: { createdAt: "asc" },
          include: { equipment: true, events: { orderBy: { createdAt: "asc" } } },
        },
      },
    });
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    res.json({
      ...batch,
      records: batch.records.map((record) => ({ ...record, anomalies: evaluateAnomalies(record) })),
    });
  })
);
