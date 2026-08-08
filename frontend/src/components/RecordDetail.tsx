import { useEffect, useState } from "react";
import type { AnomalyFinding, Equipment, ManufacturingRecord, RecordContent, VerifyResult } from "../types";
import { StatusBadge } from "./StatusBadge";
import { api, auditApi } from "../api";
import { useAuth } from "../context/AuthContext";

interface Props {
  record: ManufacturingRecord;
  onChanged: (updated: ManufacturingRecord) => void;
  onBack: () => void;
}

function contentEquals(a: RecordContent, b: RecordContent): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => String(a[key]) === String(b[key]));
}

export function RecordDetail({ record, onChanged, onBack }: Props) {
  const { user } = useAuth();
  const isOperator = user?.role === "OPERATOR" || user?.role === "ADMIN";
  const isQaManager = user?.role === "QA_MANAGER" || user?.role === "ADMIN";
  const isAuditor = user?.role === "AUDITOR" || user?.role === "ADMIN";
  const isEditableStatus = record.status === "DRAFT" || record.status === "REJECTED" || record.status === "ANCHORED";
  const canEdit = isOperator && isEditableStatus;

  const pendingCoSign = record.status === "APPROVED" && Boolean(record.anchorProposedAt);
  const isOwnProposal = pendingCoSign && user?.email === record.anchorProposedBy;
  const canCoSign = pendingCoSign && isAuditor && !isOwnProposal;

  const [editedContent, setEditedContent] = useState<RecordContent>(record.content);
  const [editedEquipmentId, setEditedEquipmentId] = useState<string>(record.equipmentId ?? "");
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([]);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anomalyFindings, setAnomalyFindings] = useState<AnomalyFinding[]>([]);

  useEffect(() => {
    setEditedContent(record.content);
    setEditedEquipmentId(record.equipmentId ?? "");
    setVerifyResult(null);
    setError(null);
    setRejecting(false);
    setRejectReason("");
  }, [record.id, record.content, record.equipmentId]);

  useEffect(() => {
    api.listEquipment().then(setEquipmentList).catch(() => {});
  }, []);

  useEffect(() => {
    if (record.status === "ANCHORED" && record.anomalies.length > 0) {
      api
        .getAnomalyFindings(record.id)
        .then((res) => setAnomalyFindings(res.findings))
        .catch(() => setAnomalyFindings([]));
    } else {
      setAnomalyFindings([]);
    }
  }, [record.id, record.status, record.anomalies.length]);

  const isDirty = !contentEquals(editedContent, record.content) || editedEquipmentId !== (record.equipmentId ?? "");

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  function handleFieldChange(key: string, value: string) {
    setEditedContent((prev) => ({ ...prev, [key]: value }));
  }

  const handleSave = () =>
    run("save", async () => {
      const updated = await api.updateContent(record.id, editedContent, editedEquipmentId || null);
      onChanged(updated);
      setVerifyResult(null);
    });

  const handleSubmit = () =>
    run("submit", async () => {
      const updated = await api.submit(record.id);
      onChanged(updated);
    });

  const handleApprove = () =>
    run("approve", async () => {
      const updated = await api.approve(record.id);
      onChanged(updated);
    });

  const handleReject = () =>
    run("reject", async () => {
      const updated = await api.reject(record.id, rejectReason);
      onChanged(updated);
      setRejecting(false);
      setRejectReason("");
    });

  const handleAnchor = () =>
    run("anchor", async () => {
      const updated = await api.anchor(record.id);
      onChanged(updated);
    });

  // Two independent services, two sequential calls: the audit-attestation service
  // (its own session, its own key) actually signs on-chain first, then the main
  // backend independently re-verifies that on-chain state itself before persisting -
  // it never just trusts that the first call succeeded. See
  // docs/technical-disclosure.md §4.9.
  const handleCoSign = () =>
    run("cosign", async () => {
      await auditApi.cosignRecord(record.id);
      const updated = await api.anchorCoSign(record.id);
      onChanged(updated);
    });

  const handleVerify = () =>
    run("verify", async () => {
      const result = await api.verify(record.id);
      setVerifyResult(result);
    });

  const anchoredSnapshot = verifyResult ? verifyResult.anchoredSnapshot : record.anchoredSnapshot;
  const diffSource = anchoredSnapshot?.content;
  const equipmentChanged = anchoredSnapshot ? anchoredSnapshot.equipmentId !== editedEquipmentId : false;
  const fieldKeys = Object.keys(editedContent);

  return (
    <div className="panel">
      <button type="button" className="link-btn back-link" onClick={onBack}>
        ← Back to {record.batch?.batchNumber ?? "batch"}
      </button>

      <div className="detail-header">
        <h2>{record.stage}</h2>
        <StatusBadge status={record.status} />
      </div>

      {error && <div className="error-banner">{error}</div>}

      {record.status === "REJECTED" && record.rejectionReason && (
        <div className="error-banner">
          <strong>Rejected by QA:</strong> {record.rejectionReason}
        </div>
      )}

      {record.anomalies.length > 0 && (
        <div className="anomaly-banner">
          <div className="headline">⚠ Flagged for review</div>
          <ul>
            {record.anomalies.map((a) => {
              const finding = anomalyFindings.find((f) => f.id === a.id);
              return (
                <li key={a.id}>
                  {a.label}
                  {finding?.anchored && (
                    <span
                      className="chain-verified"
                      title={finding.anchoredAt ? `Anchored on-chain at ${new Date(finding.anchoredAt).toLocaleString()}` : undefined}
                    >
                      {" "}
                      ⛓ Verified on-chain
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {record.status === "ANCHORED" && (
        <div className="meta-grid">
          <div className="meta-item">
            <div className="label">Anchored at</div>
            <div>{record.anchoredAt ? new Date(record.anchoredAt).toLocaleString() : "-"}</div>
          </div>
          <div className="meta-item">
            <div className="label">Transaction hash</div>
            <div className="hash">{record.anchoredTxHash}</div>
          </div>
          <div className="meta-item">
            <div className="label">Proposed by</div>
            <div>{record.anchorProposedBy ?? "-"}</div>
          </div>
          <div className="meta-item">
            <div className="label">Co-signed by</div>
            <div>{record.anchorCoSignedBy ?? "-"}</div>
          </div>
        </div>
      )}

      {pendingCoSign && (
        <div className="anomaly-banner">
          <div className="headline">⛓ Pending independent audit co-signature</div>
          <div>
            Proposed by <strong>{record.anchorProposedBy}</strong> — no single reviewer can anchor a record alone; a
            different Auditor must independently confirm this before it becomes permanent.
          </div>
          {isOwnProposal && (
            <div style={{ marginTop: 8, fontStyle: "italic" }}>
              You proposed this anchor, so you can't co-sign it yourself.
            </div>
          )}
        </div>
      )}

      <table className="content-table">
        <tbody>
          <tr className={equipmentChanged ? "changed" : ""}>
            <td>equipment</td>
            <td>
              <select value={editedEquipmentId} onChange={(e) => setEditedEquipmentId(e.target.value)} disabled={!canEdit}>
                <option value="">— None —</option>
                {equipmentList.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.code} — {eq.name}
                  </option>
                ))}
              </select>
            </td>
          </tr>
          {fieldKeys.map((key) => {
            const changed = diffSource ? String(diffSource[key]) !== String(editedContent[key]) : false;
            return (
              <tr key={key} className={changed ? "changed" : ""}>
                <td>{key}</td>
                <td>
                  <input
                    value={String(editedContent[key])}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    disabled={!canEdit}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="action-row">
        {canEdit && isDirty && (
          <button className="btn btn-secondary" onClick={handleSave} disabled={busy !== null}>
            {busy === "save" ? "Saving..." : "Save Change"}
          </button>
        )}

        {isOperator && record.status === "DRAFT" && !isDirty && (
          <button className="btn btn-primary" onClick={handleSubmit} disabled={busy !== null}>
            {busy === "submit" ? "Submitting..." : "Submit for QA Review"}
          </button>
        )}

        {isQaManager && record.status === "SUBMITTED" && (
          <>
            <button className="btn btn-primary" onClick={handleApprove} disabled={busy !== null}>
              {busy === "approve" ? "Approving..." : "Approve (Propose Anchor)"}
            </button>
            <button className="btn btn-secondary" onClick={() => setRejecting((v) => !v)} disabled={busy !== null}>
              Reject
            </button>
          </>
        )}

        {isQaManager && record.status === "APPROVED" && !record.anchorProposedAt && (
          <button className="btn btn-primary" onClick={handleAnchor} disabled={busy !== null}>
            {busy === "anchor" ? "Retrying..." : "Retry Propose Anchor"}
          </button>
        )}

        {canCoSign && (
          <button className="btn btn-primary" onClick={handleCoSign} disabled={busy !== null}>
            {busy === "cosign" ? "Co-signing..." : "Review & Co-Sign Anchor"}
          </button>
        )}

        {record.status === "ANCHORED" && (
          <button className="btn btn-primary" onClick={handleVerify} disabled={busy !== null || isDirty}>
            {busy === "verify" ? "Verifying..." : "Verify Integrity"}
          </button>
        )}
      </div>

      {rejecting && (
        <div className="inline-equipment-form" style={{ marginTop: 12 }}>
          <input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection"
            autoFocus
          />
          <button className="btn btn-primary" onClick={handleReject} disabled={!rejectReason || busy !== null}>
            {busy === "reject" ? "Rejecting..." : "Confirm Rejection"}
          </button>
        </div>
      )}

      {verifyResult && (
        <div className={`verify-banner ${verifyResult.matches ? "match" : "mismatch"}`}>
          <div className="headline">
            {verifyResult.matches ? "✓ VERIFIED — matches blockchain record" : "✗ TAMPERED — hash mismatch detected"}
          </div>
          <div className="detail">
            Anchored hash: <span className="hash">{verifyResult.anchoredHash}</span>
          </div>
          <div className="detail">
            Current hash: <span className="hash">{verifyResult.currentHash}</span>
          </div>
        </div>
      )}
    </div>
  );
}
