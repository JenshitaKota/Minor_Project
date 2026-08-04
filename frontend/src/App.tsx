import { Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import PublicVerify from "./pages/PublicVerify";
import Login from "./pages/Login";
import AdminUsers from "./pages/AdminUsers";
import Analytics from "./pages/Analytics";
import { ProtectedRoute } from "./components/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/verify" element={<PublicVerify />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute allow={["ADMIN"]}>
            <AdminUsers />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <Analytics />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
