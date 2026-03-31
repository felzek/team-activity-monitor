import { useState } from "react";
import { Link } from "react-router-dom";
import { IntelFilterBar } from "./IntelFilterBar";
import { OverviewTab } from "./OverviewTab";
import { GitHubTab } from "./GitHubTab";
import { JiraTab } from "./JiraTab";
import { useIntelOverview } from "@/hooks/useIntelOverview";
import { useIntelBoard } from "@/hooks/useIntelBoard";
import { useIntelStore } from "@/store/intelStore";
import { useSessionStore } from "@/store/sessionStore";

type Tab = "overview" | "github" | "jira";

interface Props {
  /** compact = embedded in split pane; full = full-page board */
  variant?: "compact" | "full";
  onAskAbout?: (text: string) => void;
}

export function IntelPane({ variant = "compact", onAskAbout }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const { currentOrgId } = useSessionStore();
  const boardUrl = useIntelStore((s) => s.boardUrl);

  const overviewQ = useIntelOverview(currentOrgId);
  const boardQ = useIntelBoard(tab !== "overview" ? currentOrgId : null);

  const handleAskAbout = (text: string) => {
    if (onAskAbout) {
      onAskAbout(text);
    }
  };

  return (
    <div className="intel-pane">
      <div className="intel-pane-header">
        <div className="intel-pane-title-row">
          <span className="intel-pane-title">Intelligence</span>
          {variant === "compact" && (
            <Link to={boardUrl()} className="btn-ghost" style={{ fontSize: "0.78rem" }}>
              Full board ↗
            </Link>
          )}
          {variant === "full" && overviewQ.data?.fetchedAt && (
            <span className="intel-pane-meta">
              Updated {new Date(overviewQ.data.fetchedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        <IntelFilterBar />

        <div className="intel-tab-bar">
          {(["overview", "github", "jira"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`intel-tab${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="intel-tab-content">
        {tab === "overview" && (
          <OverviewTab
            data={overviewQ.data}
            isLoading={overviewQ.isLoading}
            error={overviewQ.error}
            onAskAbout={handleAskAbout}
          />
        )}
        {tab === "github" && (
          <GitHubTab
            data={boardQ.data}
            isLoading={boardQ.isLoading}
            error={boardQ.error}
          />
        )}
        {tab === "jira" && (
          <JiraTab
            data={boardQ.data}
            isLoading={boardQ.isLoading}
            error={boardQ.error}
          />
        )}
      </div>
    </div>
  );
}
