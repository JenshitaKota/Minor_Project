import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Analytics from "./Analytics";
import { api } from "../api";
import type { AnalyticsSummary } from "../types";

vi.mock("../api", () => ({
  api: { getAnalyticsSummary: vi.fn() },
}));

const mockedApi = api as unknown as { getAnalyticsSummary: Mock };

function makeSummary(overrides: Partial<AnalyticsSummary>): AnalyticsSummary {
  return {
    totalBatches: 3,
    totalRecords: 5,
    statusBreakdown: { DRAFT: 1, SUBMITTED: 1, APPROVED: 1, ANCHORED: 1, REJECTED: 1 },
    verification: { checked: 1, passed: 1, passRatePercent: 100 },
    averageApprovalTimeMinutes: 12.5,
    anomalyCount: 0,
    ...overrides,
  };
}

function renderAnalytics() {
  return render(
    <MemoryRouter>
      <Analytics />
    </MemoryRouter>
  );
}

describe("Analytics", () => {
  beforeEach(() => {
    mockedApi.getAnalyticsSummary.mockReset();
  });

  it("shows a loading state before the summary arrives", () => {
    mockedApi.getAnalyticsSummary.mockReturnValue(new Promise(() => {}));
    renderAnalytics();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders the summary stats once loaded", async () => {
    mockedApi.getAnalyticsSummary.mockResolvedValue(makeSummary({}));
    renderAnalytics();

    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("shows an em dash for the pass rate when nothing has been checked yet", async () => {
    mockedApi.getAnalyticsSummary.mockResolvedValue(
      makeSummary({ verification: { checked: 0, passed: 0, passRatePercent: null } })
    );
    renderAnalytics();

    await waitFor(() => expect(screen.getByText(/0\s*\/\s*0 anchored records match the chain/i)).toBeInTheDocument());
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("formats sub-minute approval times in seconds", async () => {
    mockedApi.getAnalyticsSummary.mockResolvedValue(makeSummary({ averageApprovalTimeMinutes: 0.5 }));
    renderAnalytics();

    await waitFor(() => expect(screen.getByText("30s")).toBeInTheDocument());
  });

  it("shows an error banner when the summary fails to load", async () => {
    mockedApi.getAnalyticsSummary.mockRejectedValue(new Error("summary unavailable"));
    renderAnalytics();

    await waitFor(() => expect(screen.getByText("summary unavailable")).toBeInTheDocument());
  });

  it("highlights the anomaly count when anomalies exist", async () => {
    mockedApi.getAnalyticsSummary.mockResolvedValue(makeSummary({ anomalyCount: 4 }));
    renderAnalytics();

    await waitFor(() => {
      const value = screen.getByText("4");
      expect(value).toHaveClass("stat-value-warning");
    });
  });
});
