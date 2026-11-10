import type { PrismaClient } from "../generated/prisma/client";

export interface ReviewerBaseline {
  sampleSize: number;
  meanMs: number;
  stdDevMs: number;
}

export function computeBaseline(durationsMs: number[]): ReviewerBaseline {
  const sampleSize = durationsMs.length;
  if (sampleSize === 0) {
    return { sampleSize: 0, meanMs: 0, stdDevMs: 0 };
  }

  const meanMs = durationsMs.reduce((sum, d) => sum + d, 0) / sampleSize;
  const variance = durationsMs.reduce((sum, d) => sum + (d - meanMs) ** 2, 0) / sampleSize;

  return { sampleSize, meanMs, stdDevMs: Math.sqrt(variance) };
}

/** A reviewer's baseline is built from every review decision (approval or rejection)
 * they made strictly *before* `beforeReviewedAt`. Bounding by time (not just excluding
 * the current record by id) is required, not optional: it makes the baseline for a given
 * decision reproducible forever after - re-deriving it next week must produce the same
 * number it did at approval time, not one drifted by reviews the reviewer completed
 * *after* this decision. Without the time bound, a legitimately anchored finding would
 * later look unverifiable, indistinguishable from tampering.
 *
 * Read from the append-only RecordEvent history, never from the record's own
 * submittedAt/reviewedAt: those are overwritten when a rejected record is revised,
 * resubmitted and reviewed again, which would silently move a past decision out of (or
 * into) another decision's baseline window. Each SUBMITTED/APPROVED/REJECTED event is
 * written with createdAt equal to the record timestamp it accompanies (see
 * routes/records.ts), so the strict `lt` bound excludes the decision being judged.
 * Ordered explicitly so the floating-point mean is summed in the same order every time
 * - the result is hashed, so even last-bit differences would read as a mismatch. */
export async function getReviewerBaseline(
  prisma: PrismaClient,
  reviewerEmail: string,
  beforeReviewedAt: Date
): Promise<ReviewerBaseline> {
  const reviews = await prisma.recordEvent.findMany({
    where: { actor: reviewerEmail, type: { in: ["APPROVED", "REJECTED"] }, createdAt: { lt: beforeReviewedAt } },
    select: { recordId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (reviews.length === 0) return computeBaseline([]);

  const submissions = await prisma.recordEvent.findMany({
    where: { recordId: { in: [...new Set(reviews.map((r) => r.recordId))] }, type: "SUBMITTED" },
    select: { recordId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const durationsMs: number[] = [];
  for (const review of reviews) {
    // The submission this decision was made on: the latest one for the same record
    // at or before the decision.
    let submittedAt: Date | undefined;
    for (const s of submissions) {
      if (s.recordId === review.recordId && s.createdAt <= review.createdAt) submittedAt = s.createdAt;
    }
    if (submittedAt) durationsMs.push(review.createdAt.getTime() - submittedAt.getTime());
  }
  return computeBaseline(durationsMs);
}
