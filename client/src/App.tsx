import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { GlobalNav } from "@/components/layout/GlobalNav";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { IntelligencePage } from "@/pages/IntelligencePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { useSession } from "@/hooks/useSession";
import { useSessionStore } from "@/store/sessionStore";

function SessionGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useSession();

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "0.875rem" }}>
        Loading…
      </div>
    );
  }

  if (isError || (data && !data.authenticated)) {
    window.location.href = "/login";
    return null;
  }

  return <>{children}</>;
}

function AppLayout() {
  const handleLogout = async () => {
    try {
      const csrf = useSessionStore.getState().csrfToken ?? "";
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": csrf, "Content-Type": "application/json" },
        credentials: "same-origin",
      });
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <div className="app-shell">
      <GlobalNav onLogout={handleLogout} />
      <Routes>
        <Route path="/app" element={<WorkspacePage />} />
        <Route path="/intelligence" element={<IntelligencePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionGate>
        <AppLayout />
      </SessionGate>
    </BrowserRouter>
  );
}
