// Deliberately its own list, not shared with the backend's - this service must be
// independently operable (own DB role, own JWT secret, own attestor key) rather than
// depending on the backend's environment being correctly configured.
const REQUIRED = [
  "AUDIT_DATABASE_URL",
  "AUDIT_JWT_SECRET",
  "RPC_URL",
  "CONTRACT_ADDRESS",
  "AUDITOR_ATTESTOR_PRIVATE_KEY",
] as const;

export function assertEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}

/** Logs the resolved anomaly-detection thresholds at boot so a config-parity drift
 * against the main backend's values (see .env.example) is visible in the logs rather
 * than surfacing later as a mysterious on-chain hash-mismatch error. */
export function logAnomalyConfig() {
  const keys = [
    "ANOMALY_FAST_APPROVAL_FALLBACK_MS",
    "ANOMALY_MIN_BASELINE_SAMPLE_SIZE",
    "ANOMALY_FAST_APPROVAL_Z_SCORE_THRESHOLD",
    "ANOMALY_BUSINESS_HOUR_START",
    "ANOMALY_BUSINESS_HOUR_END",
  ] as const;
  const resolved = Object.fromEntries(keys.map((k) => [k, process.env[k] ?? "(default)"]));
  console.log("Resolved anomaly thresholds (must match the main backend exactly):", resolved);
}
