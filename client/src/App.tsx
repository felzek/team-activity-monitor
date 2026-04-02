import { useEffect, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AuthModal } from "@/components/auth/AuthModal";
import { GlobalNav } from "@/components/layout/GlobalNav";
import { useSession, type SessionResponse } from "@/hooks/useSession";
import { IntelligencePage } from "@/pages/IntelligencePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { useSessionStore } from "@/store/sessionStore";

function LoadingShell() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--text-muted)",
        fontSize: "0.875rem",
      }}
    >
      Loading…
    </div>
  );
}

function buildSearch(params: URLSearchParams): string {
  const next = params.toString();
  return next ? `?${next}` : "";
}

function removeAuthParams(
  location: ReturnType<typeof useLocation>,
  navigate: ReturnType<typeof useNavigate>
) {
  const params = new URLSearchParams(location.search);
  ["auth", "invite", "provider_auth", "provider", "message"].forEach((key) => params.delete(key));
  navigate(`${location.pathname}${buildSearch(params)}`, { replace: true });
}

function protectedElement(
  authenticated: boolean,
  element: ReactElement
): ReactElement {
  return authenticated ? element : <Navigate to="/app" replace />;
}

function AppLayout() {
  const session = useSession();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  const authenticated = useSessionStore((state) => state.authenticated);
  const authModalOpen = useSessionStore((state) => state.authModalOpen);
  const authModalMode = useSessionStore((state) => state.authModalMode);
  const openAuthModal = useSessionStore((state) => state.openAuthModal);
  const closeAuthModal = useSessionStore((state) => state.closeAuthModal);

  useEffect(() => {
    if (!session.data) {
      return;
    }

    const params = new URLSearchParams(location.search);
    const requestedMode = params.get("auth");
    if (!session.data.authenticated && (requestedMode === "login" || requestedMode === "register")) {
      openAuthModal(requestedMode);
      return;
    }

    if (session.data.authenticated && authModalOpen) {
      closeAuthModal();
      if (params.has("auth") || params.has("provider_auth") || params.has("provider") || params.has("message")) {
        removeAuthParams(location, navigate);
      }
    }
  }, [
    authModalOpen,
    closeAuthModal,
    location,
    navigate,
    openAuthModal,
    session.data,
  ]);

  const handleLogout = async () => {
    try {
      const csrf = useSessionStore.getState().csrfToken ?? "";
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": csrf, "Content-Type": "application/json" },
        credentials: "same-origin",
      });
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await queryClient.invalidateQueries({ queryKey: ["llm-models"] });
      window.location.href = "/app";
    }
  };

  const handleAuthClose = () => {
    closeAuthModal();
    removeAuthParams(location, navigate);
  };

  const handleAuthModeChange = (mode: "login" | "register") => {
    openAuthModal(mode);
    const params = new URLSearchParams(location.search);
    params.set("auth", mode);
    if (mode !== "register") {
      params.delete("invite");
    }
    navigate(`${location.pathname}${buildSearch(params)}`, { replace: true });
  };

  const handleAuthSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    await queryClient.invalidateQueries({ queryKey: ["llm-models"] });
    closeAuthModal();
    removeAuthParams(location, navigate);
  };

  if (session.isLoading) {
    return <LoadingShell />;
  }

  if (session.isError) {
    return (
      <div className="app-shell">
        <LoadingShell />
      </div>
    );
  }

  const params = new URLSearchParams(location.search);
  const inviteToken = params.get("invite");
  const providerMessage = params.get("message");

  return (
    <div className="app-shell">
      <GlobalNav onLogout={handleLogout} />
      <Routes>
        <Route path="/app" element={<WorkspacePage />} />
        <Route
          path="/intelligence"
          element={protectedElement(authenticated, <IntelligencePage />)}
        />
        <Route path="/settings" element={protectedElement(authenticated, <SettingsPage />)} />
        <Route
          path="/settings/:section"
          element={protectedElement(authenticated, <SettingsPage />)}
        />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>

      <AuthModal
        open={!authenticated && authModalOpen}
        mode={authModalMode}
        session={session.data as SessionResponse | undefined}
        inviteToken={inviteToken}
        providerMessage={providerMessage}
        onClose={handleAuthClose}
        onModeChange={handleAuthModeChange}
        onAuthenticated={handleAuthSuccess}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
