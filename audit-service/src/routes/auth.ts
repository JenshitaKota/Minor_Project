import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { comparePassword } from "../auth/password";
import { signToken } from "../auth/jwt";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole, AUDIT_TOKEN_COOKIE } from "../middleware/auth";
import { validate } from "../middleware/validate";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().min(1, "email is required"),
  password: z.string().min(1, "password is required"),
});

const TOKEN_COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function setTokenCookie(res: import("express").Response, token: string) {
  res.cookie(AUDIT_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TOKEN_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

/** Independently verifies the submitted password against the bcrypt hash read
 * (read-only) from the User table - not derived from, or trusting, anything the main
 * backend's own /auth/login already decided. Rejects any role that isn't AUDITOR or
 * ADMIN outright: this service's only purpose is co-signing, so there is no reason for
 * it to ever authenticate an Operator or QA Manager. */
authRouter.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await comparePassword(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (user.role !== "AUDITOR" && user.role !== "ADMIN") {
      return res.status(403).json({ error: "Only Auditor and Admin accounts may use the audit service" });
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    setTokenCookie(res, token);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  })
);

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(AUDIT_TOKEN_COOKIE, { path: "/" });
  res.status(204).end();
});

authRouter.get(
  "/me",
  authenticate,
  requireRole("AUDITOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  })
);
