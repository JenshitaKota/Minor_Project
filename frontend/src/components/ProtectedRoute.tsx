import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";

interface Props {
  children: ReactNode;
  allow?: Role[];
}

export function ProtectedRoute({ children, allow }: Props) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allow && !allow.includes(user.role)) {
    return (
      <div className="panel" style={{ margin: 32 }}>
        <p className="empty-state">You don't have access to this page.</p>
      </div>
    );
  }

  return <>{children}</>;
}
