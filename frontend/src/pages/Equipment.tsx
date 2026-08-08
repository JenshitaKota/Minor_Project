import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { EquipmentCalibrationPanel } from "../components/EquipmentCalibrationPanel";
import type { Equipment as EquipmentItem, EquipmentStatus } from "../types";

const STATUSES: EquipmentStatus[] = ["ACTIVE", "MAINTENANCE", "RETIRED"];

const STATUS_PILL: Record<EquipmentStatus, string> = {
  ACTIVE: "pill-success",
  MAINTENANCE: "pill-warning",
  RETIRED: "pill-danger",
};

export default function Equipment() {
  const { user } = useAuth();
  const canManage = user?.role === "OPERATOR" || user?.role === "ADMIN";

  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  function loadEquipment() {
    api.listEquipment().then(setEquipment).catch((err) => setError(err.message));
  }

  useEffect(loadEquipment, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!code || !name || !type) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createEquipment(code, name, type);
      setEquipment((prev) => [...prev, created].sort((a, b) => a.code.localeCompare(b.code)));
      setCode("");
      setName("");
      setType("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create equipment");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(id: string, status: EquipmentStatus) {
    setUpdatingId(id);
    setError(null);
    try {
      const updated = await api.updateEquipmentStatus(id, status);
      setEquipment((prev) => prev.map((eq) => (eq.id === updated.id ? updated : eq)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update equipment status");
    } finally {
      setUpdatingId(null);
    }
  }

  function handleEquipmentChanged(updated: EquipmentItem) {
    setEquipment((prev) => prev.map((eq) => (eq.id === updated.id ? updated : eq)));
  }

  const selectedEquipment = equipment.find((eq) => eq.id === selectedId) ?? null;

  return (
    <>
      <div className="app-header">
        <div>
          <h1>Equipment</h1>
          <span className="tagline">Manufacturing equipment and its availability</span>
        </div>
        <Link to="/" className="nav-link">
          ← Back to dashboard
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="layout">
        <div>
          <div className="panel" style={{ marginBottom: 16 }}>
            <h2>Equipment</h2>
            {equipment.length === 0 ? (
              <p className="empty-state">No equipment yet.</p>
            ) : (
              <table className="content-table">
                <tbody>
                  {equipment.map((eq) => (
                    <tr key={eq.id} className={selectedId === eq.id ? "changed" : ""}>
                      <td onClick={() => setSelectedId(eq.id)} style={{ cursor: "pointer" }}>
                        <strong>{eq.code}</strong>
                        <div className="hash">
                          {eq.name} · {eq.type}
                        </div>
                      </td>
                      <td>
                        {canManage ? (
                          <select
                            value={eq.status}
                            disabled={updatingId === eq.id}
                            onChange={(e) => handleStatusChange(eq.id, e.target.value as EquipmentStatus)}
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`pill ${STATUS_PILL[eq.status]}`}>{eq.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {canManage && (
            <div className="panel">
              <h2>Add Equipment</h2>
              <form onSubmit={handleCreate}>
                <div className="form-field">
                  <label htmlFor="eq-code">Code</label>
                  <input id="eq-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MIXER-05" />
                </div>
                <div className="form-field">
                  <label htmlFor="eq-name">Name</label>
                  <input id="eq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Line 5 Mixer" />
                </div>
                <div className="form-field">
                  <label htmlFor="eq-type">Type</label>
                  <input id="eq-type" value={type} onChange={(e) => setType(e.target.value)} placeholder="Mixer" />
                </div>
                <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                  {submitting ? "Adding..." : "Add Equipment"}
                </button>
              </form>
            </div>
          )}
        </div>

        {selectedEquipment ? (
          <EquipmentCalibrationPanel equipment={selectedEquipment} onEquipmentChanged={handleEquipmentChanged} />
        ) : (
          <div className="panel">
            <p className="empty-state">Select equipment to view its calibration history.</p>
          </div>
        )}
      </div>
    </>
  );
}
