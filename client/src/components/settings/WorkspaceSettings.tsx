import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useSessionStore } from "@/store/sessionStore";

interface OrgSettings {
  teamMembers: unknown[];
  trackedRepos: unknown[];
  name?: string;
  slug?: string;
}

export function WorkspaceSettings() {
  const { currentOrgId } = useSessionStore();
  const [teamJson, setTeamJson] = useState("");
  const [reposJson, setReposJson] = useState("");
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const { data } = useQuery({
    queryKey: ["org-settings", currentOrgId],
    queryFn: () => apiFetch<OrgSettings>(`/api/v1/orgs/${currentOrgId}/settings`),
    enabled: !!currentOrgId,
  });

  useEffect(() => {
    if (data) {
      setTeamJson(JSON.stringify(data.teamMembers ?? [], null, 2));
      setReposJson(JSON.stringify(data.trackedRepos ?? [], null, 2));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: ({ teamMembers, trackedRepos }: { teamMembers: unknown; trackedRepos: unknown }) =>
      apiFetch(`/api/v1/orgs/${currentOrgId}/settings`, {
        method: "PUT",
        body: JSON.stringify({ teamMembers, trackedRepos }),
      }),
    onSuccess: () => setStatus({ type: "success", msg: "Settings saved." }),
    onError: (e: Error) => setStatus({ type: "error", msg: e.message }),
  });

  const handleSave = () => {
    try {
      const teamMembers = JSON.parse(teamJson);
      const trackedRepos = JSON.parse(reposJson);
      save.mutate({ teamMembers, trackedRepos });
    } catch {
      setStatus({ type: "error", msg: "Invalid JSON — check both fields." });
    }
  };

  return (
    <div>
      {data && (
        <div className="settings-group">
          <h3 className="settings-group-title">Organization</h3>
          <div className="org-info-row">
            <div className="org-info-item"><span className="field-label">Name</span><strong>{data.name ?? "—"}</strong></div>
            <div className="org-info-item"><span className="field-label">Slug</span><strong>{data.slug ?? "—"}</strong></div>
            <div className="org-info-item"><span className="field-label">ID</span><code style={{ fontSize: "0.78rem" }}>{currentOrgId}</code></div>
          </div>
        </div>
      )}

      <div className="settings-group">
        <h3 className="settings-group-title">Team members</h3>
        <p className="settings-help">JSON array of team member objects. Changes take effect on the next query.</p>
        <textarea
          className="json-textarea"
          rows={10}
          value={teamJson}
          onChange={(e) => setTeamJson(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Tracked repositories</h3>
        <p className="settings-help">JSON array of repo objects to include in GitHub lookups.</p>
        <textarea
          className="json-textarea"
          rows={8}
          value={reposJson}
          onChange={(e) => setReposJson(e.target.value)}
          spellCheck={false}
        />
      </div>

      {status && (
        <p className={`settings-status ${status.type}`}>{status.msg}</p>
      )}

      <button className="btn-primary" onClick={handleSave} disabled={save.isPending}>
        Save workspace settings
      </button>
    </div>
  );
}
