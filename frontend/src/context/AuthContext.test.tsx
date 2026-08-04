import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";
import { api } from "../api";
import type { User } from "../types";

vi.mock("../api", () => ({
  api: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
}));

const mockedApi = api as unknown as { me: Mock; login: Mock; logout: Mock };

const testUser: User = { id: "u1", email: "a@b.com", name: "A", role: "OPERATOR" };

function Consumer() {
  const { user, loading, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user ? user.email : "none"}</div>
      <button onClick={() => login("a@b.com", "pw")}>do-login</button>
      <button onClick={() => logout()}>do-logout</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    mockedApi.me.mockReset();
    mockedApi.login.mockReset();
    mockedApi.logout.mockReset();
  });

  it("resolves the session from /auth/me on mount (the httpOnly cookie is invisible to JS)", async () => {
    mockedApi.me.mockResolvedValue(testUser);
    renderProvider();

    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("a@b.com");
  });

  it("has no user when /auth/me rejects, i.e. no valid session cookie", async () => {
    mockedApi.me.mockRejectedValue(new Error("401"));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("login() sets the user from the login response", async () => {
    mockedApi.me.mockRejectedValue(new Error("401"));
    mockedApi.login.mockResolvedValue({ user: testUser });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("do-login"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("a@b.com"));
    expect(mockedApi.login).toHaveBeenCalledWith("a@b.com", "pw");
  });

  it("logout() clears the user locally even if the API call fails", async () => {
    mockedApi.me.mockResolvedValue(testUser);
    mockedApi.logout.mockRejectedValue(new Error("network error"));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("a@b.com"));

    await userEvent.click(screen.getByText("do-logout"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(mockedApi.logout).toHaveBeenCalled();
  });
});
