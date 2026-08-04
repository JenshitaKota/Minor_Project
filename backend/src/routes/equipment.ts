import { Router } from "express";
import { prisma } from "../db/client";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";

export const equipmentRouter = Router();

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
  asyncHandler(async (req, res) => {
    const { code, name, type } = req.body;
    if (!code || !name || !type) {
      return res.status(400).json({ error: "code, name and type are required" });
    }

    const equipment = await prisma.equipment.create({ data: { code, name, type } });
    res.status(201).json(equipment);
  })
);

equipmentRouter.patch(
  "/:id/status",
  requireRole("OPERATOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!["ACTIVE", "MAINTENANCE", "RETIRED"].includes(status)) {
      return res.status(400).json({ error: "status must be ACTIVE, MAINTENANCE or RETIRED" });
    }

    const equipment = await prisma.equipment.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(equipment);
  })
);
