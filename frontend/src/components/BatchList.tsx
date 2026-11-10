import type { Batch } from "../types";

/** A list item may be a summary (`_count` from GET /batches) or a full batch with its
 * `records` loaded (GET /batches/:id, which the dashboard swaps in) - which has no
 * `_count`, so count from whichever is present. */
type BatchListItem = Batch & { records?: unknown[] };

function recordCount(batch: BatchListItem) {
  return batch.records?.length ?? batch._count?.records ?? 0;
}

interface Props {
  batches: BatchListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function BatchList({ batches, selectedId, onSelect }: Props) {
  if (batches.length === 0) {
    return <p className="empty-state">No batches yet. Create one below.</p>;
  }

  return (
    <div className="record-list">
      {batches.map((batch) => (
        <button
          key={batch.id}
          className={`record-item ${batch.id === selectedId ? "active" : ""}`}
          onClick={() => onSelect(batch.id)}
        >
          <span className="batch-id">{batch.batchNumber}</span>
          <span className="batch-sub">
            {batch.product} · {recordCount(batch)} record{recordCount(batch) === 1 ? "" : "s"}
          </span>
        </button>
      ))}
    </div>
  );
}
