export interface JiraUserSearchResult {
  accountId: string;
  displayName: string;
}

export interface JiraAdapterResult {
  accountId?: string;
  displayName?: string;
  issues: import("./activity.js").JiraIssueActivity[];
  recentUpdateCount: number;
}
