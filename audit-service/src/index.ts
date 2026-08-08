import dotenv from "dotenv";
dotenv.config();

import { assertEnv, logAnomalyConfig } from "./env";
assertEnv();
logAnomalyConfig();

import { app } from "./app";

const PORT = process.env.PORT || 4100;

app.listen(PORT, () => {
  console.log(`Audit attestation service listening on http://localhost:${PORT}`);
});
