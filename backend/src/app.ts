import express from "express";
import cors from "cors";

import { recordsRouter } from "./routes/records";
import { publicRouter } from "./routes/public";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { batchesRouter } from "./routes/batches";
import { equipmentRouter } from "./routes/equipment";
import { analyticsRouter } from "./routes/analytics";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "pharma-integrity-backend" });
});

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/batches", batchesRouter);
app.use("/equipment", equipmentRouter);
app.use("/records", recordsRouter);
app.use("/public", publicRouter);
app.use("/analytics", analyticsRouter);

app.use(errorHandler);
