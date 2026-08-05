import { describe, it, expect } from "vitest";
import { buildBatchTimeline } from "./timeline";
import type { ManufacturingRecord, RecordEvent } from "../types";

function makeEvent(overrides: Partial<RecordEvent>): RecordEvent {
  return {
    id: "evt-1",
    recordId: "rec-1",
    stage: "Mixing",
    type: "CREATED",
    actor: null,
    detail: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRecord(events: RecordEvent[]): ManufacturingRecord {
  return {
    id: "rec-1",
    batchId: "batch-1",
    equipmentId: null,
    stage: "Mixing",
    content: {},
    status: "DRAFT",
    contentHash: null,
    anchoredSnapshot: null,
    anchoredTxHash: null,
    anchoredAt: null,
    anchorProposedAt: null,
    anchorProposedBy: null,
    anchorCoSignedBy: null,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    anomalies: [],
    events,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildBatchTimeline", () => {
  it("sorts events chronologically across multiple records", () => {
    const recordA = makeRecord([
      makeEvent({ id: "a1", recordId: "a", type: "CREATED", createdAt: "2026-01-01T10:00:00.000Z" }),
      makeEvent({ id: "a2", recordId: "a", type: "ANCHORED", createdAt: "2026-01-01T12:00:00.000Z" }),
    ]);
    const recordB = makeRecord([
      makeEvent({ id: "b1", recordId: "b", type: "CREATED", createdAt: "2026-01-01T11:00:00.000Z" }),
    ]);

    const timeline = buildBatchTimeline([recordA, recordB]);

    expect(timeline.map((e) => e.time)).toEqual([
      "2026-01-01T10:00:00.000Z",
      "2026-01-01T11:00:00.000Z",
      "2026-01-01T12:00:00.000Z",
    ]);
  });

  it("preserves every step through reject -> revise -> resubmit -> approve", () => {
    const record = makeRecord([
      makeEvent({ type: "CREATED", createdAt: "2026-01-01T09:00:00.000Z" }),
      makeEvent({ type: "SUBMITTED", createdAt: "2026-01-01T09:05:00.000Z" }),
      makeEvent({ type: "REJECTED", createdAt: "2026-01-01T09:10:00.000Z", detail: "needs recheck" }),
      makeEvent({ type: "REVISED", createdAt: "2026-01-01T09:15:00.000Z" }),
      makeEvent({ type: "SUBMITTED", createdAt: "2026-01-01T09:20:00.000Z" }),
      makeEvent({ type: "APPROVED", createdAt: "2026-01-01T09:25:00.000Z" }),
      makeEvent({ type: "ANCHORED", createdAt: "2026-01-01T09:26:00.000Z" }),
    ]);

    const timeline = buildBatchTimeline([record]);

    expect(timeline.map((e) => e.type)).toEqual([
      "CREATED",
      "SUBMITTED",
      "REJECTED",
      "REVISED",
      "SUBMITTED",
      "APPROVED",
      "ANCHORED",
    ]);
  });

  it("formats detail as 'By <actor>: <detail>' when both are present", () => {
    const record = makeRecord([makeEvent({ type: "REJECTED", actor: "qa@example.com", detail: "bad batch" })]);
    const timeline = buildBatchTimeline([record]);
    expect(timeline[0].detail).toBe("By qa@example.com: bad batch");
  });

  it("omits detail entirely when neither actor nor detail is present", () => {
    const record = makeRecord([makeEvent({ type: "ANCHORED", actor: null, detail: null })]);
    const timeline = buildBatchTimeline([record]);
    expect(timeline[0].detail).toBeUndefined();
  });

  it("returns an empty array for records with no events", () => {
    const record = makeRecord([]);
    expect(buildBatchTimeline([record])).toEqual([]);
  });
});
