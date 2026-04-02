import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { fetchJson } from "../lib/http.js";
import { isWithinTimeframe } from "../query/timeframe.js";
import type { JiraIssueChange, ResolvedTimeframe, TeamMember } from "../types/activity.js";
import type { JiraAdapterResult } from "../types/jira.js";

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    fields: {
      summary?: string;
      updated?: string;
      status?: { name?: string };
      priority?: { name?: string };
      issuetype?: { name?: string };
    };
  }>;
}

interface JiraUserSearchResponseEntry {
  accountId: string;
  displayName: string;
}

interface JiraChangelogResponse {
  values: Array<{
    created: string;
    author?: {
      displayName?: string;
    };
    items?: Array<{
      field?: string;
      fromString?: string;
      toString?: string;
    }>;
  }>;
}

function buildJiraAuthHeader(config: AppConfig, jiraToken?: string): string {
  if (jiraToken) {
    return `Bearer ${jiraToken}`;
  }
  return `Basic ${Buffer.from(
    `${config.jiraEmail ?? ""}:${config.jiraApiToken ?? ""}`
  ).toString("base64")}`;
}

function buildJiraApiBase(config: AppConfig, jiraSiteId?: string): string {
  if (jiraSiteId) {
    // Atlassian OAuth API: access via cloud ID
    return `https://api.atlassian.com/ex/jira/${jiraSiteId}`;
  }
  return (config.jiraBaseUrl ?? "").replace(/\/$/, "");
}

async function resolveJiraAccountId(
  config: AppConfig,
  member: TeamMember,
  logger: Logger,
  jiraToken?: string,
  jiraSiteId?: string
): Promise<{ accountId: string; displayName: string }> {
  if (member.jiraAccountId) {
    return {
      accountId: member.jiraAccountId,
      displayName: member.displayName
    };
  }

  const apiBase = buildJiraApiBase(config, jiraSiteId);
  const query = encodeURIComponent(member.jiraQuery ?? member.displayName);
  const url = `${apiBase}/rest/api/3/user/search?query=${query}&maxResults=10`;
  const users = await fetchJson<JiraUserSearchResponseEntry[]>(
    url,
    {
      method: "GET",
      headers: {
        Authorization: buildJiraAuthHeader(config, jiraToken)
      }
    },
    {
      provider: "jira",
      logger
    }
  );

  const exactMatch =
    users.find(
      (user) =>
        user.displayName.toLowerCase() ===
        (member.jiraQuery ?? member.displayName).toLowerCase()
    ) ?? users[0];

  if (!exactMatch) {
    throw new Error(`No Jira user found for ${member.displayName}.`);
  }

  return {
    accountId: exactMatch.accountId,
    displayName: exactMatch.displayName
  };
}

async function fetchIssueChanges(
  config: AppConfig,
  issueKey: string,
  logger: Logger,
  jiraToken?: string,
  jiraSiteId?: string
): Promise<JiraIssueChange[]> {
  const apiBase = buildJiraApiBase(config, jiraSiteId);
  const url = `${apiBase}/rest/api/3/issue/${issueKey}/changelog?maxResults=10`;
  const changelog = await fetchJson<JiraChangelogResponse>(
    url,
    {
      method: "GET",
      headers: {
        Authorization: buildJiraAuthHeader(config, jiraToken)
      }
    },
    {
      provider: "jira",
      logger
    }
  );

  return changelog.values.flatMap((entry) =>
    (entry.items ?? []).map((item) => ({
      at: entry.created,
      field: item.field ?? "unknown",
      from: item.fromString,
      to: item.toString,
      author: entry.author?.displayName
    }))
  );
}

export async function fetchJiraActivity(
  config: AppConfig,
  member: TeamMember,
  timeframe: ResolvedTimeframe,
  logger: Logger,
  tokens?: { jiraToken?: string; jiraSiteId?: string }
): Promise<JiraAdapterResult> {
  const jiraToken = tokens?.jiraToken;
  const jiraSiteId = tokens?.jiraSiteId;
  const apiBase = buildJiraApiBase(config, jiraSiteId);

  const identity = await resolveJiraAccountId(config, member, logger, jiraToken, jiraSiteId);
  // Include all issues updated within the timeframe — "not done" filter alone misses recently completed work
  const sinceDate = timeframe.start.slice(0, 10); // YYYY-MM-DD
  const jql = `assignee = "${identity.accountId}" AND updated >= "${sinceDate}" ORDER BY updated DESC`;

  const searchResponse = await fetchJson<JiraSearchResponse>(
    `${apiBase}/rest/api/3/search/jql`,
    {
      method: "POST",
      headers: {
        Authorization: buildJiraAuthHeader(config, jiraToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jql,
        maxResults: 10,
        fields: ["summary", "status", "priority", "updated", "issuetype", "assignee"],
        fieldsByKeys: false,
        failFast: true
      })
    },
    {
      provider: "jira",
      logger
    }
  );

  const topIssues = searchResponse.issues.slice(0, 10);
  const issuesWithChanges = await Promise.all(
    topIssues.map(async (issue, index) => {
      const recentChanges =
        index < 5 ? await fetchIssueChanges(config, issue.key, logger, jiraToken, jiraSiteId) : [];

      return {
        key: issue.key,
        summary: issue.fields.summary ?? "Untitled issue",
        status: issue.fields.status?.name ?? "Unknown",
        priority: issue.fields.priority?.name,
        issueType: issue.fields.issuetype?.name,
        updated: issue.fields.updated ?? timeframe.start,
        url: config.jiraBaseUrl ? `${config.jiraBaseUrl}/browse/${issue.key}` : undefined,
        recentChanges
      };
    })
  );

  const recentUpdateCount = issuesWithChanges.reduce((count, issue) => {
    const hasRecentChange =
      isWithinTimeframe(issue.updated, timeframe) ||
      issue.recentChanges.some((change) => isWithinTimeframe(change.at, timeframe));

    return count + (hasRecentChange ? 1 : 0);
  }, 0);

  return {
    accountId: identity.accountId,
    displayName: identity.displayName,
    issues: issuesWithChanges,
    recentUpdateCount
  };
}
