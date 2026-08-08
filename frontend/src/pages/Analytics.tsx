import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { AnalyticsSummary, RecordStatus } from "../types";

const STATUS_ORDER: RecordStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "ANCHORED", "REJECTED"];

const EQUIPMENT_STATUS_ORDER: { key: "active" | "pendingCoSign" | "overdue" | "retired"; label: string; className: string }[] = [
  { key: "active", label: "ACTIVE", className: "status-bar-eq-active" },
  { key: "pendingCoSign", label: "PENDING CO-SIGN", className: "status-bar-eq-pending" },
  { key: "overdue", label: "OVERDUE", className: "status-bar-eq-overdue" },
  { key: "retired", label: "RETIRED", className: "status-bar-eq-retired" },
];

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} hr`;
}

export default function Analytics() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAnalyticsSummary().then(setSummary).catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <div className="app-header">
        <div>
          <h1>Analytics</h1>
          <span className="tagline">Live snapshot across all batches</span>
        </div>
        <Link to="/" className="nav-link">
          ← Back to dashboard
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!summary && !error && <p className="empty-state">Loading...</p>}

      {summary && (
        <>
          <div className="kpi-row">
            <div className="stat-tile">
              <div className="stat-label">Total batches</div>
              <div className="stat-value">{summary.totalBatches}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Total records</div>
              <div className="stat-value">{summary.totalRecords}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Verification pass rate</div>
              <div className="stat-value">
                {summary.verification.passRatePercent === null ? "—" : `${summary.verification.passRatePercent}%`}
              </div>
              <div className="stat-sub">
                {summary.verification.passed} / {summary.verification.checked} anchored records match the chain
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Avg. approval time</div>
              <div className="stat-value">{formatDuration(summary.averageApprovalTimeMinutes)}</div>
              <div className="stat-sub">submission → QA decision</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Anomalies flagged</div>
              <div className={`stat-value ${summary.anomalyCount > 0 ? "stat-value-warning" : ""}`}>
                {summary.anomalyCount}
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Awaiting co-signature</div>
              <div
                className={`stat-value ${
                  summary.pendingCoSignatures.records + summary.pendingCoSignatures.equipmentCalibrations > 0 ? "stat-value-warning" : ""
                }`}
              >
                {summary.pendingCoSignatures.records + summary.pendingCoSignatures.equipmentCalibrations}
              </div>
              <div className="stat-sub">
                {summary.pendingCoSignatures.records} records · {summary.pendingCoSignatures.equipmentCalibrations} calibrations
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <h2>Records by status</h2>
            <div className="status-bars">
              {STATUS_ORDER.map((status) => {
                const count = summary.statusBreakdown[status];
                const max = Math.max(1, ...STATUS_ORDER.map((s) => summary.statusBreakdown[s]));
                return (
                  <div key={status} className="status-bar-row">
                    <span className="status-bar-label">{status}</span>
                    <div className="status-bar-track">
                      <div
                        className={`status-bar-fill status-bar-${status}`}
                        style={{ width: `${(count / max) * 100}%` }}
                      />
                    </div>
                    <span className="status-bar-count">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <h2>Equipment calibration status</h2>
            <div className="status-bars">
              {EQUIPMENT_STATUS_ORDER.map(({ key, label, className }) => {
                const count = summary.equipmentStatus[key];
                const max = Math.max(1, ...EQUIPMENT_STATUS_ORDER.map((s) => summary.equipmentStatus[s.key]));
                return (
                  <div key={key} className="status-bar-row">
                    <span className="status-bar-label">{label}</span>
                    <div className="status-bar-track">
                      <div className={`status-bar-fill ${className}`} style={{ width: `${(count / max) * 100}%` }} />
                    </div>
                    <span className="status-bar-count">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
