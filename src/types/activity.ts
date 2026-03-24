export type QueryIntent =
  | "activity_summary"
  | "jira_only"
  | "github_commits"
  | "github_prs";

export type TimeframeKind =
  | "trailing_days"
  | "calendar_week"
  | "explicit_range";

export type ProviderName = "jira" | "github";

export interface TeamMember {
  id: string;
  displayName: string;
  aliases: string[];
  jiraAccountId?: string;
  jiraQuery?: string;
  githubUsername?: string;
}

export interface TrackedRepo {
  owner: string;
  repo: string;
  disabled?: boolean;
}

export interface ResolvedTimeframe {
  kind: TimeframeKind;
  label: string;
  start: string;
  end: string;
  timezone: string;
}

export interface ParsedQuery {
  rawQuery: string;
  memberText: string | null;
  intent: QueryIntent;
  requestedSources: ProviderName[];
  timeframe: ResolvedTimeframe;
  needsClarification: boolean;
  clarificationReason: string | null;
}

export interface IdentityResolution {
  member: TeamMember | null;
  needsClarification: boolean;
  clarificationReason: string | null;
  candidates: TeamMember[];
}

export interface JiraIssueActivity {
  key: string;
  summary: string;
  status: string;
  issueType?: string;
  priority?: string;
  updated: string;
  url?: string;
  recentChanges: JiraIssueChange[];
}

export interface JiraIssueChange {
  at: string;
  field: string;
  from?: string;
  to?: string;
  author?: string;
}

export interface GitHubCommitActivity {
  repo: string;
  sha: string;
  message: string;
  authoredAt: string;
  url?: string;
}

export interface GitHubPullRequestActivity {
  repo: string;
  number: number;
  title: string;
  state: string;
  updatedAt: string;
  isOpen: boolean;
  url?: string;
}

export interface ProviderStatus {
  provider: ProviderName;
  ok: boolean;
  partial: boolean;
  latencyMs: number;
  errorCode?: string;
  message?: string;
}

export interface JiraActivityResult {
  issues: JiraIssueActivity[];
  recentUpdateCount: number;
}

export interface GitHubActivityResult {
  commits: GitHubCommitActivity[];
  pullRequests: GitHubPullRequestActivity[];
  recentRepos: string[];
}

export interface ActivitySummary {
  member: {
    displayName: string;
    id?: string;
    jiraAccountId?: string;
    githubUsername?: string;
    queryText: string | null;
  };
  intent: QueryIntent;
  timeframe: ResolvedTimeframe;
  needsClarification: boolean;
  clarificationReason: string | null;
  jira: {
    status: ProviderStatus;
    data: JiraActivityResult;
  };
  github: {
    status: ProviderStatus;
    data: GitHubActivityResult;
  };
  caveats: string[];
}
