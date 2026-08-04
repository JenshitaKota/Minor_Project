import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import type { ManufacturingRecord, RecordContent } from "../types";
import { api, type BatchWithRecords } from "../api";
import { useAuth } from "../context/AuthContext";
import { BatchList } from "../components/BatchList";
import { NewBatchForm } from "../components/NewBatchForm";
import { BatchDetail } from "../components/BatchDetail";
import { RecordDetail } from "../components/RecordDetail";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [batches, setBatches] = useState<BatchWithRecords[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    try {
      const summaries = await api.listBatches();
      const detailed = await Promise.all(summaries.map((b) => api.getBatch(b.id)));
      setBatches(detailed);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load batches");
    }
  }, []);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  async function handleCreateBatch(batchNumber: string, product: string, plannedQuantity: number) {
    const batch = await api.createBatch(batchNumber, product, plannedQuantity);
    await loadBatches();
    setSelectedBatchId(batch.id);
  }

  async function handleCreateRecord(stage: string, equipmentId: string | null, content: RecordContent) {
    if (!selectedBatchId) return;
    await api.createRecord(selectedBatchId, stage, equipmentId, content);
    await loadBatches();
  }

  function handleRecordChanged(updated: ManufacturingRecord) {
    setBatches((prev) =>
      prev.map((b) => (b.id === updated.batchId ? { ...b, records: b.records.map((r) => (r.id === updated.id ? updated : r)) } : b))
    );
  }

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? null;
  const selectedRecord = selectedBatch?.records.find((r) => r.id === selectedRecordId) ?? null;
  const canCreateRecords = user?.role === "OPERATOR" || user?.role === "ADMIN";

  return (
    <>
      <div className="app-header">
        <div>
          <h1>PharmaChain Integrity</h1>
          <span className="tagline">Internal batch record dashboard</span>
        </div>
        <div className="header-actions">
          <Link to="/analytics" className="nav-link">
            Analytics
          </Link>
          <Link to="/verify" className="nav-link">
            Public Verification Page →
          </Link>
          {user?.role === "ADMIN" && (
            <Link to="/admin/users" className="nav-link">
              Manage Users
            </Link>
          )}
          <div className="user-badge">
            <span>{user?.name}</span>
            <span className="role-pill">{user?.role}</span>
            <button className="link-btn" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      {loadError && <div className="error-banner">{loadError} — is the backend running on :4000?</div>}

      <div className="layout">
        <div>
          <div className="panel" style={{ marginBottom: 16 }}>
            <h2>Batches</h2>
            <BatchList
              batches={batches}
              selectedId={selectedBatchId}
              onSelect={(id) => {
                setSelectedBatchId(id);
                setSelectedRecordId(null);
              }}
            />
          </div>
          {canCreateRecords && (
            <div className="panel">
              <h2>New Batch</h2>
              <NewBatchForm onCreate={handleCreateBatch} />
            </div>
          )}
        </div>

        {selectedRecord ? (
          <RecordDetail record={selectedRecord} onChanged={handleRecordChanged} onBack={() => setSelectedRecordId(null)} />
        ) : selectedBatch ? (
          <BatchDetail
            batch={selectedBatch}
            onSelectRecord={setSelectedRecordId}
            onCreateRecord={handleCreateRecord}
            canCreateRecords={canCreateRecords}
          />
        ) : (
          <div className="panel">
            <p className="empty-state">Select a batch, or create one to get started.</p>
          </div>
        )}
      </div>
    </>
  );
}
