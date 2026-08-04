import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordDetail } from "./RecordDetail";
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
    verify: vi.fn(),
  },
}));

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

    expect(screen.getByRole("button", { name: /approve & anchor/i })).toBeInTheDocument();
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

  it("offers Submit for QA Review to an Operator on a clean DRAFT record", () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR") });
    render(
      <RecordDetail record={makeRecord({ status: "DRAFT" })} onChanged={vi.fn()} onBack={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: /submit for qa review/i })).toBeInTheDocument();
  });
});
