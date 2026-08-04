import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type PublicVerifyResponse } from "../api";

type SearchState = "idle" | "loading" | "found" | "not-found" | "error";

export default function PublicVerify() {
  const [batchId, setBatchId] = useState("");
  const [state, setState] = useState<SearchState>("idle");
  const [result, setResult] = useState<PublicVerifyResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = batchId.trim();
    if (!trimmed) return;

    setState("loading");
    setResult(null);
    setErrorMessage(null);

    try {
      const data = await api.publicVerifyBatch(trimmed);
      setResult(data);
      setState("found");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      if (message.toLowerCase().includes("no records found")) {
        setState("not-found");
      } else {
        setErrorMessage(message);
        setState("error");
      }
    }
  }

  return (
    <div className="verify-page">
      <div className="verify-page-inner">
        <div className="verify-brand">
          <div className="verify-logo">⛓</div>
          <h1>Batch Verification</h1>
          <p>Check whether a manufacturing batch's records match what was certified on the blockchain.</p>
        </div>

        <form onSubmit={handleSearch} className="verify-search">
          <input
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            placeholder="Enter Batch ID (e.g. BATCH-2026-001)"
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={state === "loading"}>
            {state === "loading" ? "Checking..." : "Verify"}
          </button>
        </form>

        {state === "not-found" && (
          <div className="verify-result-empty">No batch found with ID “{batchId.trim()}”. Check the ID and try again.</div>
        )}

        {state === "error" && <div className="error-banner">{errorMessage}</div>}

        {state === "found" && result && (
          <div className="verify-results">
            <h2>Batch {result.batchId}</h2>
            {result.records.map((record) => (
              <div key={record.recordId} className="verify-result-card">
                <div className="verify-result-top">
                  <span className="verify-result-label">{record.label ?? "Manufacturing Record"}</span>
                  {record.status !== "ANCHORED" && <span className="pill pill-neutral">Not yet anchored</span>}
                  {record.status === "ANCHORED" && record.matches && <span className="pill pill-success">✓ Verified</span>}
                  {record.status === "ANCHORED" && !record.matches && <span className="pill pill-danger">✗ Tampered</span>}
                </div>
                {record.anchoredAt && (
                  <div className="verify-result-meta">Anchored {new Date(record.anchoredAt).toLocaleString()}</div>
                )}
              </div>
            ))}
          </div>
        )}

        <Link to="/" className="nav-link back-link">
          ← Internal dashboard
        </Link>
      </div>
    </div>
  );
}
