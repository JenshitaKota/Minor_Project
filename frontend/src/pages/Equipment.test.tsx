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
  api: { listEquipment: vi.fn(), createEquipment: vi.fn(), updateEquipmentStatus: vi.fn() },
}));

const mockedApi = api as unknown as { listEquipment: Mock; createEquipment: Mock; updateEquipmentStatus: Mock };

function asUser(role: User["role"]): User {
  return { id: "u1", email: `${role}@test.com`, name: "Test User", role };
}

const mixer: EquipmentItem = { id: "eq-1", code: "MIXER-01", name: "Mixer One", type: "Mixer", status: "ACTIVE" };

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
});
