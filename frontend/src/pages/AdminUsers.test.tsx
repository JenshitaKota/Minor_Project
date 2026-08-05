import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AdminUsers from "./AdminUsers";
import { api } from "../api";
import type { User } from "../types";

vi.mock("../api", () => ({
  api: { listUsers: vi.fn(), createUser: vi.fn() },
}));

const mockedApi = api as unknown as { listUsers: Mock; createUser: Mock };

function makeUser(overrides: Partial<User & { createdAt: string }>): User & { createdAt: string } {
  return {
    id: "u1",
    email: "existing@pharmachain.demo",
    name: "Existing User",
    role: "OPERATOR",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminUsers />
    </MemoryRouter>
  );
}

describe("AdminUsers", () => {
  beforeEach(() => {
    mockedApi.listUsers.mockReset();
    mockedApi.createUser.mockReset();
  });

  it("lists existing users with their email and role", async () => {
    mockedApi.listUsers.mockResolvedValue([makeUser({})]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Existing User")).toBeInTheDocument());
    const table = within(screen.getByRole("table"));
    expect(table.getByText("existing@pharmachain.demo")).toBeInTheDocument();
    expect(table.getByText("OPERATOR")).toBeInTheDocument();
  });

  it("shows an error banner when the user list fails to load", async () => {
    mockedApi.listUsers.mockRejectedValue(new Error("forbidden"));
    renderPage();

    await waitFor(() => expect(screen.getByText("forbidden")).toBeInTheDocument());
  });

  it("creates a user and refreshes the list, clearing the form", async () => {
    mockedApi.listUsers.mockResolvedValue([]);
    mockedApi.createUser.mockResolvedValue(makeUser({ id: "u2", email: "new@pharmachain.demo", name: "New Person" }));
    renderPage();

    await waitFor(() => expect(mockedApi.listUsers).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText("Name"), "New Person");
    await userEvent.type(screen.getByLabelText("Email"), "new@pharmachain.demo");
    await userEvent.type(screen.getByLabelText("Password"), "demo1234");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "QA_MANAGER");
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() =>
      expect(mockedApi.createUser).toHaveBeenCalledWith("new@pharmachain.demo", "demo1234", "New Person", "QA_MANAGER")
    );
    await waitFor(() => expect(mockedApi.listUsers).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("shows an error banner when user creation fails, without clearing the form", async () => {
    mockedApi.listUsers.mockResolvedValue([]);
    mockedApi.createUser.mockRejectedValue(new Error("email already in use"));
    renderPage();

    await waitFor(() => expect(mockedApi.listUsers).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText("Name"), "Dupe Person");
    await userEvent.type(screen.getByLabelText("Email"), "dupe@pharmachain.demo");
    await userEvent.type(screen.getByLabelText("Password"), "demo1234");
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => expect(screen.getByText("email already in use")).toBeInTheDocument());
    expect(screen.getByLabelText("Name")).toHaveValue("Dupe Person");
  });
});
