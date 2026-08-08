import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Equipment from "./Equipment";
import { api } from "../api";
import type { Equipment as EquipmentItem, User } from "../types";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockUseAuth() }));

vi.mock("../api", () => ({
  api: {
    listEquipment: vi.fn(),
    createEquipment: vi.fn(),
    updateEquipmentStatus: vi.fn(),
    listCalibrations: vi.fn().mockResolvedValue([]),
    calibrateEquipment: vi.fn(),
    coSignCalibration: vi.fn(),
  },
}));

const mockedApi = api as unknown as {
  listEquipment: Mock;
  createEquipment: Mock;
  updateEquipmentStatus: Mock;
  listCalibrations: Mock;
  calibrateEquipment: Mock;
  coSignCalibration: Mock;
};

function asUser(role: User["role"]): User {
  return { id: "u1", email: `${role}@test.com`, name: "Test User", role };
}

const mixer: EquipmentItem = { id: "eq-1", code: "MIXER-01", name: "Mixer One", type: "Mixer", status: "ACTIVE" };

function makeCalibration(overrides: Partial<import("../types").EquipmentCalibration> = {}): import("../types").EquipmentCalibration {
  return {
    id: "cal-1",
    equipmentId: "eq-1",
    certificateNumber: "CAL-2026-0142",
    technician: "J. Rao",
    calibratedAt: "2026-01-01T00:00:00.000Z",
    nextDueAt: "2026-07-01T00:00:00.000Z",
    contentHash: "0xhash",
    anchorProposedAt: null,
    anchorProposedBy: null,
    anchorCoSignedBy: null,
    anchoredTxHash: null,
    anchoredAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Equipment />
    </MemoryRouter>
  );
}

describe("Equipment page", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockedApi.listEquipment.mockReset();
    mockedApi.createEquipment.mockReset();
    mockedApi.updateEquipmentStatus.mockReset();
    mockedApi.listEquipment.mockResolvedValue([mixer]);
    mockedApi.listCalibrations.mockReset();
    mockedApi.listCalibrations.mockResolvedValue([]);
    mockedApi.calibrateEquipment.mockReset();
    mockedApi.coSignCalibration.mockReset();
  });

  it("lets an Operator change equipment status via a select", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR") });
    mockedApi.updateEquipmentStatus.mockResolvedValue({ ...mixer, status: "MAINTENANCE" });
    renderPage();

    await waitFor(() => expect(screen.getByText("MIXER-01")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByRole("combobox"), "MAINTENANCE");

    await waitFor(() => expect(mockedApi.updateEquipmentStatus).toHaveBeenCalledWith("eq-1", "MAINTENANCE"));
  });

  it("shows a read-only status pill (no select, no Add Equipment panel) for an Auditor", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("AUDITOR") });
    renderPage();

    await waitFor(() => expect(screen.getByText("MIXER-01")).toBeInTheDocument());
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add equipment/i })).not.toBeInTheDocument();
  });

  it("lets an Admin create new equipment", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("ADMIN") });
    mockedApi.listEquipment.mockResolvedValue([]);
    mockedApi.createEquipment.mockResolvedValue({ id: "eq-2", code: "MIXER-02", name: "Mixer Two", type: "Mixer", status: "ACTIVE" });
    renderPage();

    await waitFor(() => expect(screen.getByText("No equipment yet.")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Code"), "MIXER-02");
    await userEvent.type(screen.getByLabelText("Name"), "Mixer Two");
    await userEvent.type(screen.getByLabelText("Type"), "Mixer");
    await userEvent.click(screen.getByRole("button", { name: /add equipment/i }));

    await waitFor(() => expect(mockedApi.createEquipment).toHaveBeenCalledWith("MIXER-02", "Mixer Two", "Mixer"));
  });

  it("shows calibration history for equipment once selected", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("AUDITOR") });
    mockedApi.listCalibrations.mockResolvedValue([makeCalibration()]);
    renderPage();

    await waitFor(() => expect(screen.getByText("MIXER-01")).toBeInTheDocument());
    await userEvent.click(screen.getByText("MIXER-01"));

    await waitFor(() => expect(mockedApi.listCalibrations).toHaveBeenCalledWith("eq-1"));
    expect(await screen.findByText("CAL-2026-0142")).toBeInTheDocument();
  });

  it("lets an Operator log a calibration for the selected equipment", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("OPERATOR") });
    mockedApi.calibrateEquipment.mockResolvedValue(makeCalibration({ anchorProposedAt: "2026-01-01T00:00:00.000Z", anchorProposedBy: "OPERATOR@test.com" }));
    renderPage();

    await waitFor(() => expect(screen.getByText("MIXER-01")).toBeInTheDocument());
    await userEvent.click(screen.getByText("MIXER-01"));
    await waitFor(() => expect(screen.getByLabelText("Certificate Number")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Certificate Number"), "CAL-2026-0142");
    await userEvent.type(screen.getByLabelText("Technician"), "J. Rao");
    await userEvent.type(screen.getByLabelText("Calibrated On"), "2026-01-01");
    await userEvent.type(screen.getByLabelText("Next Due"), "2026-07-01");
    await userEvent.click(screen.getByRole("button", { name: /^log calibration$/i }));

    await waitFor(() =>
      expect(mockedApi.calibrateEquipment).toHaveBeenCalledWith(
        "eq-1",
        "CAL-2026-0142",
        "J. Rao",
        expect.any(String),
        expect.any(String)
      )
    );
  });

  it("blocks the proposer from co-signing their own pending calibration", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("AUDITOR") });
    mockedApi.listCalibrations.mockResolvedValue([
      makeCalibration({ anchorProposedAt: "2026-01-01T00:00:00.000Z", anchorProposedBy: "AUDITOR@test.com" }),
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByText("MIXER-01")).toBeInTheDocument());
    await userEvent.click(screen.getByText("MIXER-01"));

    expect(await screen.findByText(/you proposed this/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /co-sign/i })).not.toBeInTheDocument();
  });

  it("lets a different Auditor co-sign a pending calibration", async () => {
    mockUseAuth.mockReturnValue({ user: asUser("AUDITOR") });
    mockedApi.listCalibrations.mockResolvedValue([
      makeCalibration({ anchorProposedAt: "2026-01-01T00:00:00.000Z", anchorProposedBy: "operator@test.com" }),
    ]);
    mockedApi.coSignCalibration.mockResolvedValue(
      makeCalibration({
        anchorProposedAt: "2026-01-01T00:00:00.000Z",
        anchorProposedBy: "operator@test.com",
        anchorCoSignedBy: "AUDITOR@test.com",
        anchoredAt: "2026-01-01T00:05:00.000Z",
        anchoredTxHash: "0xabc",
      })
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("MIXER-01")).toBeInTheDocument());
    await userEvent.click(screen.getByText("MIXER-01"));

    const coSignBtn = await screen.findByRole("button", { name: /co-sign/i });
    await userEvent.click(coSignBtn);

    await waitFor(() => expect(mockedApi.coSignCalibration).toHaveBeenCalledWith("eq-1", "cal-1"));
    expect(await screen.findByText("Anchored")).toBeInTheDocument();
  });
});
