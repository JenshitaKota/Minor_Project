import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { recordsRouter } from "./routes/records";
import { publicRouter } from "./routes/public";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { batchesRouter } from "./routes/batches";
import { equipmentRouter } from "./routes/equipment";
import { analyticsRouter } from "./routes/analytics";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

const corsOrigin = process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim());

app.use(helmet());
// credentials: true (for the httpOnly auth cookie) forbids a wildcard origin, so with no
// CORS_ORIGIN configured we reflect the request's own Origin back rather than using '*'.
app.use(cors({ origin: corsOrigin ?? true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "pharma-integrity-backend" });
});

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
app.use("/users", usersRouter);
app.use("/batches", batchesRouter);
app.use("/equipment", equipmentRouter);
app.use("/records", recordsRouter);
app.use("/public", publicRouter);
app.use("/analytics", analyticsRouter);

app.use(errorHandler);
