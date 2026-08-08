// Only the QA attestor's key lives here - the Auditor's key lives in the separate
// audit-service process (see chain/anchorRegistry.ts), so no single process holds
// both keys required to anchor anything (see AnchorRegistry.proposeAnchor/coSignAnchor).
const REQUIRED = [
  "DATABASE_URL",
  "JWT_SECRET",
  "RPC_URL",
  "CONTRACT_ADDRESS",
  "QA_ATTESTOR_PRIVATE_KEY",
] as const;

export function assertEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}
