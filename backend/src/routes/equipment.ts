import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";

export const equipmentRouter = Router();

const createEquipmentSchema = z.object({
  code: z.string().min(1, "code is required"),
  name: z.string().min(1, "name is required"),
  type: z.string().min(1, "type is required"),
});

const updateStatusSchema = z.object({
  status: z.enum(["ACTIVE", "MAINTENANCE", "RETIRED"]),
});

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
