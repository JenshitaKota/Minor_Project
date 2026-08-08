import { keccak256, toUtf8Bytes } from "ethers";

/** Deep-sorts object keys so semantically identical content always serializes identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function hashContent(content: unknown): string {
  const canonicalJson = JSON.stringify(canonicalize(content));
  return keccak256(toUtf8Bytes(canonicalJson));
}

export interface HashableRecord {
  stage: string;
  equipmentId: string | null;
  content: unknown;
}

/** Everything that counts as "the record" for tamper-detection purposes: which stage,
 * which equipment, and its free-form content. Anchoring only content would let someone
 * silently swap the equipment used without it ever being caught. */
export function hashRecord(record: HashableRecord): string {
  return hashContent({ stage: record.stage, equipmentId: record.equipmentId, content: record.content });
}

export function recordIdToBytes32(recordId: string): string {
  return keccak256(toUtf8Bytes(recordId));
}

export interface HashableAnomalyFinding {
  recordId: string;
  anomalyId: string;
  reviewerEmail: string;
  submittedAt: string;
  reviewedAt: string;
  durationMs: number;
  baseline: { sampleSize: number; meanMs: number; stdDevMs: number } | null;
}

/** Everything that makes an anomaly finding independently reproducible: which record,
 * which rule fired, who reviewed it, when, how long it took, and what baseline (if any)
 * that verdict was judged against. Anchoring this hash - not just the anomaly id - means
 * the specific reasoning behind the flag is tamper-evident too, not only its existence. */
export function hashAnomalyFinding(finding: HashableAnomalyFinding): string {
  return hashContent(finding);
}
