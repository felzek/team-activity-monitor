import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useSessionStore } from "@/store/sessionStore";

interface Connector {
  provider: string;
  enabled: boolean;
  status: string;
  lastValidatedAt: string | null;
}

interface ConnectorsResponse {
  connectors: Connector[];
}

interface ProviderAuthResponse {
  github?: { status: string; displayName?: string; connectedAt?: string };
  jira?: { status: string; displayName?: string; connectedAt?: string };
  google?: { status: string; displayName?: string; connectedAt?: string };
  providerModes?: Record<string, string>;
}

export function Connectors() {
  const { currentOrgId } = useSessionStore();
  const qc = useQueryClient();

  const connectorsQ = useQuery({
    queryKey: ["connectors", currentOrgId],
    queryFn: () => apiFetch<ConnectorsResponse>(`/api/v1/orgs/${currentOrgId}/integrations`),
    enabled: !!currentOrgId,
  });

  const providerAuthQ = useQuery({
    queryKey: ["provider-auth"],
    queryFn: () => apiFetch<Record<string, unknown>>("/api/v1/auth/session").then((s) => (s["providerAuth"] ?? {}) as ProviderAuthResponse),
    staleTime: 30_000,
  });

  const toggleConnector = useMutation({
    mutationFn: ({ provider, enabled }: { provider: string; enabled: boolean }) =>
      apiFetch(`/api/v1/orgs/${currentOrgId}/integrations/${provider}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["connectors"] }),
  });

  const disconnect = useMutation({
    mutationFn: (provider: string) =>
      apiFetch(`/api/v1/auth/providers/${provider}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["provider-auth"] }),
  });

  const connectors = connectorsQ.data?.connectors ?? [];
  const providerAuth = providerAuthQ.data;

  return (
    <div className="settings-group">
      <h3 className="settings-group-title">Data Sources</h3>
      <p className="settings-help">Connect GitHub, Jira, and Google to enable workspace queries.</p>

      {(["github", "jira", "google"] as const).map((provider) => {
        const conn = connectors.find((c) => c.provider === provider);
        const auth = providerAuth?.[provider];
        const isConnected = auth?.status === "connected";
        const mode = providerAuth?.providerModes?.[provider] ?? "unavailable";
        const label = provider === "github" ? "GitHub" : provider === "jira" ? "Jira" : "Google";

        return (
          <div key={provider} className="connector-card">
            <div className="connector-card-header">
              <h4>{label}</h4>
              <span className={`status-pill ${isConnected ? "connected" : "disconnected"}`}>
                {isConnected ? "Connected" : "Not connected"}
              </span>
            </div>

            {isConnected && auth?.displayName && (
              <p className="settings-help" style={{ marginBottom: 8 }}>
                Linked as <strong>{auth.displayName}</strong>
                {auth.connectedAt && ` · ${new Date(auth.connectedAt).toLocaleDateString()}`}
              </p>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {!isConnected ? (
                <button
                  className="btn-primary"
                  disabled={mode === "unavailable"}
                  onClick={() => { window.location.href = `/api/v1/auth/providers/${provider}/start`; }}
                >
                  {mode === "oauth" ? `Connect ${label}` : `${label} OAuth unavailable`}
                </button>
              ) : (
                <button
                  className="btn-secondary"
                  onClick={() => disconnect.mutate(provider)}
                  disabled={disconnect.isPending}
                >
                  Disconnect
                </button>
              )}

              {conn && (
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={conn.enabled}
                    onChange={(e) => toggleConnector.mutate({ provider, enabled: e.target.checked })}
                  />
                  <span>Enabled for queries</span>
                </label>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
