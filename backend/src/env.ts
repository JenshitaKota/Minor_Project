const REQUIRED = ["DATABASE_URL", "JWT_SECRET", "RPC_URL", "CONTRACT_ADDRESS", "ANCHOR_SIGNER_PRIVATE_KEY"] as const;

export function assertEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}
