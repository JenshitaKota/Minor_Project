import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Role, User } from "../types";

const ROLES: Role[] = ["ADMIN", "OPERATOR", "QA_MANAGER", "AUDITOR"];

export default function AdminUsers() {
  const [users, setUsers] = useState<(User & { createdAt: string })[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("OPERATOR");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function loadUsers() {
    api.listUsers().then(setUsers).catch((err) => setError(err.message));
  }

  useEffect(loadUsers, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createUser(email, password, name, role);
      setEmail("");
      setName("");
      setPassword("");
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="app-header">
        <div>
          <h1>User Management</h1>
          <span className="tagline">Admin only</span>
        </div>
        <Link to="/" className="nav-link">
          ← Back to dashboard
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="layout">
        <div className="panel">
          <h2>Users</h2>
          <table className="content-table">
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="value-cell">
                    {u.email}
                    <div className="hash">{u.role}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Create User</h2>
          <form onSubmit={handleCreate}>
            <div className="form-field">
              <label htmlFor="name">Name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="new-email">Email</label>
              <input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="new-password">Password</label>
              <input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="role">Role</label>
              <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? "Creating..." : "Create User"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
