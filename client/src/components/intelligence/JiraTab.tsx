import { useState } from "react";
import { Skeleton } from "@/components/common/Skeleton";
import type { IntelligenceBoard } from "@/api/types";

interface Props {
  data: IntelligenceBoard | undefined;
  isLoading: boolean;
  error: Error | null;
}

type SubTab = "open" | "recent" | "projects";

export function JiraTab({ data, isLoading, error }: Props) {
  const [sub, setSub] = useState<SubTab>("open");

  if (isLoading) return <div style={{ padding: 8 }}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={32} style={{ marginBottom: 6 }} />)}</div>;
  if (error) return <div className="error-state">Failed to load Jira data.<br /><small>{error.message}</small></div>;

  const jira = data?.jira as Record<string, unknown> | null;
  if (!jira) return <div className="error-state">Jira not connected</div>;

  const open = (jira.openIssues as Issue[] | undefined) ?? [];
  const recent = (jira.recentIssues as Issue[] | undefined) ?? [];
  const projects = (jira.projects as Project[] | undefined) ?? [];

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {(["open", "recent", "projects"] as SubTab[]).map((t) => (
          <button
            key={t}
            className={`filter-chip${sub === t ? " active" : ""}`}
            onClick={() => setSub(t)}
          >
            {t === "open" ? `Open (${open.length})` : t === "recent" ? `Recent (${recent.length})` : `Projects (${projects.length})`}
          </button>
        ))}
      </div>

      {sub === "open" && <IssueTable issues={open} />}
      {sub === "recent" && <IssueTable issues={recent} />}
      {sub === "projects" && <ProjectTable projects={projects} />}
    </div>
  );
}

interface Issue { key: string; summary: string; status: string; assignee?: string; priority?: string; url?: string; updatedAt?: string }
interface Project { key: string; name: string; url?: string; issueCount?: number }

function IssueTable({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return <div className="error-state">No issues found</div>;
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr><th>Key</th><th>Summary</th><th>Status</th><th>Assignee</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {issues.slice(0, 50).map((i) => (
            <tr key={i.key}>
              <td style={{ whiteSpace: "nowrap" }}>
                {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer">{i.key}</a> : i.key}
              </td>
              <td>{i.summary}</td>
              <td><StatusBadge status={i.status} /></td>
              <td>{i.assignee ?? "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>{i.updatedAt ? fmtDate(i.updatedAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectTable({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return <div className="error-state">No projects found</div>;
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr><th>Key</th><th>Name</th><th>Issues</th></tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.key}>
              <td>{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer">{p.key}</a> : p.key}</td>
              <td>{p.name}</td>
              <td>{p.issueCount ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const color = lower.includes("done") || lower.includes("closed") ? "#22c55e"
    : lower.includes("progress") ? "#0052cc"
    : "var(--text-muted)";
  return <span style={{ color, fontWeight: 500, fontSize: "0.78rem" }}>{status}</span>;
}

function fmtDate(s: string) {
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}
