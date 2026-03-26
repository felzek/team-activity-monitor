export interface ConnectionHealth {
  connected: boolean;
  mode: "workspace_token" | "fixture" | "unavailable";
  displayName: string | null;
  errorMessage: string | null;
}

export interface GitHubRepoStat {
  fullName: string;
  commitCount: number;
  openPRCount: number;
  lastActivityAt: string | null;
}

export interface GitHubCommitRow {
  sha: string;
  repo: string;
  message: string;
  author: string | null;
  authoredAt: string;
  url: string | null;
}

export interface GitHubPRRow {
  number: number;
  repo: string;
  title: string;
  state: "open" | "closed" | "merged";
  isOpen: boolean;
  author: string | null;
  updatedAt: string;
  url: string | null;
}

export interface GitHubDashboardData {
  health: ConnectionHealth;
  timeframeLabel: string;
  metrics: {
    totalCommits: number;
    openPRs: number;
    activeRepos: number;
    trackedRepos: number;
  };
  repoStats: GitHubRepoStat[];
  recentCommits: GitHubCommitRow[];
  openPullRequests: GitHubPRRow[];
  fetchedAt: string;
  caveats: string[];
}

export type JiraStatusCategory = "todo" | "inprogress" | "done" | "unknown";

export interface JiraIssueRow {
  key: string;
  summary: string;
  status: string;
  statusCategory: JiraStatusCategory;
  issueType: string | null;
  priority: string | null;
  assignee: string | null;
  updated: string;
  url: string | null;
}

export interface JiraProjectStat {
  key: string;
  name: string;
  openIssueCount: number;
}

export interface JiraDashboardData {
  health: ConnectionHealth;
  timeframeLabel: string;
  metrics: {
    openIssues: number;
    inProgress: number;
    recentlyUpdated: number;
    projects: number;
  };
  openIssues: JiraIssueRow[];
  recentlyUpdated: JiraIssueRow[];
  projects: JiraProjectStat[];
  fetchedAt: string;
  caveats: string[];
}

export interface DashboardInsight {
  text: string | null;
  generatedAt: string;
  error: string | null;
}
