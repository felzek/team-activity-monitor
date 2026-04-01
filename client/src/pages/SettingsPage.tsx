import { useState } from "react";
import { LlmProviders } from "@/components/settings/LlmProviders";
import { Connectors } from "@/components/settings/Connectors";
import { WorkspaceSettings } from "@/components/settings/WorkspaceSettings";
import { TeamAccess } from "@/components/settings/TeamAccess";
import { ActivityLog } from "@/components/settings/ActivityLog";

type Section = "integrations" | "workspace" | "team" | "activity";

const NAV: Array<{ id: Section; label: string; icon: React.ReactNode }> = [
  {
    id: "integrations",
    label: "Integrations",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>,
  },
  {
    id: "workspace",
    label: "Workspace",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
  },
  {
    id: "team",
    label: "Team & Access",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>,
  },
  {
    id: "activity",
    label: "Activity",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>,
  },
];

export function SettingsPage() {
  const [section, setSection] = useState<Section>("integrations");

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <p className="settings-sidebar-title">Settings</p>
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`settings-nav-link${section === item.id ? " active" : ""}`}
            onClick={() => setSection(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </aside>

      <div className="settings-content">
        <div className="settings-pane-header">
          <h2>{NAV.find((n) => n.id === section)?.label}</h2>
          <p className="settings-help">
            {section === "integrations" && "Manage LLM providers and data source connectors."}
            {section === "workspace" && "Configure team members and tracked repositories for this workspace."}
            {section === "team" && "Manage who has access to this workspace."}
            {section === "activity" && "Query history and audit trail."}
          </p>
        </div>

        {section === "integrations" && (
          <>
            <LlmProviders />
            <Connectors />
          </>
        )}
        {section === "workspace" && <WorkspaceSettings />}
        {section === "team" && <TeamAccess />}
        {section === "activity" && <ActivityLog />}
      </div>
    </div>
  );
}
