import type { RecordStatus } from "../types";

export function StatusBadge({ status }: { status: RecordStatus }) {
  return <span className={`status-badge ${status}`}>{status}</span>;
}
