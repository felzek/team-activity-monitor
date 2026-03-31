/**
 * Tool executor for the tool-first chat pipeline.
 *
 * Each tool call from the LLM is routed here. Results are cached
 * with TTLs appropriate to the data source. Partial failures return
 * a structured error rather than throwing — the pipeline can still
 * synthesize a partial answer.
 *
 * Data flow per tool call:
 *   1. Validate arguments against known parameter names
 *   2. Check cache — return hit with freshness metadata if present
 *   3. Fetch live data from the adapter
 *   4. Store in cache with appropriate TTL + tags
 *   5. Return { data, meta } to the LLM
 */

import type { Logger } from "pino";

import { fetchGitHubCommits } from "../../adapters/github-commits.js";
import { fetchGitHubPullRequests } from "../../adapters/github-prs.js";
import { fetchJiraActivity } from "../../adapters/jira.js";
import type { AppConfig } from "../../config.js";
import type { AppDatabase } from "../../db.js";
import { resolveIdentity } from "../../query/identity.js";
import type { TeamMember } from "../../types/activity.js";
import { CACHE_TTL, ActivityCache, cacheKey, cacheTag } from "../cache.js";

/** Build a minimal ResolvedTimeframe for tool executor calls using a since date string. */
function buildTimeframe(since: string, timezone: string) {
  return {
    kind: "trailing_days" as const,
    label: `since ${since}`,
    start: `${since}T00:00:00.000Z`,
    end: new Date().toISOString(),
    timezone
  };
}

export interface ToolResultMeta {
  fetchedAt: string;
  source: "live" | "cached";
  cacheAgeMs?: number;
  provider: "jira" | "github" | "internal";
  itemCount?: number;
  latencyMs?: number;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  /** JSON-serializable data returned to the LLM */
  output: unknown;
  meta: ToolResultMeta;
  /** Present on partial failures — LLM can use this to state caveats */
  error?: string;
}

export interface ToolExecutorContext {
  userId: string;
  organizationId: string;
  timezone: string;
  githubToken?: string;
  jiraToken?: string;
  jiraSiteId?: string;
  teamMembers: TeamMember[];
  config: AppConfig;
  database: AppDatabase;
  logger: Logger;
  cache: ActivityCache;
}

export async function executeToolCall(
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
  ctx: ToolExecutorContext
): Promise<ToolResult> {
  const start = Date.now();

  try {
    switch (toolName) {
      case "resolve_person":
        return await executeResolvePerson(toolCallId, args, ctx, start);
      case "search_jira_issues":
        return await executeSearchJiraIssues(toolCallId, args, ctx, start);
      case "get_github_commits":
        return await executeGetGitHubCommits(toolCallId, args, ctx, start);
      case "get_github_prs":
        return await executeGetGitHubPRs(toolCallId, args, ctx, start);
      case "list_active_repos":
        return executeListActiveRepos(toolCallId, ctx, start);
      case "get_team_members":
        return executeGetTeamMembers(toolCallId, ctx, start);
      case "summarize_team_activity":
        return await executeSummarizeTeamActivity(toolCallId, args, ctx, start);
      default:
        return {
          toolCallId,
          toolName,
          output: null,
          meta: { fetchedAt: new Date().toISOString(), source: "live" as const, provider: "internal" as const },
          error: `Unknown tool: ${toolName}`
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.warn({ toolName, args, err: message }, "Tool execution failed");
    return {
      toolCallId,
      toolName,
      output: null,
      meta: {
        fetchedAt: new Date().toISOString(),
        source: "live",
        provider: "internal",
        latencyMs: Date.now() - start
      },
      error: message
    };
  }
}

// ── resolve_person ────────────────────────────────────────────────────────────

async function executeResolvePerson(
  toolCallId: string,
  args: Record<string, unknown>,
  ctx: ToolExecutorContext,
  start: number
): Promise<ToolResult> {
  const name = String(args["name"] ?? "");

  const key = cacheKey.identity(ctx.organizationId, name.toLowerCase());
  const cached = ctx.cache.get<unknown>(key);
  if (cached) {
    return {
      toolCallId,
      toolName: "resolve_person",
      output: cached.data,
      meta: {
        fetchedAt: cached.fetchedAt,
        source: "cached",
        cacheAgeMs: cached.cacheAgeMs,
        provider: "internal",
        latencyMs: Date.now() - start
      }
    };
  }

  const resolution = resolveIdentity(name, name, ctx.teamMembers);
  const output = resolution.member
    ? {
        found: true,
        member: {
          id: resolution.member.id,
          displayName: resolution.member.displayName,
          jiraAccountId: resolution.member.jiraAccountId ?? null,
          githubUsername: resolution.member.githubUsername ?? null,
          aliases: resolution.member.aliases
        }
      }
    : {
        found: false,
        needsClarification: resolution.needsClarification,
        reason: resolution.clarificationReason,
        candidates: resolution.candidates.map((c) => ({
          displayName: c.displayName,
          id: c.id
        }))
      };

  ctx.cache.set(key, output, CACHE_TTL.IDENTITY_RESOLUTION, [
    cacheTag.orgIdentity(ctx.organizationId)
  ]);

  return {
    toolCallId,
    toolName: "resolve_person",
    output,
    meta: {
      fetchedAt: new Date().toISOString(),
      source: "live",
      provider: "internal",
      latencyMs: Date.now() - start
    }
  };
}

// ── search_jira_issues ────────────────────────────────────────────────────────

async function executeSearchJiraIssues(
  toolCallId: string,
  args: Record<string, unknown>,
  ctx: ToolExecutorContext,
  start: number
): Promise<ToolResult> {
  const accountId = String(args["jira_account_id"] ?? "");
  const since = String(args["since"] ?? new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10));

  if (!accountId) {
    return {
      toolCallId,
      toolName: "search_jira_issues",
      output: null,
      meta: { fetchedAt: new Date().toISOString(), source: "live", provider: "jira" },
      error: "jira_account_id is required"
    };
  }

  const key = cacheKey.jiraIssues(accountId, since);
  const cached = ctx.cache.get<unknown>(key);
  if (cached) {
    return {
      toolCallId,
      toolName: "search_jira_issues",
      output: cached.data,
      meta: {
        fetchedAt: cached.fetchedAt,
        source: "cached",
        cacheAgeMs: cached.cacheAgeMs,
        provider: "jira",
        latencyMs: Date.now() - start
      }
    };
  }

  // Find team member entry that has this jira account id
  const member = ctx.teamMembers.find((m) => m.jiraAccountId === accountId) ?? {
    id: accountId,
    displayName: accountId,
    aliases: [],
    jiraAccountId: accountId
  };

  const overriddenTimeframe = buildTimeframe(since, ctx.timezone);

  const result = await fetchJiraActivity(ctx.config, member, overriddenTimeframe, ctx.logger, {
    jiraToken: ctx.jiraToken,
    jiraSiteId: ctx.jiraSiteId
  });

  const output = {
    accountId,
    issues: result.issues,
    totalFound: result.issues.length,
    recentUpdateCount: result.recentUpdateCount
  };

  ctx.cache.set(key, output, CACHE_TTL.JIRA_ISSUES, [cacheTag.jiraIssues(accountId)]);

  return {
    toolCallId,
    toolName: "search_jira_issues",
    output,
    meta: {
      fetchedAt: new Date().toISOString(),
      source: "live",
      provider: "jira",
      itemCount: result.issues.length,
      latencyMs: Date.now() - start
    }
  };
}

// ── get_github_commits ────────────────────────────────────────────────────────

async function executeGetGitHubCommits(
  toolCallId: string,
  args: Record<string, unknown>,
  ctx: ToolExecutorContext,
  start: number
): Promise<ToolResult> {
  const username = String(args["github_username"] ?? "");
  const since = String(args["since"] ?? new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10));

  if (!username) {
    return {
      toolCallId,
      toolName: "get_github_commits",
      output: null,
      meta: { fetchedAt: new Date().toISOString(), source: "live", provider: "github" },
      error: "github_username is required"
    };
  }

  // Aggregate across all tracked repos — cache per-repo
  const repos = ctx.config.trackedRepos;
  if (repos.length === 0) {
    return {
      toolCallId,
      toolName: "get_github_commits",
      output: { commits: [], totalFound: 0, message: "No tracked repositories configured." },
      meta: { fetchedAt: new Date().toISOString(), source: "live", provider: "github", itemCount: 0 }
    };
  }

  const cacheKeyFull = cacheKey.githubCommits(username, "all", since);
  const cached = ctx.cache.get<unknown>(cacheKeyFull);
  if (cached) {
    return {
      toolCallId,
      toolName: "get_github_commits",
      output: cached.data,
      meta: {
        fetchedAt: cached.fetchedAt,
        source: "cached",
        cacheAgeMs: cached.cacheAgeMs,
        provider: "github",
        latencyMs: Date.now() - start
      }
    };
  }

  const member = { id: username, displayName: username, aliases: [], githubUsername: username };
  const overridden = buildTimeframe(since, ctx.timezone);

  const result = await fetchGitHubCommits(ctx.config, member, overridden, ctx.logger, ctx.githubToken);

  const output = {
    username,
    commits: result.commits,
    totalFound: result.commits.length,
    reposQueried: repos.map((r) => `${r.owner}/${r.repo}`)
  };

  const tags = repos.map((r) => cacheTag.githubCommits(`${r.owner}/${r.repo}`));
  ctx.cache.set(cacheKeyFull, output, CACHE_TTL.GITHUB_COMMITS, tags);

  return {
    toolCallId,
    toolName: "get_github_commits",
    output,
    meta: {
      fetchedAt: new Date().toISOString(),
      source: "live",
      provider: "github",
      itemCount: result.commits.length,
      latencyMs: Date.now() - start
    }
  };
}

// ── get_github_prs ────────────────────────────────────────────────────────────

async function executeGetGitHubPRs(
  toolCallId: string,
  args: Record<string, unknown>,
  ctx: ToolExecutorContext,
  start: number
): Promise<ToolResult> {
  const username = String(args["github_username"] ?? "");
  const since = String(args["since"] ?? new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10));

  if (!username) {
    return {
      toolCallId,
      toolName: "get_github_prs",
      output: null,
      meta: { fetchedAt: new Date().toISOString(), source: "live", provider: "github" },
      error: "github_username is required"
    };
  }

  const repos = ctx.config.trackedRepos;
  if (repos.length === 0) {
    return {
      toolCallId,
      toolName: "get_github_prs",
      output: { pullRequests: [], totalFound: 0, message: "No tracked repositories configured." },
      meta: { fetchedAt: new Date().toISOString(), source: "live", provider: "github", itemCount: 0 }
    };
  }

  const cacheKeyFull = cacheKey.githubPrs(username, "all", since);
  const cached = ctx.cache.get<unknown>(cacheKeyFull);
  if (cached) {
    return {
      toolCallId,
      toolName: "get_github_prs",
      output: cached.data,
      meta: {
        fetchedAt: cached.fetchedAt,
        source: "cached",
        cacheAgeMs: cached.cacheAgeMs,
        provider: "github",
        latencyMs: Date.now() - start
      }
    };
  }

  const member = { id: username, displayName: username, aliases: [], githubUsername: username };
  const overridden = buildTimeframe(since, ctx.timezone);

  const result = await fetchGitHubPullRequests(ctx.config, member, overridden, ctx.logger, ctx.githubToken);

  const output = {
    username,
    pullRequests: result.pullRequests,
    totalFound: result.pullRequests.length,
    reposQueried: repos.map((r) => `${r.owner}/${r.repo}`)
  };

  const tags = repos.map((r) => cacheTag.githubPrs(`${r.owner}/${r.repo}`));
  ctx.cache.set(cacheKeyFull, output, CACHE_TTL.GITHUB_PRS, tags);

  return {
    toolCallId,
    toolName: "get_github_prs",
    output,
    meta: {
      fetchedAt: new Date().toISOString(),
      source: "live",
      provider: "github",
      itemCount: result.pullRequests.length,
      latencyMs: Date.now() - start
    }
  };
}

// ── list_active_repos ─────────────────────────────────────────────────────────

function executeListActiveRepos(
  toolCallId: string,
  ctx: ToolExecutorContext,
  start: number
): ToolResult {
  return {
    toolCallId,
    toolName: "list_active_repos",
    output: {
      repos: ctx.config.trackedRepos.map((r) => ({
        fullName: `${r.owner}/${r.repo}`,
        owner: r.owner,
        repo: r.repo
      })),
      totalCount: ctx.config.trackedRepos.length
    },
    meta: {
      fetchedAt: new Date().toISOString(),
      source: "live",
      provider: "internal",
      itemCount: ctx.config.trackedRepos.length,
      latencyMs: Date.now() - start
    }
  };
}

// ── get_team_members ──────────────────────────────────────────────────────────

function executeGetTeamMembers(
  toolCallId: string,
  ctx: ToolExecutorContext,
  start: number
): ToolResult {
  return {
    toolCallId,
    toolName: "get_team_members",
    output: {
      members: ctx.teamMembers.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        aliases: m.aliases,
        githubUsername: m.githubUsername ?? null,
        hasJiraAccountId: Boolean(m.jiraAccountId)
      })),
      totalCount: ctx.teamMembers.length
    },
    meta: {
      fetchedAt: new Date().toISOString(),
      source: "live",
      provider: "internal",
      itemCount: ctx.teamMembers.length,
      latencyMs: Date.now() - start
    }
  };
}

// ── summarize_team_activity ───────────────────────────────────────────────────

async function executeSummarizeTeamActivity(
  toolCallId: string,
  args: Record<string, unknown>,
  ctx: ToolExecutorContext,
  start: number
): Promise<ToolResult> {
  const since = String(args["since"] ?? new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10));

  const overridden = buildTimeframe(since, ctx.timezone);

  const memberSummaries = await Promise.all(
    ctx.teamMembers.slice(0, 10).map(async (member) => {
      const [jiraResult, commitsResult, prsResult] = await Promise.allSettled([
        member.jiraAccountId
          ? fetchJiraActivity(ctx.config, member, overridden, ctx.logger, {
              jiraToken: ctx.jiraToken,
              jiraSiteId: ctx.jiraSiteId
            })
          : Promise.resolve(null),
        member.githubUsername
          ? fetchGitHubCommits(ctx.config, member, overridden, ctx.logger, ctx.githubToken)
          : Promise.resolve(null),
        member.githubUsername
          ? fetchGitHubPullRequests(ctx.config, member, overridden, ctx.logger, ctx.githubToken)
          : Promise.resolve(null)
      ]);

      return {
        member: member.displayName,
        jiraIssues: jiraResult.status === "fulfilled" && jiraResult.value ? jiraResult.value.issues.length : null,
        commits: commitsResult.status === "fulfilled" && commitsResult.value ? commitsResult.value.commits.length : null,
        prs: prsResult.status === "fulfilled" && prsResult.value ? prsResult.value.pullRequests.length : null
      };
    })
  );

  return {
    toolCallId,
    toolName: "summarize_team_activity",
    output: {
      since,
      teamSummary: memberSummaries,
      totalMembers: ctx.teamMembers.length
    },
    meta: {
      fetchedAt: new Date().toISOString(),
      source: "live",
      provider: "internal",
      latencyMs: Date.now() - start
    }
  };
}
