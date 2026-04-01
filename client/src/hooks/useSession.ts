import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useSessionStore } from "@/store/sessionStore";
import { useEffect } from "react";

interface SessionResponse {
  authenticated: boolean;
  csrfToken: string;
  user?: {
    id: string;
    displayName: string;
    email: string;
  };
  currentOrganization?: {
    id: string;
    name: string;
  };
}

export function useSession() {
  const { setCsrfToken, setCurrentOrgId, setUser, setOrgName } = useSessionStore();

  const query = useQuery({
    queryKey: ["session"],
    queryFn: () => apiFetch<SessionResponse>("/api/v1/auth/session"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (query.data) {
      setCsrfToken(query.data.csrfToken ?? null);
      setCurrentOrgId(query.data.currentOrganization?.id ?? null);
      if (query.data.user) {
        setUser(query.data.user.displayName, query.data.user.email);
      }
      if (query.data.currentOrganization) {
        setOrgName(query.data.currentOrganization.name);
      }
    }
  }, [query.data, setCsrfToken, setCurrentOrgId, setUser, setOrgName]);

  return query;
}
