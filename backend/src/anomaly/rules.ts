import type { ReviewerBaseline } from "./baseline";

export interface Anomaly {
  id: string;
  label: string;
}

interface AnomalyInput {
  submittedAt: Date | null;
  reviewedAt: Date | null;
}

// A genuine GMP review means actually reading the record - anything faster than this
// reads as a rubber-stamp rather than a real review. Used until a reviewer has enough
// history to be judged against their own baseline instead (see isFastApproval below).
const FAST_APPROVAL_FALLBACK_THRESHOLD_MS = 60 * 1000;

// Below this many past reviews, a reviewer's mean/stddev is too noisy to baseline
// against, so we fall back to the fixed threshold.
const MIN_BASELINE_SAMPLE_SIZE = 5;

// How many standard deviations below a reviewer's own average approval time counts as
// "unusually fast for them" - e.g. someone who normally takes 20 minutes suddenly
// deciding in 90 seconds, even though 90 seconds might be unremarkable for someone else.
const FAST_APPROVAL_Z_SCORE_THRESHOLD = -1.5;

const BUSINESS_HOUR_START = 8;
const BUSINESS_HOUR_END = 18;

function isFastApproval({ submittedAt, reviewedAt }: AnomalyInput, baseline?: ReviewerBaseline): boolean {
  if (!submittedAt || !reviewedAt) return false;
  const durationMs = reviewedAt.getTime() - submittedAt.getTime();

  if (baseline && baseline.sampleSize >= MIN_BASELINE_SAMPLE_SIZE && baseline.stdDevMs > 0) {
    const zScore = (durationMs - baseline.meanMs) / baseline.stdDevMs;
    return zScore <= FAST_APPROVAL_Z_SCORE_THRESHOLD;
  }

  return durationMs < FAST_APPROVAL_FALLBACK_THRESHOLD_MS;
}

// Off-hours review is a fixed GMP/compliance boundary (was this reviewed during
// supervised business hours), not a personal habit - deliberately not baselined per
// reviewer the way fast-approval is.
function isOffHoursApproval({ reviewedAt }: AnomalyInput): boolean {
  if (!reviewedAt) return false;
  const day = reviewedAt.getDay();
  const hour = reviewedAt.getHours();
  const isWeekend = day === 0 || day === 6;
  const isOutsideBusinessHours = hour < BUSINESS_HOUR_START || hour >= BUSINESS_HOUR_END;
  return isWeekend || isOutsideBusinessHours;
}

export function evaluateAnomalies(input: AnomalyInput, baseline?: ReviewerBaseline): Anomaly[] {
  const anomalies: Anomaly[] = [];

  if (isFastApproval(input, baseline)) {
    anomalies.push({
      id: "fast-approval",
      label:
        baseline && baseline.sampleSize >= MIN_BASELINE_SAMPLE_SIZE
          ? "Approved unusually fast for this reviewer's own history"
          : "Approved unusually fast (< 1 minute after submission)",
    });
  }

  if (isOffHoursApproval(input)) {
    anomalies.push({ id: "off-hours-approval", label: "Approved outside normal business hours" });
  }

  return anomalies;
}
