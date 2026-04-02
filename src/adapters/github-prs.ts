import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { fetchJson } from "../lib/http.js";
import { isWithinTimeframe } from "../query/timeframe.js";
import type { ResolvedTimeframe, TeamMember } from "../types/activity.js";
import type { GitHubAdapterResult } from "../types/github.js";

interface GitHubPullRequestEntry {
  number: number;
  title: string;
  state: string;
  updated_at: string;
  html_url?: string;
  user?: {
    login?: string;
  };
}

function buildGitHubHeaders(config: AppConfig, tokenOverride?: string): HeadersInit {
  return {
    Authorization: `Bearer ${tokenOverride ?? config.githubToken ?? ""}`,
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github+json"
  };
}

export async function fetchGitHubPullRequests(
  config: AppConfig,
  member: TeamMember,
  timeframe: ResolvedTimeframe,
  logger: Logger,
  tokenOverride?: string
): Promise<GitHubAdapterResult> {
  if (!member.githubUsername) {
    return {
      commits: [],
      pullRequests: [],
      recentRepos: []
    };
  }

  const pullRequests = await Promise.all(
    config.trackedRepos.map(async ({ owner, repo }) => {
      const url = new URL(`https://api.github.com/repos/${owner}/${repo}/pulls`);
      url.searchParams.set("state", "all");
      url.searchParams.set("sort", "updated");
      url.searchParams.set("direction", "desc");
      url.searchParams.set("per_page", "30");

      try {
        const response = await fetchJson<GitHubPullRequestEntry[]>(
          url.toString(),
          {
            method: "GET",
            headers: buildGitHubHeaders(config, tokenOverride)
          },
          {
            provider: "github",
            logger
          }
        );

        return response
          .filter((pullRequest) => pullRequest.user?.login === member.githubUsername)
          .filter((pullRequest) => isWithinTimeframe(pullRequest.updated_at, timeframe))
          .map((pullRequest) => ({
            repo: `${owner}/${repo}`,
            number: pullRequest.number,
            title: pullRequest.title,
            state: pullRequest.state,
            updatedAt: pullRequest.updated_at,
            isOpen: pullRequest.state === "open",
            url: pullRequest.html_url
          }));
      } catch (err) {
        // Skip repos that are inaccessible (404, 403) without aborting the whole fetch
        logger.debug({ owner, repo, err }, "Skipping repo — PRs fetch failed");
        return [];
      }
    })
  );

  const flattenedPullRequests = pullRequests.flat().sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );

  const recentRepos = Array.from(
    new Set(flattenedPullRequests.map((pullRequest) => pullRequest.repo))
  );

  return {
    commits: [],
    pullRequests: flattenedPullRequests,
    recentRepos
  };
}
