/**
 * Tool definitions for the tool-first chat pipeline.
 *
 * Each tool maps to a live data fetch or an identity lookup.
 * These are the JSON Schema definitions passed to the LLM; the
 * corresponding implementations live in executor.ts.
 *
 * Design rule: tools fetch live data. They never read from embeddings or
 * stale caches for work-status questions.
 */

export interface ToolParameterSchema {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameterSchema>;
    required: string[];
  };
}

/**
 * resolve_person — fuzzy-match a name/alias to a known team member.
 * Always call this first when a human name is mentioned.
 * Returns jiraAccountId and githubUsername needed by downstream tools.
 */
const resolvePerson: ToolDefinition = {
  name: "resolve_person",
  description:
    "Resolve a person's name or alias to their canonical team member identity, " +
    "including their Jira account ID and GitHub username. " +
    "Call this first whenever a human name appears in the query. " +
    "Returns null if no match is found — do not guess.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name, username, or alias to resolve, e.g. 'John', 'felzek', 'sarah lee'"
      }
    },
    required: ["name"]
  }
};

/**
 * search_jira_issues — live Jira search for a specific assignee.
 */
const searchJiraIssues: ToolDefinition = {
  name: "search_jira_issues",
  description:
    "Search Jira for issues assigned to a specific person within a date range. " +
    "Returns issue keys, summaries, statuses, priorities, and recent changelog entries. " +
    "Requires the Jira account ID from resolve_person.",
  parameters: {
    type: "object",
    properties: {
      jira_account_id: {
        type: "string",
        description: "The Jira account ID from resolve_person result"
      },
      since: {
        type: "string",
        description: "ISO 8601 date string (YYYY-MM-DD) for the start of the date range"
      },
      max_results: {
        type: "string",
        description: "Maximum number of issues to return, default '10', max '25'"
      }
    },
    required: ["jira_account_id", "since"]
  }
};

/**
 * get_github_commits — fetch recent commits for a GitHub user across tracked repos.
 */
const getGitHubCommits: ToolDefinition = {
  name: "get_github_commits",
  description:
    "Fetch recent GitHub commits authored by a specific user across all tracked repositories. " +
    "Returns commit SHA, message, repository, and timestamp. " +
    "Requires the GitHub username from resolve_person.",
  parameters: {
    type: "object",
    properties: {
      github_username: {
        type: "string",
        description: "The GitHub username from resolve_person result"
      },
      since: {
        type: "string",
        description: "ISO 8601 date string (YYYY-MM-DD) for the start of the date range"
      }
    },
    required: ["github_username", "since"]
  }
};

/**
 * get_github_prs — fetch recent pull requests by a GitHub user.
 */
const getGitHubPRs: ToolDefinition = {
  name: "get_github_prs",
  description:
    "Fetch recent pull requests opened, updated, or merged by a specific GitHub user " +
    "across all tracked repositories. Returns PR number, title, state, and repository.",
  parameters: {
    type: "object",
    properties: {
      github_username: {
        type: "string",
        description: "The GitHub username from resolve_person result"
      },
      since: {
        type: "string",
        description: "ISO 8601 date string (YYYY-MM-DD) for the start of the date range"
      }
    },
    required: ["github_username", "since"]
  }
};

/**
 * list_active_repos — list repositories the org is tracking.
 */
const listActiveRepos: ToolDefinition = {
  name: "list_active_repos",
  description:
    "List the GitHub repositories currently tracked for this organization. " +
    "Use this to answer questions like 'what repos does the team work on?'",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};

/**
 * get_team_members — list all known team members for the org.
 */
const getTeamMembers: ToolDefinition = {
  name: "get_team_members",
  description:
    "List all team members known for this organization, including their GitHub usernames " +
    "and Jira account IDs if available. Use this to answer 'who is on the team?' questions.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};

/**
 * summarize_team_activity — cross-member activity roll-up.
 */
const summarizeTeamActivity: ToolDefinition = {
  name: "summarize_team_activity",
  description:
    "Fetch a high-level activity summary across all team members for a given time range. " +
    "Returns per-member counts of Jira issues, commits, and PRs. " +
    "Use this for 'what is the whole team working on?' questions. " +
    "Do not use for individual member questions — use the specific tools instead.",
  parameters: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description: "ISO 8601 date string (YYYY-MM-DD) for the start of the date range"
      }
    },
    required: ["since"]
  }
};

export const ALL_TOOLS: ToolDefinition[] = [
  resolvePerson,
  searchJiraIssues,
  getGitHubCommits,
  getGitHubPRs,
  listActiveRepos,
  getTeamMembers,
  summarizeTeamActivity
];

export const TOOL_NAMES = ALL_TOOLS.map((t) => t.name) as (typeof ALL_TOOLS)[number]["name"][];
