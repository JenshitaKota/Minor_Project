import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "../types";
import { api, auditApi } from "../api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Set only when an Auditor/Admin's login to the independent audit-attestation
   * service failed after the main login succeeded - co-signing is unavailable, but
   * the rest of the app still works, so this is a banner, not a blocking error. */
  auditServiceWarning: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditServiceWarning, setAuditServiceWarning] = useState<string | null>(null);

  useEffect(() => {
    // Session lives in an httpOnly cookie, invisible to JS - ask the backend who we are.
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const { user } = await api.login(email, password);
    setUser(user);
    setAuditServiceWarning(null);

    // A second, independent login to the audit-attestation service, using the same
    // credentials the user just typed - it has its own session, its own database
    // role, and its own JWT secret (see docs/technical-disclosure.md §4.9), so this
    // is a genuinely separate authentication step, not a token handed off from here.
    // Only an Auditor/Admin can use that service at all, so a failure only matters
    // for them - everyone else's failure (usually a role rejection) is expected and
    // silently ignored.
    try {
      await auditApi.login(email, password);
    } catch (err) {
      if (user.role === "AUDITOR" || user.role === "ADMIN") {
        setAuditServiceWarning(
          err instanceof Error
            ? `Independent audit service unavailable (${err.message}) - co-signing is disabled until it's reachable.`
            : "Independent audit service unavailable - co-signing is disabled until it's reachable."
        );
      }
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // The user is signed out locally below regardless of whether the network
      // call itself succeeded - a failed request here shouldn't strand them.
    }
    await auditApi.logout().catch(() => {});
    setUser(null);
    setAuditServiceWarning(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, auditServiceWarning }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
