import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { fetchJson } from "../lib/http.js";
import { toErrorMessage } from "../lib/errors.js";
import type { JiraIssueActivity, TeamMember } from "../types/activity.js";
import type {
  ConnectionHealth,
  JiraDashboardData,
  JiraIssueRow,
  JiraProjectStat,
  JiraStatusCategory
} from "../types/dashboard.js";

interface JiraSearchIssue {
  key: string;
  fields: {
    summary?: string;
    updated?: string;
    status?: {
      name?: string;
      statusCategory?: { key?: string };
    };
    priority?: { name?: string };
    issuetype?: { name?: string };
    assignee?: { displayName?: string } | null;
  };
}

interface JiraSearchResponse {
  issues: JiraSearchIssue[];
}

interface JiraProject {
  key: string;
  name: string;
}

function buildJiraAuthHeader(config: AppConfig): string {
  return `Basic ${Buffer.from(
    `${config.jiraEmail ?? ""}:${config.jiraApiToken ?? ""}`
  ).toString("base64")}`;
}

function mapStatusCategory(key?: string): JiraStatusCategory {
  switch (key) {
    case "new":
      return "todo";
    case "indeterminate":
      return "inprogress";
    case "done":
      return "done";
    default:
      return "unknown";
  }
}

function guessStatusCategory(statusName: string): JiraStatusCategory {
  const lower = statusName.toLowerCase();
  if (["in progress", "in review", "review", "doing", "in development"].some((s) => lower.includes(s))) {
    return "inprogress";
  }
  if (["done", "closed", "resolved", "complete", "released", "won't fix"].some((s) => lower.includes(s))) {
    return "done";
  }
  if (["to do", "open", "backlog", "new", "todo", "pending"].some((s) => lower.includes(s))) {
    return "todo";
  }
  return "unknown";
}

function unavailableHealth(reason: string): ConnectionHealth {
  return { connected: false, mode: "unavailable", displayName: null, errorMessage: reason };
}

function issueRowFromApi(issue: JiraSearchIssue, jiraBaseUrl: string): JiraIssueRow {
  return {
    key: issue.key,
    summary: issue.fields.summary ?? "(untitled)",
    status: issue.fields.status?.name ?? "Unknown",
    statusCategory: mapStatusCategory(issue.fields.status?.statusCategory?.key),
    issueType: issue.fields.issuetype?.name ?? null,
    priority: issue.fields.priority?.name ?? null,
    assignee: issue.fields.assignee?.displayName ?? null,
    updated: issue.fields.updated ?? new Date().toISOString(),
    url: `${jiraBaseUrl}/browse/${issue.key}`
  };
}

function dedupeByKey(issues: JiraIssueRow[]): JiraIssueRow[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    if (seen.has(i.key)) return false;
    seen.add(i.key);
    return true;
  });
}

export async function fetchJiraDashboard(
  config: AppConfig,
  teamMembers: TeamMember[],
  logger: Logger
): Promise<JiraDashboardData> {
  const now = new Date().toISOString();

  if (!config.jiraBaseUrl || !config.jiraApiToken || !config.jiraEmail) {
    return {
      health: unavailableHealth(
        "Jira credentials are not configured (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN required)."
      ),
      timeframeLabel: "Last 7 days",
      metrics: { openIssues: 0, inProgress: 0, recentlyUpdated: 0, projects: 0 },
      openIssues: [],
      recentlyUpdated: [],
      projects: [],
      fetchedAt: now,
      caveats: [
        "Jira credentials are not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN to enable this dashboard."
      ]
    };
  }

  const baseUrl = config.jiraBaseUrl;
  const authHeader = buildJiraAuthHeader(config);
  const caveats: string[] = [];

  const jsonHeaders = {
    Authorization: authHeader,
    "Content-Type": "application/json"
  };

  const [openResponse, recentResponse, projectList] = await Promise.all([
    fetchJson<JiraSearchResponse>(
      `${baseUrl}/rest/api/3/search/jql`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          jql: "statusCategory != Done ORDER BY updated DESC",
          maxResults: 50,
          fields: ["summary", "status", "priority", "updated", "issuetype", "assignee"],
          fieldsByKeys: false
        })
      },
      { provider: "jira", logger }
    ).catch((err) => {
      logger.warn({ error: toErrorMessage(err) }, "Failed to fetch open Jira issues");
      caveats.push(`Open issues unavailable: ${toErrorMessage(err)}`);
      return { issues: [] } as JiraSearchResponse;
    }),

    fetchJson<JiraSearchResponse>(
      `${baseUrl}/rest/api/3/search/jql`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          jql: "updated >= -7d ORDER BY updated DESC",
          maxResults: 30,
          fields: ["summary", "status", "priority", "updated", "issuetype", "assignee"],
          fieldsByKeys: false
        })
      },
      { provider: "jira", logger }
    ).catch((err) => {
      logger.warn({ error: toErrorMessage(err) }, "Failed to fetch recently updated Jira issues");
      caveats.push(`Recent updates unavailable: ${toErrorMessage(err)}`);
      return { issues: [] } as JiraSearchResponse;
    }),

    fetchJson<JiraProject[]>(
      `${baseUrl}/rest/api/3/project?maxResults=20`,
      { method: "GET", headers: { Authorization: authHeader } },
      { provider: "jira", logger }
    ).catch((err) => {
      logger.warn({ error: toErrorMessage(err) }, "Failed to fetch Jira project list");
      caveats.push(`Project list unavailable: ${toErrorMessage(err)}`);
      return [] as JiraProject[];
    })
  ]);

  const openIssues = openResponse.issues.map((i) => issueRowFromApi(i, baseUrl));
  const recentlyUpdated = recentResponse.issues.map((i) => issueRowFromApi(i, baseUrl));
  const inProgress = openIssues.filter((i) => i.statusCategory === "inprogress");

  const openProjectKeys = new Set(openIssues.map((i) => i.key.split("-")[0]));
  const projects: JiraProjectStat[] = projectList
    .filter((p) => openProjectKeys.has(p.key) || projectList.length <= 5)
    .map((p) => ({
      key: p.key,
      name: p.name,
      openIssueCount: openIssues.filter((i) => i.key.startsWith(`${p.key}-`)).length
    }));

  return {
    health: {
      connected: true,
      mode: "workspace_token",
      displayName: baseUrl,
      errorMessage: null
    },
    timeframeLabel: "Last 7 days",
    metrics: {
      openIssues: openIssues.length,
      inProgress: inProgress.length,
      recentlyUpdated: recentlyUpdated.length,
      projects: projects.length
    },
    openIssues,
    recentlyUpdated,
    projects,
    fetchedAt: now,
    caveats
  };
}
