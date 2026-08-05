import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import PublicVerify from "./PublicVerify";
import { api, type PublicVerifyResponse } from "../api";

vi.mock("../api", () => ({
  api: { publicVerifyBatch: vi.fn() },
}));

const mockedApi = api as unknown as { publicVerifyBatch: Mock };

function renderPage() {
  return render(
    <MemoryRouter>
      <PublicVerify />
    </MemoryRouter>
  );
}

async function search(batchId: string) {
  await userEvent.type(screen.getByPlaceholderText(/enter batch id/i), batchId);
  await userEvent.click(screen.getByRole("button", { name: /verify/i }));
}

describe("PublicVerify", () => {
  beforeEach(() => {
    mockedApi.publicVerifyBatch.mockReset();
  });

  it("shows a verified pill for a matching anchored record", async () => {
    const response: PublicVerifyResponse = {
      batchId: "BATCH-2026-001",
      product: "Amoxicillin",
      plannedQuantity: 1000,
      records: [{ recordId: "r1", label: "Mixing", status: "ANCHORED", anchored: true, matches: true, anchoredAt: "2026-01-01T00:00:00.000Z" }],
    };
    mockedApi.publicVerifyBatch.mockResolvedValue(response);
    renderPage();

    await search("BATCH-2026-001");

    await waitFor(() => expect(screen.getByText(/✓ verified/i)).toBeInTheDocument());
    expect(mockedApi.publicVerifyBatch).toHaveBeenCalledWith("BATCH-2026-001");
  });

  it("shows a tampered pill when an anchored record's hash no longer matches", async () => {
    const response: PublicVerifyResponse = {
      batchId: "BATCH-2026-001",
      product: "Amoxicillin",
      plannedQuantity: 1000,
      records: [{ recordId: "r1", label: "Mixing", status: "ANCHORED", anchored: true, matches: false, anchoredAt: "2026-01-01T00:00:00.000Z" }],
    };
    mockedApi.publicVerifyBatch.mockResolvedValue(response);
    renderPage();

    await search("BATCH-2026-001");

    await waitFor(() => expect(screen.getByText(/✗ tampered/i)).toBeInTheDocument());
  });

  it("shows a neutral pill for a record that hasn't been anchored yet", async () => {
    const response: PublicVerifyResponse = {
      batchId: "BATCH-2026-001",
      product: "Amoxicillin",
      plannedQuantity: 1000,
      records: [{ recordId: "r1", label: "Mixing", status: "DRAFT", anchored: false, matches: false, anchoredAt: null }],
    };
    mockedApi.publicVerifyBatch.mockResolvedValue(response);
    renderPage();

    await search("BATCH-2026-001");

    await waitFor(() => expect(screen.getByText(/not yet anchored/i)).toBeInTheDocument());
  });

  it("shows a not-found message when the batch doesn't exist", async () => {
    mockedApi.publicVerifyBatch.mockRejectedValue(new Error("No records found for that batch"));
    renderPage();

    await search("NOPE-404");

    await waitFor(() => expect(screen.getByText(/no batch found/i)).toBeInTheDocument());
  });

  it("shows a generic error banner for other failures", async () => {
    mockedApi.publicVerifyBatch.mockRejectedValue(new Error("Server exploded"));
    renderPage();

    await search("BATCH-2026-001");

    await waitFor(() => expect(screen.getByText("Server exploded")).toBeInTheDocument());
  });

  it("does not search on an empty/whitespace-only batch id", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /verify/i }));
    expect(mockedApi.publicVerifyBatch).not.toHaveBeenCalled();
  });
});
