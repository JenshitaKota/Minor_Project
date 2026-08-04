import type { TimelineEvent } from "../lib/timeline";
import type { RecordEventType } from "../types";

const EVENT_LABELS: Record<RecordEventType, string> = {
  CREATED: "Record created",
  EDITED: "Content edited",
  REVISED: "Revised after rejection",
  SUBMITTED: "Submitted for QA review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ANCHORED: "Anchored on blockchain",
  MODIFIED_AFTER_ANCHOR: "⚠ Content modified after anchoring",
};

interface Props {
  events: TimelineEvent[];
}

export function BatchTimeline({ events }: Props) {
  if (events.length === 0) {
    return <p className="empty-state">No activity yet for this batch.</p>;
  }

  return (
    <div className="timeline">
      {events.map((event, i) => (
        <div key={i} className={`timeline-item timeline-${event.type}`}>
          <div className="timeline-dot" />
          <div className="timeline-body">
            <div className="timeline-headline">
              <span className="timeline-stage">{event.stage}</span>
              <span className="timeline-event">{EVENT_LABELS[event.type]}</span>
            </div>
            {event.detail && (
              <div className={`timeline-detail ${event.type === "ANCHORED" ? "hash" : ""}`}>{event.detail}</div>
            )}
            <div className="timeline-time">{new Date(event.time).toLocaleString()}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
