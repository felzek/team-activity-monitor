/**
 * Intelligence API routes.
 *
 * GET /api/v1/orgs/:orgId/intelligence/overview
 *   Compact payload for the homepage inline panel.
 *   Returns: summary counts, up to 5 activity items, up to 3 blockers, source health.
 *
 * GET /api/v1/orgs/:orgId/intelligence/board
 *   Full payload: everything in overview + raw GitHubDashboardData + JiraDashboardData.
 *   Used by the React intelligence board in place of two separate dashboard fetches.
 *
 * Both accept optional query params:
 *   ?person=alice   (informational; filters not yet applied server-side)
 *   ?timeRange=7d   (1d | 7d | 14d | 30d)
 *   ?sources=github,jira
 *
 * A stale PR is open and not updated for ≥ 3 days.
 * An overdue issue is in-progress and not updated for ≥ 7 days.
 */

import express from "express";
import type { Logger } from "pino";

import { requireAuth, requireOrganization } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { fetchGitHubDashboard } from "../dashboard/github.js";
import { fetchJiraDashboard } from "../dashboard/jira.js";
import type {
  GitHubDashboardData,
  JiraDashboardData,
} from "../types/dashboard.js";

// ── View-model contracts (mirrored in intel-state.js / intel-overview.js) ─────

export interface FilterState {
  person: string | null;
  timeRange: "1d" | "7d" | "14d" | "30d";
  sources: ("github" | "jira")[];
}

export interface ActivityItem {
  id: string;
  source: "github" | "jira";
  type: "commit" | "pr" | "issue";
  title: string;
  subtitle: string;
  url: string | null;
  author: string;
  timestamp: string;
}

export interface BlockerItem {
  id: string;
  source: "github" | "jira";
  type: "stale_pr" | "overdue_issue";
  title: string;
  ageLabel: string;
  url: string | null;
}

export interface SourceHealthSummary {
  connected: boolean;
  lastSyncedAt: string | null;
  staleness: "fresh" | "stale" | "disconnected";
  error: string | null;
}

export interface IntelligenceOverview {
  filter: FilterState;
  summary: {
    commits: number;
    openPRs: number;
    openIssues: number;
    inProgress: number;
    activeRepos: number;
    recentlyUpdated: number;
  };
  recentActivity: ActivityItem[];
  blockers: BlockerItem[];
  sourceHealth: {
    github: SourceHealthSummary;
    jira: SourceHealthSummary;
  };
  fetchedAt: string;
}

export interface IntelligenceBoard extends IntelligenceOverview {
  github: GitHubDashboardData | null;
  jira: JiraDashboardData | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STALE_PR_MS   = 3 * 24 * 60 * 60 * 1000;  // 3 days
const OVERDUE_MS    = 7 * 24 * 60 * 60 * 1000;   // 7 days
const STALE_SYNC_MS = 30 * 60 * 1000;             // 30 min = "stale" health

function ageDays(isoStr: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(isoStr).getTime()) / 86_400_000));
}

function ageLabel(isoStr: string): string {
  const d = ageDays(isoStr);
  if (d === 0) return "today";
  if (d === 1) return "1 day old";
  return `${d} days old`;
}

function toSourceHealth(data: GitHubDashboardData | JiraDashboardData | null): SourceHealthSummary {
  if (!data) return { connected: false, lastSyncedAt: null, staleness: "disconnected", error: null };
  const staleMs = data.fetchedAt
    ? Date.now() - new Date(data.fetchedAt).getTime()
    : Infinity;
  return {
    connected: data.health.connected,
    lastSyncedAt: data.fetchedAt ?? null,
    staleness: !data.health.connected ? "disconnected"
             : staleMs > STALE_SYNC_MS ? "stale"
             : "fresh",
    error: data.health.errorMessage,
  };
}

function buildActivityItems(
  github: GitHubDashboardData | null,
  jira: JiraDashboardData | null,
  limit: number,
): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (github?.health.connected) {
    for (const c of github.recentCommits) {
      items.push({
        id: `gh-commit-${c.sha}`,
        source: "github", type: "commit",
        title: c.message, subtitle: c.repo,
        url: c.url, author: c.author ?? "unknown",
        timestamp: c.authoredAt,
      });
    }
    for (const pr of github.openPullRequests) {
      items.push({
        id: `gh-pr-${pr.repo}-${pr.number}`,
        source: "github", type: "pr",
        title: pr.title, subtitle: `${pr.repo} #${pr.number}`,
        url: pr.url, author: pr.author ?? "unknown",
        timestamp: pr.updatedAt,
      });
    }
  }

  if (jira?.health.connected) {
    for (const issue of jira.recentlyUpdated) {
      items.push({
        id: `jira-${issue.key}`,
        source: "jira", type: "issue",
        title: issue.summary, subtitle: `${issue.key} · ${issue.status}`,
        url: issue.url, author: issue.assignee ?? "unassigned",
        timestamp: issue.updated,
      });
    }
  }

  return items
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

function buildBlockers(
  github: GitHubDashboardData | null,
  jira: JiraDashboardData | null,
  limit: number,
): BlockerItem[] {
  type Candidate = BlockerItem & { _ts: string };
  const candidates: Candidate[] = [];
  const now = Date.now();

  if (github?.health.connected) {
    for (const pr of github.openPullRequests) {
      if (now - new Date(pr.updatedAt).getTime() >= STALE_PR_MS) {
        candidates.push({
          id: `stale-pr-${pr.repo}-${pr.number}`,
          source: "github", type: "stale_pr",
          title: pr.title, ageLabel: ageLabel(pr.updatedAt), url: pr.url,
          _ts: pr.updatedAt,
        });
      }
    }
  }

  if (jira?.health.connected) {
    for (const issue of jira.openIssues) {
      if (
        issue.statusCategory === "inprogress" &&
        now - new Date(issue.updated).getTime() >= OVERDUE_MS
      ) {
        candidates.push({
          id: `overdue-${issue.key}`,
          source: "jira", type: "overdue_issue",
          title: issue.summary, ageLabel: ageLabel(issue.updated), url: issue.url,
          _ts: issue.updated,
        });
      }
    }
  }

  return candidates
    .sort((a, b) => a._ts.localeCompare(b._ts)) // oldest first = most urgent
    .slice(0, limit)
    .map(({ _ts: _ignored, ...rest }) => rest);
}

function parseFilter(query: express.Request["query"]): FilterState {
  const VALID_RANGES = ["1d", "7d", "14d", "30d"] as const;
  const timeRange = VALID_RANGES.includes(query.timeRange as typeof VALID_RANGES[number])
    ? (query.timeRange as FilterState["timeRange"])
    : "7d";
  const rawSources = String(query.sources ?? "github,jira").split(",");
  const sources = rawSources.filter((s): s is "github" | "jira" =>
    s === "github" || s === "jira"
  );
  return {
    person: typeof query.person === "string" && query.person ? query.person : null,
    timeRange,
    sources: sources.length ? sources : ["github", "jira"],
  };
}

function buildOverview(
  github: GitHubDashboardData | null,
  jira: JiraDashboardData | null,
  filter: FilterState,
  activityLimit: number,
  blockerLimit: number,
): IntelligenceOverview {
  return {
    filter,
    summary: {
      commits:          github?.health.connected ? github.metrics.totalCommits    : 0,
      openPRs:          github?.health.connected ? github.metrics.openPRs         : 0,
      openIssues:       jira?.health.connected   ? jira.metrics.openIssues        : 0,
      inProgress:       jira?.health.connected   ? jira.metrics.inProgress        : 0,
      activeRepos:      github?.health.connected ? github.metrics.activeRepos     : 0,
      recentlyUpdated:  jira?.health.connected   ? jira.metrics.recentlyUpdated   : 0,
    },
    recentActivity: buildActivityItems(github, jira, activityLimit),
    blockers:       buildBlockers(github, jira, blockerLimit),
    sourceHealth: {
      github: toSourceHealth(github),
      jira:   toSourceHealth(jira),
    },
    fetchedAt: new Date().toISOString(),
  };
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createIntelligenceRouter(
  config: AppConfig,
  database: AppDatabase,
  logger: Logger,
): express.Router {
  const router = express.Router();

  async function loadBoth(
    organizationId: string,
  ): Promise<[GitHubDashboardData | null, JiraDashboardData | null]> {
    const orgSettings = database.getOrganizationSettings(organizationId);
    const execConfig = { ...config, ...orgSettings };

    const [gh, jira] = await Promise.allSettled([
      fetchGitHubDashboard(execConfig, orgSettings.teamMembers, orgSettings.trackedRepos, logger),
      fetchJiraDashboard(execConfig, orgSettings.teamMembers, logger),
    ]);

    return [
      gh.status    === "fulfilled" ? gh.value    : null,
      jira.status  === "fulfilled" ? jira.value  : null,
    ];
  }

  function orgId(req: express.Request): string {
    return (Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId) as string;
  }

  /**
   * GET /api/v1/orgs/:orgId/intelligence/overview
   * Compact payload — homepage panel.
   */
  router.get(
    "/api/v1/orgs/:orgId/intelligence/overview",
    requireAuth,
    requireOrganization(database),
    async (req: express.Request, res: express.Response) => {
      const [github, jira] = await loadBoth(orgId(req));
      res.json(buildOverview(github, jira, parseFilter(req.query), 5, 3));
    },
  );

  /**
   * GET /api/v1/orgs/:orgId/intelligence/board
   * Full payload — intelligence board.
   */
  router.get(
    "/api/v1/orgs/:orgId/intelligence/board",
    requireAuth,
    requireOrganization(database),
    async (req: express.Request, res: express.Response) => {
      const [github, jira] = await loadBoth(orgId(req));
      const board: IntelligenceBoard = {
        ...buildOverview(github, jira, parseFilter(req.query), 10, 5),
        github,
        jira,
      };
      res.json(board);
    },
  );

  return router;
}
