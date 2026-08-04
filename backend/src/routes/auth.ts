import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { comparePassword } from "../auth/password";
import { signToken } from "../auth/jwt";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().min(1, "email is required"),
  password: z.string().min(1, "password is required"),
});

const TOKEN_COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function setTokenCookie(res: import("express").Response, token: string) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TOKEN_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

authRouter.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await comparePassword(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
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
  res.clearCookie("token", { path: "/" });
  res.status(204).end();
});

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  })
);
