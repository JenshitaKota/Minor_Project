import { useEffect, useState } from "react";
import type { Equipment, RecordContent } from "../types";
import { api } from "../api";

interface Props {
  onCreate: (stage: string, equipmentId: string | null, content: RecordContent) => Promise<void>;
}

const STAGE_SUGGESTIONS = ["Mixing", "Granulation", "Compression", "Coating", "Packaging", "Quality Control"];

export function NewRecordForm({ onCreate }: Props) {
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([]);
  const [stage, setStage] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [operator, setOperator] = useState("");
  const [observedQuantity, setObservedQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [addingEquipment, setAddingEquipment] = useState(false);
  const [newEquipCode, setNewEquipCode] = useState("");
  const [newEquipName, setNewEquipName] = useState("");
  const [newEquipType, setNewEquipType] = useState("");
  const [creatingEquipment, setCreatingEquipment] = useState(false);

  function loadEquipment() {
    api.listEquipment().then(setEquipmentList).catch(() => {});
  }

  useEffect(loadEquipment, []);

  const canSubmit = stage && operator && observedQuantity && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      await onCreate(stage, equipmentId || null, {
        operator,
        observedQuantity: Number(observedQuantity),
        ...(notes ? { notes } : {}),
      });
      setStage("");
      setEquipmentId("");
      setOperator("");
      setObservedQuantity("");
      setNotes("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddEquipment(e: React.FormEvent) {
    e.preventDefault();
    if (!newEquipCode || !newEquipName || !newEquipType) return;

    setCreatingEquipment(true);
    try {
      const created = await api.createEquipment(newEquipCode, newEquipName, newEquipType);
      setEquipmentList((prev) => [...prev, created]);
      setEquipmentId(created.id);
      setNewEquipCode("");
      setNewEquipName("");
      setNewEquipType("");
      setAddingEquipment(false);
    } finally {
      setCreatingEquipment(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="stage">Stage</label>
        <input id="stage" list="stage-suggestions" value={stage} onChange={(e) => setStage(e.target.value)} placeholder="Mixing" />
        <datalist id="stage-suggestions">
          {STAGE_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>

      <div className="form-field">
        <label htmlFor="equipment">Equipment</label>
        <select id="equipment" value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
          <option value="">— None —</option>
          {equipmentList.map((eq) => (
            <option key={eq.id} value={eq.id} disabled={eq.status !== "ACTIVE"}>
              {eq.code} — {eq.name} {eq.status !== "ACTIVE" ? `(${eq.status})` : ""}
            </option>
          ))}
        </select>
        <button type="button" className="link-btn" style={{ marginTop: 4, alignSelf: "flex-start" }} onClick={() => setAddingEquipment((v) => !v)}>
          {addingEquipment ? "Cancel" : "+ New equipment"}
        </button>
      </div>

      {addingEquipment && (
        <div className="inline-equipment-form">
          <input value={newEquipCode} onChange={(e) => setNewEquipCode(e.target.value)} placeholder="Code (MIXER-05)" />
          <input value={newEquipName} onChange={(e) => setNewEquipName(e.target.value)} placeholder="Name" />
          <input value={newEquipType} onChange={(e) => setNewEquipType(e.target.value)} placeholder="Type (Mixer)" />
          <button type="button" className="btn btn-secondary" onClick={handleAddEquipment} disabled={creatingEquipment}>
            {creatingEquipment ? "Adding..." : "Add"}
          </button>
        </div>
      )}

      <div className="form-field">
        <label htmlFor="operator">Operator</label>
        <input id="operator" value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="J. Kota" />
      </div>
      <div className="form-field">
        <label htmlFor="observedQuantity">Observed Quantity</label>
        <input
          id="observedQuantity"
          type="number"
          value={observedQuantity}
          onChange={(e) => setObservedQuantity(e.target.value)}
          placeholder="9980"
        />
      </div>
      <div className="form-field">
        <label htmlFor="notes">Notes (optional)</label>
        <input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nominal run" />
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
        {submitting ? "Creating..." : "Create Record"}
      </button>
    </form>
  );
}
