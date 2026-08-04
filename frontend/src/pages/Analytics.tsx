import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { AnalyticsSummary, RecordStatus } from "../types";

const STATUS_ORDER: RecordStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "ANCHORED", "REJECTED"];

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
          </div>

          <div className="panel">
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
        </>
      )}
    </>
  );
}
