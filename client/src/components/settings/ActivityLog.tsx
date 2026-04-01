import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useSessionStore } from "@/store/sessionStore";
import { Skeleton } from "@/components/common/Skeleton";

interface QueryRun {
  id: string;
  query: string;
  modelId?: string;
  createdAt: string;
}

interface AuditEvent {
  id: string;
  eventType: string;
  actorName?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export function ActivityLog() {
  const { currentOrgId } = useSessionStore();

  const historyQ = useQuery({
    queryKey: ["query-history", currentOrgId],
    queryFn: () => apiFetch<{ queryRuns: QueryRun[] }>(`/api/v1/orgs/${currentOrgId}/query-runs`),
    enabled: !!currentOrgId,
    select: (d) => d.queryRuns,
  });

  const auditQ = useQuery({
    queryKey: ["audit-events", currentOrgId],
    queryFn: () => apiFetch<{ events: AuditEvent[] }>(`/api/v1/orgs/${currentOrgId}/audit-events`),
    enabled: !!currentOrgId,
    select: (d) => d.events,
  });

  return (
    <div>
      <div className="settings-group">
        <h3 className="settings-group-title">Recent queries</h3>
        {historyQ.isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...Array(3)].map((_, i) => <Skeleton key={i} height={40} />)}
          </div>
        ) : !historyQ.data?.length ? (
          <p className="settings-help">No queries yet.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Query</th><th>Model</th><th>When</th></tr></thead>
              <tbody>
                {historyQ.data.map((r) => (
                  <tr key={r.id}>
                    <td style={{ maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.query}
                    </td>
                    <td style={{ color: "var(--text-muted)" }}>{r.modelId ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Audit log</h3>
        {auditQ.isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...Array(3)].map((_, i) => <Skeleton key={i} height={40} />)}
          </div>
        ) : !auditQ.data?.length ? (
          <p className="settings-help">No audit events yet.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Event</th><th>Actor</th><th>When</th></tr></thead>
              <tbody>
                {auditQ.data.map((e) => (
                  <tr key={e.id}>
                    <td><code style={{ fontSize: "0.78rem" }}>{e.eventType}</code></td>
                    <td>{e.actorName ?? "System"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
