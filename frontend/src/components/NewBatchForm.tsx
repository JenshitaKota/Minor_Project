import { useState } from "react";

interface Props {
  onCreate: (batchNumber: string, product: string, plannedQuantity: number) => Promise<void>;
}

export function NewBatchForm({ onCreate }: Props) {
  const [batchNumber, setBatchNumber] = useState("");
  const [product, setProduct] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = batchNumber && product && plannedQuantity && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      await onCreate(batchNumber, product, Number(plannedQuantity));
      setBatchNumber("");
      setProduct("");
      setPlannedQuantity("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="batchNumber">Batch Number</label>
        <input id="batchNumber" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="BATCH-2026-006" />
      </div>
      <div className="form-field">
        <label htmlFor="product">Product</label>
        <input id="product" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Amoxicillin 500mg" />
      </div>
      <div className="form-field">
        <label htmlFor="plannedQuantity">Planned Quantity</label>
        <input
          id="plannedQuantity"
          type="number"
          value={plannedQuantity}
          onChange={(e) => setPlannedQuantity(e.target.value)}
          placeholder="10000"
        />
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
        {submitting ? "Creating..." : "Create Batch"}
      </button>
    </form>
  );
}
