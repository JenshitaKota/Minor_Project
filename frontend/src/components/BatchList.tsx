import type { Batch } from "../types";

interface Props {
  batches: Batch[];
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
            {batch.product} · {batch._count?.records ?? 0} record{batch._count?.records === 1 ? "" : "s"}
          </span>
        </button>
      ))}
    </div>
  );
}
