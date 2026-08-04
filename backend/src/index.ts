import dotenv from "dotenv";
dotenv.config();

import { assertEnv } from "./env";
assertEnv();

import { app } from "./app";

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
