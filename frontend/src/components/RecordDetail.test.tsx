import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RecordDetail } from "./RecordDetail";
import { api } from "../api";
import type { ManufacturingRecord, User } from "../types";

const mockUseAuth = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../api", () => ({
  api: {
    listEquipment: vi.fn().mockResolvedValue([]),
    updateContent: vi.fn(),
    submit: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    anchor: vi.fn(),
    anchorCoSign: vi.fn(),
    verify: vi.fn(),
    getAnomalyFindings: vi.fn().mockResolvedValue({ recordId: "rec-1", findings: [] }),
  },
}));

const mockedApi = api as unknown as { getAnomalyFindings: ReturnType<typeof vi.fn> };

function makeRecord(overrides: Partial<ManufacturingRecord>): ManufacturingRecord {
  return {
    id: "rec-1",
    batchId: "batch-1",
    equipmentId: null,
    stage: "Mixing",
    content: { operator: "Test Op", observedQuantity: 100 },
    status: "DRAFT",
    contentHash: null,
    anchoredSnapshot: null,
    anchoredTxHash: null,
    anchoredAt: null,
    anchorProposedAt: null,
    anchorProposedBy: null,
    anchorCoSignedBy: null,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    anomalies: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function asUser(role: User["role"]): User {
  return { id: "u1", email: `${role}@test.com`, name: "Test User", role };
}

describe("RecordDetail — role and status gated actions", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockedApi.getAnomalyFindings.mockReset();
    mockedApi.getAnomalyFindings.mockResolvedValue({ recordId: "rec-1", findings: [] });
  });

  it("lets an Operator edit an ANCHORED record — this is the tamper-detection demo itself", () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR") });
    render(
      <RecordDetail record={makeRecord({ status: "ANCHORED" })} onChanged={vi.fn()} onBack={vi.fn()} />
    );

    const quantityInput = screen.getByDisplayValue("100");
    expect(quantityInput).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /verify integrity/i })).toBeInTheDocument();
  });

  it("keeps an ANCHORED record read-only for an Auditor", () => {
    mockUseAuth.mockReturnValue({ user: asUser("AUDITOR") });
    render(
      <RecordDetail record={makeRecord({ status: "ANCHORED" })} onChanged={vi.fn()} onBack={vi.fn()} />
    );

    const quantityInput = screen.getByDisplayValue("100");
    expect(quantityInput).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save change/i })).not.toBeInTheDocument();
  });

  it("shows Approve & Reject to a QA Manager on a SUBMITTED record, with inputs locked", () => {
    mockUseAuth.mockReturnValue({ user: asUser("QA_MANAGER") });
    render(
      <RecordDetail record={makeRecord({ status: "SUBMITTED" })} onChanged={vi.fn()} onBack={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: /approve \(propose anchor\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("100")).toBeDisabled();
  });

  it("blocks an Operator from approving — no Approve button ever renders for that role", () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR") });
    render(
      <RecordDetail record={makeRecord({ status: "SUBMITTED" })} onChanged={vi.fn()} onBack={vi.fn()} />
    );

    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });

  it("shows an on-chain verification badge for an anchored anomaly finding", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("QA_MANAGER") });
    mockedApi.getAnomalyFindings.mockResolvedValue({
      recordId: "rec-1",
      findings: [{ id: "fast-approval", label: "Approved unusually fast", anchored: true, anchoredAt: "2026-01-01T00:00:05.000Z" }],
    });

    render(
      <RecordDetail
        record={makeRecord({ status: "ANCHORED", anomalies: [{ id: "fast-approval", label: "Approved unusually fast" }] })}
        onChanged={vi.fn()}
        onBack={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText(/verified on-chain/i)).toBeInTheDocument());
  });

  it("does not show an on-chain badge when the finding hasn't been anchored yet", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("QA_MANAGER") });
    mockedApi.getAnomalyFindings.mockResolvedValue({
      recordId: "rec-1",
      findings: [{ id: "fast-approval", label: "Approved unusually fast", anchored: false, anchoredAt: null }],
    });

    render(
      <RecordDetail
        record={makeRecord({ status: "ANCHORED", anomalies: [{ id: "fast-approval", label: "Approved unusually fast" }] })}
        onChanged={vi.fn()}
        onBack={vi.fn()}
      />
    );

    await waitFor(() => expect(mockedApi.getAnomalyFindings).toHaveBeenCalledWith("rec-1"));
    expect(screen.queryByText(/verified on-chain/i)).not.toBeInTheDocument();
  });

  it("lets an independent Auditor co-sign a pending anchor proposal", () => {
    mockUseAuth.mockReturnValue({ user: asUser("AUDITOR") });
    render(
      <RecordDetail
        record={makeRecord({ status: "APPROVED", anchorProposedAt: "2026-01-01T00:00:00.000Z", anchorProposedBy: "qa@test.com" })}
        onChanged={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /review & co-sign anchor/i })).toBeInTheDocument();
    expect(screen.getByText(/pending independent audit co-signature/i)).toBeInTheDocument();
  });

  it("blocks the proposer from co-signing their own anchor, even as an Auditor-eligible Admin", () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", email: "qa@test.com", name: "Test", role: "ADMIN" } });
    render(
      <RecordDetail
        record={makeRecord({ status: "APPROVED", anchorProposedAt: "2026-01-01T00:00:00.000Z", anchorProposedBy: "qa@test.com" })}
        onChanged={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /review & co-sign anchor/i })).not.toBeInTheDocument();
    expect(screen.getByText(/you proposed this anchor/i)).toBeInTheDocument();
  });

  it("offers Retry Propose Anchor to QA only when there is no pending proposal yet", () => {
    mockUseAuth.mockReturnValue({ user: asUser("QA_MANAGER") });
    render(
      <RecordDetail record={makeRecord({ status: "APPROVED", anchorProposedAt: null })} onChanged={vi.fn()} onBack={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: /retry propose anchor/i })).toBeInTheDocument();
  });

  it("hides Retry Propose Anchor once a proposal is pending co-signature", () => {
    mockUseAuth.mockReturnValue({ user: asUser("QA_MANAGER") });
    render(
      <RecordDetail
        record={makeRecord({ status: "APPROVED", anchorProposedAt: "2026-01-01T00:00:00.000Z", anchorProposedBy: "qa@test.com" })}
        onChanged={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /retry propose anchor/i })).not.toBeInTheDocument();
  });

  it("offers Submit for QA Review to an Operator on a clean DRAFT record", () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR") });
    render(
      <RecordDetail record={makeRecord({ status: "DRAFT" })} onChanged={vi.fn()} onBack={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: /submit for qa review/i })).toBeInTheDocument();
  });
});
