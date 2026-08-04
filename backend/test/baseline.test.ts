import { describe, it, expect } from "vitest";
import { computeBaseline } from "../src/anomaly/baseline";

describe("computeBaseline", () => {
  it("returns a zeroed baseline for an empty sample", () => {
    expect(computeBaseline([])).toEqual({ sampleSize: 0, meanMs: 0, stdDevMs: 0 });
  });

  it("has zero stddev for a single sample", () => {
    const baseline = computeBaseline([5000]);
    expect(baseline).toEqual({ sampleSize: 1, meanMs: 5000, stdDevMs: 0 });
  });

  it("has zero stddev when every sample is identical", () => {
    const baseline = computeBaseline([3000, 3000, 3000]);
    expect(baseline.meanMs).toBe(3000);
    expect(baseline.stdDevMs).toBe(0);
  });

  it("computes mean and population stddev correctly for a known set", () => {
    const baseline = computeBaseline([1000, 2000, 3000]);
    expect(baseline.sampleSize).toBe(3);
    expect(baseline.meanMs).toBeCloseTo(2000, 5);
    expect(baseline.stdDevMs).toBeCloseTo(816.4966, 3);
  });
});
