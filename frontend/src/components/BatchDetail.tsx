import { useState } from "react";
import type { BatchWithRecords } from "../api";
import type { ManufacturingRecord, RecordContent } from "../types";
import { StatusBadge } from "./StatusBadge";
import { NewRecordForm } from "./NewRecordForm";
import { BatchTimeline } from "./BatchTimeline";
import { buildBatchTimeline } from "../lib/timeline";

interface Props {
  batch: BatchWithRecords;
  onSelectRecord: (id: string) => void;
  onCreateRecord: (stage: string, equipmentId: string | null, content: RecordContent) => Promise<void>;
  canCreateRecords: boolean;
}

type Tab = "records" | "timeline";

export function BatchDetail({ batch, onSelectRecord, onCreateRecord, canCreateRecords }: Props) {
  const [tab, setTab] = useState<Tab>("records");

  return (
    <div className="panel">
      <div className="detail-header">
        <h2>{batch.batchNumber}</h2>
      </div>

      <div className="meta-grid">
        <div className="meta-item">
          <div className="label">Product</div>
          <div>{batch.product}</div>
        </div>
        <div className="meta-item">
          <div className="label">Planned Quantity</div>
          <div>{batch.plannedQuantity.toLocaleString()}</div>
        </div>
      </div>

      <div className="tab-row">
        <button className={`tab-btn ${tab === "records" ? "active" : ""}`} onClick={() => setTab("records")}>
          Records
        </button>
        <button className={`tab-btn ${tab === "timeline" ? "active" : ""}`} onClick={() => setTab("timeline")}>
          Timeline
        </button>
      </div>

      {tab === "records" ? (
        batch.records.length === 0 ? (
          <p className="empty-state">No records for this batch yet.</p>
        ) : (
          <div className="record-list" style={{ marginBottom: 20 }}>
            {batch.records.map((record: ManufacturingRecord) => (
              <button key={record.id} className="record-item" onClick={() => onSelectRecord(record.id)}>
                <span className="batch-id">
                  {record.stage}
                  {record.anomalies.length > 0 && (
                    <span className="anomaly-dot" title={record.anomalies.map((a) => a.label).join("; ")}>
                      ⚠
                    </span>
                  )}
                </span>
                <span className="batch-sub">{record.equipment ? record.equipment.code : "No equipment"}</span>
                <StatusBadge status={record.status} />
              </button>
            ))}
          </div>
        )
      ) : (
        <BatchTimeline events={buildBatchTimeline(batch.records)} />
      )}

      {canCreateRecords && (
        <>
          <h2>New Record</h2>
          <NewRecordForm onCreate={onCreateRecord} />
        </>
      )}
    </div>
  );
}
