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

/** A reviewer's baseline is built from every record they reviewed strictly *before*
 * `beforeReviewedAt`. Bounding by time (not just excluding the current record by id) is
 * required, not optional: reviews are immutable once made, so this makes the baseline
 * for a given decision reproducible forever after - re-deriving it next week must
 * produce the same number it did at approval time, not one drifted by reviews the
 * reviewer completed *after* this decision. Without the time bound, a legitimately
 * anchored finding would later look unverifiable, indistinguishable from tampering. */
export async function getReviewerBaseline(
  prisma: PrismaClient,
  reviewerEmail: string,
  beforeReviewedAt: Date
): Promise<ReviewerBaseline> {
  const pastReviews = await prisma.manufacturingRecord.findMany({
    where: {
      reviewedBy: reviewerEmail,
      submittedAt: { not: null },
      reviewedAt: { not: null, lt: beforeReviewedAt },
    },
    select: { submittedAt: true, reviewedAt: true },
  });

  const durationsMs = pastReviews.map((r) => r.reviewedAt!.getTime() - r.submittedAt!.getTime());
  return computeBaseline(durationsMs);
}
