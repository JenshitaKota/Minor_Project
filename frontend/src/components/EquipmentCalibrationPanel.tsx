import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import type { Equipment, EquipmentCalibration, EquipmentStatus } from "../types";

const STATUS_PILL: Record<EquipmentStatus, string> = {
  ACTIVE: "pill-success",
  MAINTENANCE: "pill-warning",
  RETIRED: "pill-danger",
};

interface Props {
  equipment: Equipment;
  onEquipmentChanged: (updated: Equipment) => void;
}

export function EquipmentCalibrationPanel({ equipment, onEquipmentChanged }: Props) {
  const { user } = useAuth();
  const isOperator = user?.role === "OPERATOR" || user?.role === "ADMIN";
  const isAuditor = user?.role === "AUDITOR" || user?.role === "ADMIN";

  const [calibrations, setCalibrations] = useState<EquipmentCalibration[]>([]);
  const [certificateNumber, setCertificateNumber] = useState("");
  const [technician, setTechnician] = useState("");
  const [calibratedAt, setCalibratedAt] = useState("");
  const [nextDueAt, setNextDueAt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCalibrations(equipment.id).then(setCalibrations).catch((err) => setError(err.message));
  }, [equipment.id]);

  async function handleLog(e: FormEvent) {
    e.preventDefault();
    if (!certificateNumber || !technician || !calibratedAt || !nextDueAt) return;
    setBusy("log");
    setError(null);
    try {
      const created = await api.calibrateEquipment(
        equipment.id,
        certificateNumber,
        technician,
        new Date(calibratedAt).toISOString(),
        new Date(nextDueAt).toISOString()
      );
      setCalibrations((prev) => [created, ...prev]);
      onEquipmentChanged({ ...equipment, status: "MAINTENANCE" });
      setCertificateNumber("");
      setTechnician("");
      setCalibratedAt("");
      setNextDueAt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log calibration");
    } finally {
      setBusy(null);
    }
  }

  async function handleCoSign(calibrationId: string) {
    setBusy(calibrationId);
    setError(null);
    try {
      const updated = await api.coSignCalibration(equipment.id, calibrationId);
      setCalibrations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      onEquipmentChanged({ ...equipment, status: "ACTIVE" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to co-sign calibration");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel">
      <div className="detail-header">
        <h2>{equipment.code}</h2>
        <span className={`pill ${STATUS_PILL[equipment.status]}`}>{equipment.status}</span>
      </div>

      <div className="meta-grid">
        <div className="meta-item">
          <div className="label">Name</div>
          <div>{equipment.name}</div>
        </div>
        <div className="meta-item">
          <div className="label">Type</div>
          <div>{equipment.type}</div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <h2>Calibration History</h2>
      {calibrations.length === 0 ? (
        <p className="empty-state">No calibrations logged yet.</p>
      ) : (
        <table className="content-table" style={{ marginBottom: 20 }}>
          <tbody>
            {calibrations.map((c) => {
              const pending = Boolean(c.anchorProposedAt) && !c.anchoredAt;
              const isOwnProposal = pending && user?.email === c.anchorProposedBy;
              const canCoSign = pending && isAuditor && !isOwnProposal;

              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.certificateNumber}</strong>
                    <div className="hash">
                      {c.technician} · calibrated {new Date(c.calibratedAt).toLocaleDateString()} · due{" "}
                      {new Date(c.nextDueAt).toLocaleDateString()}
                    </div>
                    {pending && (
                      <div className="hash">
                        {isOwnProposal
                          ? "Awaiting an independent Auditor's co-signature (you proposed this)"
                          : `Proposed by ${c.anchorProposedBy} — awaiting co-signature`}
                      </div>
                    )}
                    {c.anchoredAt && (
                      <div className="hash">
                        Anchored {new Date(c.anchoredAt).toLocaleString()} · co-signed by {c.anchorCoSignedBy}
                      </div>
                    )}
                  </td>
                  <td style={{ width: 140, textAlign: "right" }}>
                    {canCoSign && (
                      <button className="btn btn-primary" onClick={() => handleCoSign(c.id)} disabled={busy !== null}>
                        {busy === c.id ? "Co-signing..." : "Co-Sign"}
                      </button>
                    )}
                    {c.anchoredAt && <span className="pill pill-success">Anchored</span>}
                    {pending && !canCoSign && <span className="pill pill-neutral">Pending co-sign</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {isOperator && (
        <>
          <h2>Log Calibration</h2>
          <form onSubmit={handleLog}>
            <div className="form-field">
              <label htmlFor="cert-number">Certificate Number</label>
              <input
                id="cert-number"
                value={certificateNumber}
                onChange={(e) => setCertificateNumber(e.target.value)}
                placeholder="CAL-2026-0142"
              />
            </div>
            <div className="form-field">
              <label htmlFor="technician">Technician</label>
              <input id="technician" value={technician} onChange={(e) => setTechnician(e.target.value)} placeholder="J. Rao" />
            </div>
            <div className="form-field">
              <label htmlFor="calibrated-at">Calibrated On</label>
              <input id="calibrated-at" type="date" value={calibratedAt} onChange={(e) => setCalibratedAt(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="next-due-at">Next Due</label>
              <input id="next-due-at" type="date" value={nextDueAt} onChange={(e) => setNextDueAt(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy !== null}>
              {busy === "log" ? "Logging..." : "Log Calibration"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
