import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { authRouter } from "./routes/auth";
import { recordsRouter } from "./routes/records";
import { equipmentRouter } from "./routes/equipment";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

const corsOrigin = process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim());

app.use(helmet());
app.use(cors({ origin: corsOrigin ?? true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "pharma-integrity-audit-service" });
});

// This service is now an independently reachable, password-checking endpoint - same
// rate-limit posture as the main backend's /auth/login.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Too many login attempts, please try again later" },
});
app.use("/auth/login", loginLimiter);

app.use("/auth", authRouter);
app.use("/records", recordsRouter);
app.use("/equipment", equipmentRouter);

app.use(errorHandler);
