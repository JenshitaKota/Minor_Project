export interface Anomaly {
  id: string;
  label: string;
}

interface AnomalyInput {
  submittedAt: Date | null;
  reviewedAt: Date | null;
}

// A genuine GMP review means actually reading the record - anything faster than this
// reads as a rubber-stamp rather than a real review.
const FAST_APPROVAL_THRESHOLD_MS = 60 * 1000;

const BUSINESS_HOUR_START = 8;
const BUSINESS_HOUR_END = 18;

function isFastApproval({ submittedAt, reviewedAt }: AnomalyInput): boolean {
  if (!submittedAt || !reviewedAt) return false;
  return reviewedAt.getTime() - submittedAt.getTime() < FAST_APPROVAL_THRESHOLD_MS;
}

function isOffHoursApproval({ reviewedAt }: AnomalyInput): boolean {
  if (!reviewedAt) return false;
  const day = reviewedAt.getDay();
  const hour = reviewedAt.getHours();
  const isWeekend = day === 0 || day === 6;
  const isOutsideBusinessHours = hour < BUSINESS_HOUR_START || hour >= BUSINESS_HOUR_END;
  return isWeekend || isOutsideBusinessHours;
}

export function evaluateAnomalies(input: AnomalyInput): Anomaly[] {
  const anomalies: Anomaly[] = [];

  if (isFastApproval(input)) {
    anomalies.push({ id: "fast-approval", label: "Approved unusually fast (< 1 minute after submission)" });
  }

  if (isOffHoursApproval(input)) {
    anomalies.push({ id: "off-hours-approval", label: "Approved outside normal business hours" });
  }

  return anomalies;
}
