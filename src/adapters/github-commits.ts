import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { fetchJson } from "../lib/http.js";
import type { ResolvedTimeframe, TeamMember } from "../types/activity.js";
import type { GitHubAdapterResult } from "../types/github.js";

interface GitHubCommitResponseEntry {
  sha: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: {
      date?: string;
    };
  };
}

function buildGitHubHeaders(config: AppConfig, tokenOverride?: string): HeadersInit {
  return {
    Authorization: `Bearer ${tokenOverride ?? config.githubToken ?? ""}`,
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github+json"
  };
}

export async function fetchGitHubCommits(
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

  const commits = await Promise.all(
    config.trackedRepos.map(async ({ owner, repo }) => {
      const url = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
      url.searchParams.set("author", member.githubUsername!);
      url.searchParams.set("since", timeframe.start);
      url.searchParams.set("per_page", "20");

      try {
        const response = await fetchJson<GitHubCommitResponseEntry[]>(
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

        return response.map((commit) => ({
          repo: `${owner}/${repo}`,
          sha: commit.sha.slice(0, 7),
          message: commit.commit?.message?.split("\n")[0] ?? "No commit message",
          authoredAt: commit.commit?.author?.date ?? timeframe.start,
          url: commit.html_url
        }));
      } catch (err) {
        // Skip repos that are inaccessible (404, 403) without aborting the whole fetch
        logger.debug({ owner, repo, err }, "Skipping repo — commits fetch failed");
        return [];
      }
    })
  );

  const flattenedCommits = commits.flat().sort((left, right) =>
    right.authoredAt.localeCompare(left.authoredAt)
  );

  const recentRepos = Array.from(new Set(flattenedCommits.map((commit) => commit.repo)));

  return {
    commits: flattenedCommits,
    pullRequests: [],
    recentRepos
  };
}
