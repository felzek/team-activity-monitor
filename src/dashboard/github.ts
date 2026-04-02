import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { fetchJson } from "../lib/http.js";
import { toErrorMessage } from "../lib/errors.js";
import type { TeamMember, TrackedRepo } from "../types/activity.js";
import type {
  ConnectionHealth,
  GitHubCommitRow,
  GitHubDashboardData,
  GitHubPRRow,
  GitHubRepoStat
} from "../types/dashboard.js";

interface GitHubApiCommit {
  sha: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
  };
}

interface GitHubApiPR {
  number: number;
  title?: string;
  state?: string;
  html_url?: string;
  updated_at?: string;
  merged_at?: string | null;
  user?: { login?: string };
}

function buildGitHubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github+json"
  };
}

function sevenDaysAgo(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function unavailableHealth(reason: string): ConnectionHealth {
  return { connected: false, mode: "unavailable", displayName: null, errorMessage: reason };
}

export async function fetchGitHubDashboard(
  config: AppConfig,
  teamMembers: TeamMember[],
  trackedRepos: TrackedRepo[],
  logger: Logger
): Promise<GitHubDashboardData> {
  const now = new Date().toISOString();
  const enabledRepos = trackedRepos.filter((r) => !r.disabled);

  if (!config.githubToken) {
    return {
      health: unavailableHealth(
        "GitHub token is not configured. Set GITHUB_TOKEN to enable this dashboard."
      ),
      timeframeLabel: "Last 7 days",
      metrics: { totalCommits: 0, openPRs: 0, activeRepos: 0, trackedRepos: enabledRepos.length },
      repoStats: [],
      recentCommits: [],
      openPullRequests: [],
      fetchedAt: now,
      caveats: [
        "GitHub token is not configured. Add the GITHUB_TOKEN environment variable to enable this dashboard."
      ]
    };
  }

  const since = sevenDaysAgo();
  const headers = buildGitHubHeaders(config.githubToken);
  const caveats: string[] = [];

  const repoResults = await Promise.all(
    enabledRepos.map(async ({ owner, repo }) => {
      const fullName = `${owner}/${repo}`;

      const [rawCommits, rawPRs] = await Promise.all([
        fetchJson<GitHubApiCommit[]>(
          `https://api.github.com/repos/${owner}/${repo}/commits?since=${since}&per_page=50`,
          { method: "GET", headers },
          { provider: "github", logger }
        ).catch((err) => {
          logger.warn({ repo: fullName, error: toErrorMessage(err) }, "Failed to fetch commits");
          caveats.push(`Commits unavailable for ${fullName}.`);
          return [] as GitHubApiCommit[];
        }),
        fetchJson<GitHubApiPR[]>(
          `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=50&sort=updated&direction=desc`,
          { method: "GET", headers },
          { provider: "github", logger }
        ).catch((err) => {
          logger.warn({ repo: fullName, error: toErrorMessage(err) }, "Failed to fetch PRs");
          caveats.push(`Pull requests unavailable for ${fullName}.`);
          return [] as GitHubApiPR[];
        })
      ]);

      const commits: GitHubCommitRow[] = rawCommits.map((c) => ({
        sha: c.sha.slice(0, 7),
        repo: fullName,
        message: c.commit?.message?.split("\n")[0] ?? "(no message)",
        author: c.commit?.author?.name ?? null,
        authoredAt: c.commit?.author?.date ?? since,
        url: c.html_url ?? null
      }));

      const prs: GitHubPRRow[] = rawPRs.map((pr) => ({
        number: pr.number,
        repo: fullName,
        title: pr.title ?? "(untitled)",
        state: "open" as const,
        isOpen: true,
        author: pr.user?.login ?? null,
        updatedAt: pr.updated_at ?? since,
        url: pr.html_url ?? null
      }));

      return { fullName, commits, prs };
    })
  );

  const allCommits = repoResults
    .flatMap((r) => r.commits)
    .sort((a, b) => b.authoredAt.localeCompare(a.authoredAt));

  const allPRs = repoResults
    .flatMap((r) => r.prs)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const activeRepoSet = new Set(allCommits.map((c) => c.repo));

  const repoStats: GitHubRepoStat[] = repoResults.map(({ fullName, commits, prs }) => ({
    fullName,
    commitCount: commits.length,
    openPRCount: prs.length,
    lastActivityAt: commits[0]?.authoredAt ?? null
  }));

  return {
    health: {
      connected: true,
      mode: "workspace_token",
      displayName: "GitHub",
      errorMessage: null
    },
    timeframeLabel: "Last 7 days",
    metrics: {
      totalCommits: allCommits.length,
      openPRs: allPRs.length,
      activeRepos: activeRepoSet.size,
      trackedRepos: enabledRepos.length
    },
    repoStats,
    recentCommits: allCommits.slice(0, 25),
    openPullRequests: allPRs,
    fetchedAt: now,
    caveats
  };
}
