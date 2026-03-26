import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { fetchGitHubCommits } from "../adapters/github-commits.js";
import { fetchGitHubPullRequests } from "../adapters/github-prs.js";
import { fetchJiraActivity } from "../adapters/jira.js";
import { ProviderError, toErrorMessage } from "../lib/errors.js";
import type {
  ActivitySummary,
  IdentityResolution,
  ParsedQuery,
  ProviderName,
  ProviderStatus
} from "../types/activity.js";

function makeSkippedProviderStatus(
  provider: ProviderName,
  message: string
): ProviderStatus {
  return {
    provider,
    ok: false,
    partial: false,
    latencyMs: 0,
    errorCode: "SKIPPED",
    message
  };
}

async function runProvider<T>(
  provider: ProviderName,
  logger: Logger,
  action: () => Promise<T>
): Promise<{ status: ProviderStatus; data: T | null }> {
  const startedAt = Date.now();

  try {
    const data = await action();
    return {
      status: {
        provider,
        ok: true,
        partial: false,
        latencyMs: Date.now() - startedAt
      },
      data
    };
  } catch (error) {
    const providerError =
      error instanceof ProviderError
        ? error
        : new ProviderError(provider, toErrorMessage(error), {
            code: `${provider.toUpperCase()}_UNKNOWN`,
            statusCode: 502,
            retryable: false,
            cause: error
          });

    logger.warn(
      {
        provider,
        code: providerError.code,
        statusCode: providerError.statusCode,
        message: providerError.message
      },
      "Provider request failed"
    );

    return {
      status: {
        provider,
        ok: false,
        partial: false,
        latencyMs: Date.now() - startedAt,
        errorCode: providerError.code,
        message: providerError.message
      },
      data: null
    };
  }
}

export interface TokenOverrides {
  githubToken?: string;
  jiraToken?: string;
  jiraSiteId?: string;
}

export async function buildActivitySummary(
  config: AppConfig,
  parsedQuery: ParsedQuery,
  identity: IdentityResolution,
  logger: Logger,
  tokenOverrides?: TokenOverrides
): Promise<ActivitySummary> {
  const selectedMember = identity.member;

  const summary: ActivitySummary = {
    member: {
      displayName: selectedMember?.displayName ?? "Unknown teammate",
      id: selectedMember?.id,
      jiraAccountId: selectedMember?.jiraAccountId,
      githubUsername: selectedMember?.githubUsername,
      queryText: parsedQuery.memberText
    },
    intent: parsedQuery.intent,
    timeframe: parsedQuery.timeframe,
    needsClarification: identity.needsClarification,
    clarificationReason: identity.clarificationReason,
    jira: {
      status: makeSkippedProviderStatus("jira", "Skipped until a team member is resolved."),
      data: {
        issues: [],
        recentUpdateCount: 0
      }
    },
    github: {
      status: makeSkippedProviderStatus("github", "Skipped until a team member is resolved."),
      data: {
        commits: [],
        pullRequests: [],
        recentRepos: []
      }
    },
    caveats: []
  };

  if (!selectedMember) {
    summary.caveats.push(identity.clarificationReason ?? "A team member match is required.");
    return summary;
  }

  const jiraRequested = parsedQuery.requestedSources.includes("jira");
  const githubRequested = parsedQuery.requestedSources.includes("github");

  const [jiraResult, githubCommitsResult, githubPullRequestsResult] = await Promise.all([
    jiraRequested
      ? runProvider("jira", logger, () =>
          fetchJiraActivity(config, selectedMember, parsedQuery.timeframe, logger, {
            jiraToken: tokenOverrides?.jiraToken,
            jiraSiteId: tokenOverrides?.jiraSiteId
          })
        )
      : Promise.resolve({
          status: {
            provider: "jira" as const,
            ok: true,
            partial: false,
            latencyMs: 0,
            errorCode: undefined,
            message: "Not requested."
          } satisfies ProviderStatus,
          data: {
            issues: [],
            recentUpdateCount: 0
          }
        }),
    githubRequested
      ? runProvider("github", logger, () =>
          fetchGitHubCommits(
            config,
            selectedMember,
            parsedQuery.timeframe,
            logger,
            tokenOverrides?.githubToken
          )
        )
      : Promise.resolve({
          status: {
            provider: "github" as const,
            ok: true,
            partial: false,
            latencyMs: 0,
            errorCode: undefined,
            message: "Not requested."
          } satisfies ProviderStatus,
          data: {
            commits: [],
            pullRequests: [],
            recentRepos: []
          }
        }),
    githubRequested
      ? runProvider("github", logger, () =>
          fetchGitHubPullRequests(
            config,
            selectedMember,
            parsedQuery.timeframe,
            logger,
            tokenOverrides?.githubToken
          )
        )
      : Promise.resolve({
          status: {
            provider: "github" as const,
            ok: true,
            partial: false,
            latencyMs: 0,
            errorCode: undefined,
            message: "Not requested."
          } satisfies ProviderStatus,
          data: {
            commits: [],
            pullRequests: [],
            recentRepos: []
          }
        })
  ]);

  summary.jira.status = jiraResult.status;
  summary.jira.data = jiraResult.data ?? {
    issues: [],
    recentUpdateCount: 0
  };

  const combinedGitHubStatus: ProviderStatus = {
    provider: "github",
    ok: githubCommitsResult.status.ok || githubPullRequestsResult.status.ok,
    partial:
      githubCommitsResult.status.ok !== githubPullRequestsResult.status.ok ||
      githubCommitsResult.status.partial ||
      githubPullRequestsResult.status.partial,
    latencyMs: Math.max(
      githubCommitsResult.status.latencyMs,
      githubPullRequestsResult.status.latencyMs
    ),
    errorCode:
      !githubCommitsResult.status.ok || !githubPullRequestsResult.status.ok
        ? [githubCommitsResult.status.errorCode, githubPullRequestsResult.status.errorCode]
            .filter(Boolean)
            .join(",")
        : undefined,
    message:
      !githubCommitsResult.status.ok || !githubPullRequestsResult.status.ok
        ? [githubCommitsResult.status.message, githubPullRequestsResult.status.message]
            .filter(Boolean)
            .join(" ")
        : undefined
  };

  summary.github.status = combinedGitHubStatus;
  summary.github.data = {
    commits: githubCommitsResult.data?.commits ?? [],
    pullRequests: githubPullRequestsResult.data?.pullRequests ?? [],
    recentRepos: Array.from(
      new Set([
        ...(githubCommitsResult.data?.recentRepos ?? []),
        ...(githubPullRequestsResult.data?.recentRepos ?? [])
      ])
    )
  };

  if (!summary.jira.status.ok) {
    summary.caveats.push(
      `Jira data was unavailable: ${summary.jira.status.message ?? "Unknown Jira error."}`
    );
  }

  if (!summary.github.status.ok) {
    summary.caveats.push(
      `GitHub data was unavailable: ${summary.github.status.message ?? "Unknown GitHub error."}`
    );
  } else if (summary.github.status.partial) {
    summary.caveats.push(
      `GitHub results are partial: ${summary.github.status.message ?? "One GitHub lookup failed."}`
    );
  }

  if (!selectedMember.githubUsername && githubRequested) {
    summary.caveats.push(
      `${selectedMember.displayName} does not have a configured GitHub username, so GitHub activity may be incomplete.`
    );
  }

  return summary;
}
