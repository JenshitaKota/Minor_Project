import { describe, expect, it } from "vitest";
import { evaluateAnomalies } from "../src/anomaly/rules";

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
});
