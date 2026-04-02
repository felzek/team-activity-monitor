import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useSessionStore } from "@/store/sessionStore";
import { useEffect } from "react";
import type { GuestAccess } from "@/api/types";

export interface SessionResponse {
  authenticated: boolean;
  csrfToken: string | null;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  currentOrganization?: {
    id: string;
    name: string;
  };
  guestAccess: GuestAccess | null;
  llmProviderKeys: Array<{
    provider: "openai" | "gemini" | "claude";
    savedAt: string;
  }>;
  providerAuth: {
    providerModes: Record<"github" | "jira" | "google", "oauth" | "unavailable">;
  };
}

export function useSession() {
  const setSession = useSessionStore((state) => state.setSession);

  const query = useQuery({
    queryKey: ["session"],
    queryFn: () => apiFetch<SessionResponse>("/api/v1/auth/session"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (query.data) {
      setSession({
        authenticated: query.data.authenticated,
        csrfToken: query.data.csrfToken ?? null,
        currentOrgId: query.data.currentOrganization?.id ?? null,
        userDisplayName: query.data.user?.name ?? null,
        userEmail: query.data.user?.email ?? null,
        orgName: query.data.currentOrganization?.name ?? null,
        guestAccess: query.data.guestAccess ?? null,
      });
    }
  }, [query.data, setSession]);

  return query;
}
