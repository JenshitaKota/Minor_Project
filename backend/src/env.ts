// Two distinct attestor keys, not one - anchoring requires both a proposer and an
// independent co-signer (see chain/anchorRegistry.ts), so no single key can anchor
// anything alone.
const REQUIRED = [
  "DATABASE_URL",
  "JWT_SECRET",
  "RPC_URL",
  "CONTRACT_ADDRESS",
  "QA_ATTESTOR_PRIVATE_KEY",
  "AUDITOR_ATTESTOR_PRIVATE_KEY",
] as const;

export function assertEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}
