import { Skeleton } from "@/components/common/Skeleton";
import { useIntelStore } from "@/store/intelStore";
import type { IntelligenceOverview, ActivityItem, BlockerItem } from "@/api/types";

interface Props {
  data: IntelligenceOverview | undefined;
  isLoading: boolean;
  error: Error | null;
  onAskAbout: (text: string) => void;
}

export function OverviewTab({ data, isLoading, error, onAskAbout }: Props) {
  if (isLoading) return <OverviewSkeleton />;
  if (error) return <div className="error-state">Failed to load intelligence data.<br /><small>{error.message}</small></div>;
  if (!data) return null;

  const { summary, recentActivity, blockers, sourceHealth } = data;

  return (
    <div>
      {/* KPIs */}
      <div className="kpi-grid">
        <KpiCard value={summary.commits} label="Commits" />
        <KpiCard value={summary.openPRs} label="Open PRs" />
        <KpiCard value={summary.openIssues} label="Open Issues" />
        <KpiCard value={summary.inProgress} label="In Progress" />
        <KpiCard value={summary.activeRepos} label="Active Repos" />
        <KpiCard value={summary.recentlyUpdated} label="Updated" />
      </div>

      {/* Activity feed */}
      <div className="section-label">Recent activity</div>
      <div className="activity-feed">
        {recentActivity.length === 0 ? (
          <span className="muted" style={{ fontSize: "0.82rem" }}>No activity in this period</span>
        ) : (
          recentActivity.map((item) => (
            <ActivityFeedItem key={item.id} item={item} onAskAbout={onAskAbout} />
          ))
        )}
      </div>

      {/* Blockers */}
      {blockers.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 8 }}>Blockers</div>
          <div className="blockers-list">
            {blockers.map((b) => (
              <BlockerCard key={b.id} item={b} onAskAbout={onAskAbout} />
            ))}
          </div>
        </>
      )}

      {/* Source health */}
      <div className="source-health-row" style={{ marginTop: 8 }}>
        <SourcePill name="GitHub" health={sourceHealth.github} />
        <SourcePill name="Jira" health={sourceHealth.jira} />
        {data.fetchedAt && (
          <span className="muted" style={{ fontSize: "0.72rem", marginLeft: "auto" }}>
            Updated {new Date(data.fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}

function KpiCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function ActivityFeedItem({ item, onAskAbout }: { item: ActivityItem; onAskAbout: (t: string) => void }) {
  const relTime = timeAgo(item.timestamp);

  return (
    <div
      className="activity-item"
      role="button"
      tabIndex={0}
      onClick={() => onAskAbout(`Tell me about: ${item.title}`)}
      onKeyDown={(e) => e.key === "Enter" && onAskAbout(`Tell me about: ${item.title}`)}
      title="Click to ask about this"
    >
      <div className={`activity-source-dot ${item.source}`} />
      <span className="activity-title">{item.title}</span>
      <span className="activity-meta">{relTime}</span>
    </div>
  );
}

function BlockerCard({ item, onAskAbout }: { item: BlockerItem; onAskAbout: (t: string) => void }) {
  return (
    <div
      className="blocker-card"
      role="button"
      tabIndex={0}
      onClick={() => onAskAbout(`Why is this blocked: ${item.title}`)}
      onKeyDown={(e) => e.key === "Enter" && onAskAbout(`Why is this blocked: ${item.title}`)}
    >
      <div className="blocker-card-header">
        <span className={`blocker-badge ${item.type === "stale_pr" ? "stale-pr" : "overdue"}`}>
          {item.type === "stale_pr" ? "Stale PR" : "Overdue"}
        </span>
        <span className="blocker-age">{item.ageLabel}</span>
      </div>
      <div className="blocker-title">{item.title}</div>
    </div>
  );
}

function SourcePill({ name, health }: { name: string; health: { staleness: string; connected: boolean } }) {
  return (
    <div className={`source-pill ${health.staleness}`}>
      <div className="source-pill-dot" />
      {name}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div>
      <div className="kpi-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="kpi-card"><Skeleton height={40} /></div>
        ))}
      </div>
      <Skeleton height={12} width={100} style={{ marginBottom: 10 }} />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} height={30} style={{ marginBottom: 6, borderRadius: 7 }} />
      ))}
    </div>
  );
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
