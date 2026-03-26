import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { loadFixture } from "../lib/fixtures.js";
import { fetchJson } from "../lib/http.js";
import { toErrorMessage } from "../lib/errors.js";
import type { GitHubAdapterResult } from "../types/github.js";
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

function aggregateFixtures(
  config: AppConfig,
  teamMembers: TeamMember[]
): { commits: GitHubCommitRow[]; prs: GitHubPRRow[] } {
  const commits: GitHubCommitRow[] = [];
  const prs: GitHubPRRow[] = [];

  // Fixture data is split: commits in github-commits.*.json, PRs in github-prs.*.json
  const fixtureNames = ["github-commits", "github-prs"] as const;

  for (const member of teamMembers) {
    for (const prefix of fixtureNames) {
      try {
        const result = loadFixture<GitHubAdapterResult>(
          config.fixtureDir,
          `${prefix}.${member.id}.json`
        );
        for (const c of result.commits) {
          commits.push({
            sha: c.sha,
            repo: c.repo,
            message: c.message,
            author: member.displayName,
            authoredAt: c.authoredAt,
            url: c.url ?? null
          });
        }
        for (const pr of result.pullRequests) {
          prs.push({
            number: pr.number,
            repo: pr.repo,
            title: pr.title,
            state: pr.isOpen ? "open" : "closed",
            isOpen: pr.isOpen,
            author: member.displayName,
            updatedAt: pr.updatedAt,
            url: pr.url ?? null
          });
        }
      } catch {
        // fixture missing for this member/prefix, skip silently
      }
    }
  }

  return {
    commits: commits.sort((a, b) => b.authoredAt.localeCompare(a.authoredAt)),
    prs: prs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  };
}

export async function fetchGitHubDashboard(
  config: AppConfig,
  teamMembers: TeamMember[],
  trackedRepos: TrackedRepo[],
  logger: Logger
): Promise<GitHubDashboardData> {
  const now = new Date().toISOString();
  const enabledRepos = trackedRepos.filter((r) => !r.disabled);

  if (config.useRecordedFixtures) {
    const { commits, prs } = aggregateFixtures(config, teamMembers);
    const openPRs = prs.filter((pr) => pr.isOpen);
    const activeRepoSet = new Set([
      ...commits.map((c) => c.repo),
      ...openPRs.map((pr) => pr.repo)
    ]);
    const repoStats: GitHubRepoStat[] = enabledRepos.map(({ owner, repo }) => {
      const fullName = `${owner}/${repo}`;
      return {
        fullName,
        commitCount: commits.filter((c) => c.repo === fullName).length,
        openPRCount: openPRs.filter((pr) => pr.repo === fullName).length,
        lastActivityAt: commits.find((c) => c.repo === fullName)?.authoredAt ?? null
      };
    });
    return {
      health: {
        connected: true,
        mode: "fixture",
        displayName: "Fixture Mode",
        errorMessage: null
      },
      timeframeLabel: "Last 7 days (fixture data)",
      metrics: {
        totalCommits: commits.length,
        openPRs: openPRs.length,
        activeRepos: activeRepoSet.size,
        trackedRepos: enabledRepos.length
      },
      repoStats,
      recentCommits: commits.slice(0, 25),
      openPullRequests: openPRs,
      fetchedAt: now,
      caveats: ["Showing fixture data — live GitHub API calls are disabled in this mode."]
    };
  }

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
