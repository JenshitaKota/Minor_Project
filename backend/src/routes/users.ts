import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { hashPassword } from "../auth/password";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";

export const usersRouter = Router();

const createUserSchema = z.object({
  email: z.email("must be a valid email"),
  password: z.string().min(1, "password is required"),
  name: z.string().min(1, "name is required"),
  role: z.enum(["ADMIN", "OPERATOR", "QA_MANAGER", "AUDITOR"]),
});

usersRouter.use(authenticate, requireRole("ADMIN"));

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(users);
  })
);

usersRouter.post(
  "/",
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const { email, password, name, role } = req.body;

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    res.status(201).json(user);
  })
);
