import { describe, expect, it, afterEach, vi } from "vitest";
import { evaluateAnomalies } from "../src/anomaly/rules";
import type { ReviewerBaseline } from "../src/anomaly/baseline";

const MONDAY_10AM = (minuteOffset = 0) => new Date(2026, 0, 5, 10, minuteOffset, 0);
const SATURDAY_10AM = new Date(2026, 0, 10, 10, 0, 0);

describe("evaluateAnomalies", () => {
  it("flags nothing when the record hasn't been submitted or reviewed yet", () => {
    expect(evaluateAnomalies({ submittedAt: null, reviewedAt: null })).toEqual([]);
  });

  it("flags nothing for a normal-speed, business-hours approval", () => {
    const submittedAt = MONDAY_10AM(0);
    const reviewedAt = MONDAY_10AM(10);
    expect(evaluateAnomalies({ submittedAt, reviewedAt })).toEqual([]);
  });

  it("flags a fast approval (reviewed under a minute after submission)", () => {
    const submittedAt = MONDAY_10AM(0);
    const reviewedAt = new Date(submittedAt.getTime() + 30 * 1000);
    const anomalies = evaluateAnomalies({ submittedAt, reviewedAt });
    expect(anomalies.map((a) => a.id)).toEqual(["fast-approval"]);
  });

  it("does not flag an approval exactly at the 1-minute threshold", () => {
    const submittedAt = MONDAY_10AM(0);
    const reviewedAt = new Date(submittedAt.getTime() + 60 * 1000);
    expect(evaluateAnomalies({ submittedAt, reviewedAt })).toEqual([]);
  });

  it("flags an approval on a weekend", () => {
    const submittedAt = new Date(SATURDAY_10AM.getTime() - 5 * 60 * 1000);
    const anomalies = evaluateAnomalies({ submittedAt, reviewedAt: SATURDAY_10AM });
    expect(anomalies.map((a) => a.id)).toEqual(["off-hours-approval"]);
  });

  it("flags an approval before business hours", () => {
    const reviewedAt = new Date(2026, 0, 5, 6, 0, 0);
    const submittedAt = new Date(reviewedAt.getTime() - 5 * 60 * 1000);
    const anomalies = evaluateAnomalies({ submittedAt, reviewedAt });
    expect(anomalies.map((a) => a.id)).toEqual(["off-hours-approval"]);
  });

  it("flags an approval at/after business hours end (18:00 boundary)", () => {
    const reviewedAt = new Date(2026, 0, 5, 18, 0, 0);
    const submittedAt = new Date(reviewedAt.getTime() - 5 * 60 * 1000);
    const anomalies = evaluateAnomalies({ submittedAt, reviewedAt });
    expect(anomalies.map((a) => a.id)).toEqual(["off-hours-approval"]);
  });

  it("does not flag an approval right at business hours start (08:00 boundary)", () => {
    const reviewedAt = new Date(2026, 0, 5, 8, 0, 0);
    const submittedAt = new Date(reviewedAt.getTime() - 5 * 60 * 1000);
    expect(evaluateAnomalies({ submittedAt, reviewedAt })).toEqual([]);
  });

  it("flags both fast-approval and off-hours-approval together", () => {
    const reviewedAt = SATURDAY_10AM;
    const submittedAt = new Date(reviewedAt.getTime() - 30 * 1000);
    const anomalies = evaluateAnomalies({ submittedAt, reviewedAt });
    expect(anomalies.map((a) => a.id).sort()).toEqual(["fast-approval", "off-hours-approval"]);
  });

  describe("with a reviewer baseline", () => {
    it("ignores the baseline and falls back to the fixed threshold below the minimum sample size", () => {
      const baseline: ReviewerBaseline = { sampleSize: 3, meanMs: 20 * 60 * 1000, stdDevMs: 60 * 1000 };
      const submittedAt = MONDAY_10AM(0);
      // 90s: over the fixed 60s threshold, so not flagged - even though it would be a
      // huge outlier (z well below -1.5) against this reviewer's baseline, if it applied.
      const reviewedAt = new Date(submittedAt.getTime() + 90 * 1000);
      expect(evaluateAnomalies({ submittedAt, reviewedAt }, baseline)).toEqual([]);
    });

    it("flags a review as fast relative to the reviewer's own baseline, even when far slower than the fixed threshold", () => {
      const baseline: ReviewerBaseline = { sampleSize: 10, meanMs: 30 * 60 * 1000, stdDevMs: 2 * 60 * 1000 };
      const submittedAt = MONDAY_10AM(0);
      // 25 minutes: nowhere near the 60s fixed threshold, but z = -2.5 against a reviewer
      // who normally takes ~30 minutes with a tight 2-minute spread.
      const reviewedAt = new Date(submittedAt.getTime() + 25 * 60 * 1000);
      const anomalies = evaluateAnomalies({ submittedAt, reviewedAt }, baseline);
      expect(anomalies.map((a) => a.id)).toEqual(["fast-approval"]);
      expect(anomalies[0].label).toMatch(/this reviewer's own history/);
    });

    it("does not flag a naturally-fast reviewer's typical speed, even when under the fixed threshold", () => {
      const baseline: ReviewerBaseline = { sampleSize: 8, meanMs: 45 * 1000, stdDevMs: 10 * 1000 };
      const submittedAt = MONDAY_10AM(0);
      // 40s would trip the old fixed 60s rule, but z = -0.5 is unremarkable for a
      // reviewer whose average approval takes 45s.
      const reviewedAt = new Date(submittedAt.getTime() + 40 * 1000);
      expect(evaluateAnomalies({ submittedAt, reviewedAt }, baseline)).toEqual([]);
    });

    it("falls back to the fixed threshold when the baseline has zero variance (avoids divide-by-zero)", () => {
      const baseline: ReviewerBaseline = { sampleSize: 10, meanMs: 2 * 60 * 1000, stdDevMs: 0 };
      const submittedAt = MONDAY_10AM(0);

      const fast = evaluateAnomalies({ submittedAt, reviewedAt: new Date(submittedAt.getTime() + 30 * 1000) }, baseline);
      expect(fast.map((a) => a.id)).toEqual(["fast-approval"]);

      const notFast = evaluateAnomalies({ submittedAt, reviewedAt: new Date(submittedAt.getTime() + 90 * 1000) }, baseline);
      expect(notFast).toEqual([]);
    });
  });

  describe("threshold overrides via env vars", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.resetModules();
    });

    it("respects ANOMALY_FAST_APPROVAL_FALLBACK_MS", async () => {
      process.env.ANOMALY_FAST_APPROVAL_FALLBACK_MS = "5000";
      vi.resetModules();
      const { evaluateAnomalies: evaluateWithOverride } = await import("../src/anomaly/rules");

      const submittedAt = MONDAY_10AM(0);
      // 4s: under the overridden 5s threshold (would not trip the default 60s rule's
      // "still fine" case at this duration either way, but specifically proves the
      // override value - not the default - is what's being applied).
      const fast = evaluateWithOverride({ submittedAt, reviewedAt: new Date(submittedAt.getTime() + 4000) });
      expect(fast.map((a) => a.id)).toEqual(["fast-approval"]);

      // 6s: over the overridden 5s threshold, so no longer flagged - even though it's
      // still well under the *default* 60s threshold, proving the default isn't
      // silently still in effect.
      const notFast = evaluateWithOverride({ submittedAt, reviewedAt: new Date(submittedAt.getTime() + 6000) });
      expect(notFast).toEqual([]);
    });

    it("respects ANOMALY_BUSINESS_HOUR_START and ANOMALY_BUSINESS_HOUR_END", async () => {
      process.env.ANOMALY_BUSINESS_HOUR_START = "6";
      process.env.ANOMALY_BUSINESS_HOUR_END = "22";
      vi.resetModules();
      const { evaluateAnomalies: evaluateWithOverride } = await import("../src/anomaly/rules");

      // 7am: off-hours under the default (starts at 8) but within hours under the
      // override (starts at 6).
      const reviewedAt = new Date(2026, 0, 5, 7, 0, 0);
      const submittedAt = new Date(reviewedAt.getTime() - 5 * 60 * 1000);
      expect(evaluateWithOverride({ submittedAt, reviewedAt })).toEqual([]);
    });

    it("falls back to the default when the env var is unset or invalid", async () => {
      process.env.ANOMALY_FAST_APPROVAL_FALLBACK_MS = "not-a-number";
      vi.resetModules();
      const { evaluateAnomalies: evaluateWithInvalidOverride } = await import("../src/anomaly/rules");

      const submittedAt = MONDAY_10AM(0);
      const reviewedAt = new Date(submittedAt.getTime() + 30 * 1000);
      // Still uses the 60s default despite the garbage env value, rather than crashing
      // or silently treating everything as anomalous.
      expect(evaluateWithInvalidOverride({ submittedAt, reviewedAt }).map((a) => a.id)).toEqual(["fast-approval"]);
    });
  });
});
