import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";
import { api, type BatchWithRecords } from "../api";
import type { Batch, User } from "../types";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockUseAuth() }));

vi.mock("../api", () => ({
  api: {
    listBatches: vi.fn(),
    getBatch: vi.fn(),
    createBatch: vi.fn(),
    listEquipment: vi.fn().mockResolvedValue([]),
    pendingRecordCoSigns: vi.fn().mockResolvedValue({ count: 0, items: [] }),
    pendingCalibrationCoSigns: vi.fn().mockResolvedValue({ count: 0, items: [] }),
  },
}));

const mockedApi = api as unknown as {
  listBatches: Mock;
  getBatch: Mock;
  createBatch: Mock;
  listEquipment: Mock;
  pendingRecordCoSigns: Mock;
  pendingCalibrationCoSigns: Mock;
};

function asUser(role: User["role"]): User {
  return { id: "u1", email: `${role}@test.com`, name: "Test User", role };
}

function makeBatch(overrides: Partial<Batch>): Batch {
  return {
    id: "b1",
    batchNumber: "BATCH-001",
    product: "Amoxicillin",
    plannedQuantity: 100,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function withRecords(batch: Batch): BatchWithRecords {
  return { ...batch, records: [] };
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

describe("Dashboard", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockedApi.listBatches.mockReset();
    mockedApi.getBatch.mockReset();
    mockedApi.createBatch.mockReset();
    mockedApi.listEquipment.mockReset();
    mockedApi.listEquipment.mockResolvedValue([]);
    mockedApi.pendingRecordCoSigns.mockReset();
    mockedApi.pendingRecordCoSigns.mockResolvedValue({ count: 0, items: [] });
    mockedApi.pendingCalibrationCoSigns.mockReset();
    mockedApi.pendingCalibrationCoSigns.mockResolvedValue({ count: 0, items: [] });
  });

  it("shows the empty state when there are no batches", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR"), logout: vi.fn() });
    mockedApi.listBatches.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/no batches yet/i)).toBeInTheDocument());
  });

  it("loads and displays batches for the first page", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR"), logout: vi.fn() });
    const batch = makeBatch({ id: "b1" });
    mockedApi.listBatches.mockResolvedValue({ items: [batch], total: 1, page: 1, pageSize: 20 });
    mockedApi.getBatch.mockResolvedValue(withRecords(batch));
    renderDashboard();

    await waitFor(() => expect(screen.getByText("BATCH-001")).toBeInTheDocument());
    expect(mockedApi.getBatch).toHaveBeenCalledWith("b1");
  });

  it("shows an error banner when loading batches fails", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR"), logout: vi.fn() });
    mockedApi.listBatches.mockRejectedValue(new Error("network down"));
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
  });

  it("shows the New Batch panel to an Operator but not to an Auditor", async () => {
    mockedApi.listBatches.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR"), logout: vi.fn() });
    const { unmount } = renderDashboard();
    await waitFor(() => expect(screen.getByText("New Batch")).toBeInTheDocument());
    unmount();

    mockUseAuth.mockReturnValue({ user: asUser("AUDITOR"), logout: vi.fn() });
    renderDashboard();
    await waitFor(() => expect(mockedApi.listBatches).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("New Batch")).not.toBeInTheDocument();
  });

  it("shows a Manage Users link only for an Admin", async () => {
    mockedApi.listBatches.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mockUseAuth.mockReturnValue({ user: asUser("ADMIN"), logout: vi.fn() });
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Manage Users")).toBeInTheDocument());
  });

  it("loads the next page and appends batches when Load more is clicked", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR"), logout: vi.fn() });
    const batch1 = makeBatch({ id: "b1", batchNumber: "BATCH-001" });
    const batch2 = makeBatch({ id: "b2", batchNumber: "BATCH-002" });
    mockedApi.listBatches.mockImplementation((page = 1) =>
      Promise.resolve(page === 1 ? { items: [batch1], total: 2, page: 1, pageSize: 1 } : { items: [batch2], total: 2, page: 2, pageSize: 1 })
    );
    mockedApi.getBatch.mockImplementation((id: string) => Promise.resolve(withRecords(id === "b1" ? batch1 : batch2)));
    renderDashboard();

    await waitFor(() => expect(screen.getByText("BATCH-001")).toBeInTheDocument());
    const loadMore = screen.getByRole("button", { name: /load more/i });
    await userEvent.click(loadMore);

    await waitFor(() => expect(screen.getByText("BATCH-002")).toBeInTheDocument());
    expect(screen.getByText("BATCH-001")).toBeInTheDocument();
  });

  it("calls logout when Sign out is clicked", async () => {
    const logout = vi.fn();
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR"), logout });
    mockedApi.listBatches.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderDashboard();

    await waitFor(() => expect(mockedApi.listBatches).toHaveBeenCalled());
    await userEvent.click(screen.getByText("Sign out"));
    expect(logout).toHaveBeenCalled();
  });

  it("shows pending co-sign badges for an Auditor with items awaiting them", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("AUDITOR"), logout: vi.fn() });
    mockedApi.listBatches.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mockedApi.pendingRecordCoSigns.mockResolvedValue({ count: 2, items: [] });
    mockedApi.pendingCalibrationCoSigns.mockResolvedValue({ count: 1, items: [] });
    renderDashboard();

    await waitFor(() => expect(screen.getByTitle("Records awaiting your co-signature")).toHaveTextContent("2"));
    expect(screen.getByTitle("Calibrations awaiting your co-signature")).toHaveTextContent("1");
  });

  it("does not fetch or show pending co-sign badges for a non-Auditor role", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR"), logout: vi.fn() });
    mockedApi.listBatches.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderDashboard();

    await waitFor(() => expect(mockedApi.listBatches).toHaveBeenCalled());
    expect(mockedApi.pendingRecordCoSigns).not.toHaveBeenCalled();
    expect(mockedApi.pendingCalibrationCoSigns).not.toHaveBeenCalled();
  });
});
