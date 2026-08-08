import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";
import { api, auditApi } from "../api";
import type { User } from "../types";

vi.mock("../api", () => ({
  api: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
  auditApi: { login: vi.fn(), logout: vi.fn() },
}));

const mockedApi = api as unknown as { me: Mock; login: Mock; logout: Mock };
const mockedAuditApi = auditApi as unknown as { login: Mock; logout: Mock };

const testUser: User = { id: "u1", email: "a@b.com", name: "A", role: "OPERATOR" };
const testAuditor: User = { id: "u2", email: "aud@b.com", name: "Aud", role: "AUDITOR" };

function Consumer() {
  const { user, loading, login, logout, auditServiceWarning } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user ? user.email : "none"}</div>
      <div data-testid="warning">{auditServiceWarning ?? "none"}</div>
      <button onClick={() => login("a@b.com", "pw")}>do-login</button>
      <button onClick={() => login("aud@b.com", "pw")}>do-login-auditor</button>
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
    mockedAuditApi.login.mockReset();
    mockedAuditApi.login.mockResolvedValue({ user: testUser });
    mockedAuditApi.logout.mockReset();
    mockedAuditApi.logout.mockResolvedValue(undefined);
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
    // The same credentials are also submitted to the independent audit-attestation
    // service, not just the main backend.
    expect(mockedAuditApi.login).toHaveBeenCalledWith("a@b.com", "pw");
  });

  it("surfaces a non-blocking warning when an Auditor's independent audit-service login fails, even though the main login succeeded", async () => {
    mockedApi.me.mockRejectedValue(new Error("401"));
    mockedApi.login.mockResolvedValue({ user: testAuditor });
    mockedAuditApi.login.mockRejectedValue(new Error("audit service unreachable"));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("do-login-auditor"));

    // Main session still succeeds - the user is logged in regardless.
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("aud@b.com"));
    expect(screen.getByTestId("warning")).toHaveTextContent(/audit service unavailable/i);
  });

  it("does not surface a warning for a non-Auditor role, even if the audit-service login fails", async () => {
    mockedApi.me.mockRejectedValue(new Error("401"));
    mockedApi.login.mockResolvedValue({ user: testUser });
    mockedAuditApi.login.mockRejectedValue(new Error("audit service unreachable"));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("do-login"));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("a@b.com"));
    expect(screen.getByTestId("warning")).toHaveTextContent("none");
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
