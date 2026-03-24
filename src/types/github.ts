export interface GitHubAdapterResult {
  commits: import("./activity.js").GitHubCommitActivity[];
  pullRequests: import("./activity.js").GitHubPullRequestActivity[];
  recentRepos: string[];
}
