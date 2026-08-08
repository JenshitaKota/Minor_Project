import fs from "fs";
import path from "path";

process.env.NODE_ENV = "test";

const runtimeConfigPath = path.join(__dirname, "runtime.json");
const config = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf-8"));

for (const [key, value] of Object.entries(config)) {
  process.env[key] = value as string;
}
