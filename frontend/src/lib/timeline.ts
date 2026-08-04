import type { ManufacturingRecord, RecordEventType } from "../types";

export interface TimelineEvent {
  time: string;
  type: RecordEventType;
  stage: string;
  detail?: string;
}

/** Flattens every record's real event history into one chronological timeline for the
 * batch. Sourced from the RecordEvent log (not derived from each record's current
 * status fields), so a reject-then-resubmit-then-approve cycle keeps every step. */
export function buildBatchTimeline(records: ManufacturingRecord[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const record of records) {
    for (const event of record.events ?? []) {
      const actorPart = event.actor ? `By ${event.actor}` : undefined;
      const detail = [actorPart, event.detail].filter(Boolean).join(": ") || undefined;
      events.push({ time: event.createdAt, type: event.type, stage: event.stage, detail });
    }
  }

  return events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}
