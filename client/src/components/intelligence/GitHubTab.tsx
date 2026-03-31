import { useState } from "react";
import { Skeleton } from "@/components/common/Skeleton";
import type { IntelligenceBoard } from "@/api/types";

interface Props {
  data: IntelligenceBoard | undefined;
  isLoading: boolean;
  error: Error | null;
}

type SubTab = "commits" | "prs" | "repos";

export function GitHubTab({ data, isLoading, error }: Props) {
  const [sub, setSub] = useState<SubTab>("commits");

  if (isLoading) return <div style={{ padding: 8 }}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={32} style={{ marginBottom: 6 }} />)}</div>;
  if (error) return <div className="error-state">Failed to load GitHub data.<br /><small>{error.message}</small></div>;

  const gh = data?.github as Record<string, unknown> | null;
  if (!gh) return <div className="error-state">GitHub not connected</div>;

  const commits = (gh.commits as Commit[] | undefined) ?? [];
  const prs = (gh.pullRequests as PR[] | undefined) ?? [];
  const repos = (gh.repositories as Repo[] | undefined) ?? [];

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {(["commits", "prs", "repos"] as SubTab[]).map((t) => (
          <button
            key={t}
            className={`filter-chip${sub === t ? " active" : ""}`}
            onClick={() => setSub(t)}
          >
            {t === "commits" ? `Commits (${commits.length})` : t === "prs" ? `PRs (${prs.length})` : `Repos (${repos.length})`}
          </button>
        ))}
      </div>

      {sub === "commits" && <CommitsTable commits={commits} />}
      {sub === "prs" && <PrsTable prs={prs} />}
      {sub === "repos" && <ReposTable repos={repos} />}
    </div>
  );
}

interface Commit { sha: string; message: string; author: string; date: string; url?: string; repo?: string }
interface PR { number: number; title: string; author: string; state: string; url?: string; repo?: string; updatedAt?: string }
interface Repo { name: string; url?: string; stars?: number; language?: string; updatedAt?: string }

function CommitsTable({ commits }: { commits: Commit[] }) {
  if (commits.length === 0) return <Empty msg="No commits in this period" />;
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr><th>Commit</th><th>Author</th><th>Repo</th><th>Date</th></tr>
        </thead>
        <tbody>
          {commits.slice(0, 50).map((c) => (
            <tr key={c.sha}>
              <td>
                {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer">{c.message.slice(0, 72)}</a> : c.message.slice(0, 72)}
              </td>
              <td>{c.author}</td>
              <td>{c.repo ?? "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDate(c.date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrsTable({ prs }: { prs: PR[] }) {
  if (prs.length === 0) return <Empty msg="No pull requests in this period" />;
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr><th>#</th><th>Title</th><th>Author</th><th>Status</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {prs.slice(0, 50).map((pr) => (
            <tr key={pr.number}>
              <td style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>#{pr.number}</td>
              <td>
                {pr.url ? <a href={pr.url} target="_blank" rel="noopener noreferrer">{pr.title}</a> : pr.title}
              </td>
              <td>{pr.author}</td>
              <td><StateBadge state={pr.state} /></td>
              <td style={{ whiteSpace: "nowrap" }}>{pr.updatedAt ? fmtDate(pr.updatedAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReposTable({ repos }: { repos: Repo[] }) {
  if (repos.length === 0) return <Empty msg="No repositories found" />;
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr><th>Repository</th><th>Language</th><th>Stars</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {repos.slice(0, 50).map((r) => (
            <tr key={r.name}>
              <td>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a> : r.name}</td>
              <td>{r.language ?? "—"}</td>
              <td>{r.stars ?? "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>{r.updatedAt ? fmtDate(r.updatedAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const color = state === "open" ? "#22c55e" : state === "merged" ? "#6e40c9" : "var(--text-muted)";
  return <span style={{ color, fontWeight: 500, fontSize: "0.78rem" }}>{state}</span>;
}

function Empty({ msg }: { msg: string }) {
  return <div className="error-state">{msg}</div>;
}

function fmtDate(s: string) {
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}
