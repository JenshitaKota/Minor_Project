import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ManufacturingRecord } from "../types";
import { api } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { RecordDetail } from "../components/RecordDetail";

export default function AllRecords() {
  const [records, setRecords] = useState<ManufacturingRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPage = useCallback(async (pageToLoad: number, { append }: { append: boolean }) => {
    try {
      const { items, total: newTotal } = await api.listRecords(pageToLoad);
      setRecords((prev) => (append ? [...prev, ...items] : items));
      setPage(pageToLoad);
      setTotal(newTotal);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load records");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage(1, { append: false });
  }, [loadPage]);

  function handleRecordChanged(updated: ManufacturingRecord) {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  const selectedRecord = records.find((r) => r.id === selectedId) ?? null;

  return (
    <>
      <div className="app-header">
        <div>
          <h1>All Records</h1>
          <span className="tagline">Every manufacturing record across every batch</span>
        </div>
        <Link to="/" className="nav-link">
          ← Back to dashboard
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {selectedRecord ? (
        <RecordDetail record={selectedRecord} onChanged={handleRecordChanged} onBack={() => setSelectedId(null)} />
      ) : (
        <div className="panel">
          {loading && <p className="empty-state">Loading...</p>}
          {!loading && records.length === 0 && <p className="empty-state">No records yet.</p>}
          {records.length > 0 && (
            <>
              <table className="content-table">
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="record-row" onClick={() => setSelectedId(record.id)} style={{ cursor: "pointer" }}>
                      <td>{record.batch?.batchNumber ?? "—"}</td>
                      <td>{record.stage}</td>
                      <td>
                        <StatusBadge status={record.status} />
                      </td>
                      <td>{record.anomalies.length > 0 ? <span className="anomaly-dot" title={record.anomalies.map((a) => a.label).join(", ")}>⚠ {record.anomalies.length}</span> : ""}</td>
                      <td>{new Date(record.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {records.length < total && (
                <button className="link-btn" onClick={() => loadPage(page + 1, { append: true })}>
                  Load more ({records.length} of {total})
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
