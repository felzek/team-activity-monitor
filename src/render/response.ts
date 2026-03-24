import type { ActivitySummary, GitHubPullRequestActivity, JiraIssueActivity } from "../types/activity.js";

function renderIssue(issue: JiraIssueActivity): string {
  const latestChange = issue.recentChanges[0];
  const latestChangeText = latestChange
    ? ` Latest change: ${latestChange.field} -> ${latestChange.to ?? "updated"} on ${latestChange.at}.`
    : "";

  return `- ${issue.key} [${issue.status}] ${issue.summary} (updated ${issue.updated}).${latestChangeText}`;
}

function renderPullRequest(pullRequest: GitHubPullRequestActivity): string {
  return `- ${pullRequest.repo}#${pullRequest.number} [${pullRequest.state}] ${pullRequest.title} (updated ${pullRequest.updatedAt}).`;
}

export function renderDeterministicResponse(summary: ActivitySummary): string {
  if (summary.needsClarification) {
    return [
      "Overview:",
      `I couldn't confidently identify the teammate in this request.${summary.clarificationReason ? ` ${summary.clarificationReason}` : ""}`,
      "",
      "Jira:",
      "No Jira lookup was run because the teammate match is unresolved.",
      "",
      "GitHub:",
      "No GitHub lookup was run because the teammate match is unresolved.",
      "",
      "Caveats:",
      summary.caveats.length > 0
        ? summary.caveats.map((caveat) => `- ${caveat}`).join("\n")
        : "- Clarify the teammate name and try again."
    ].join("\n");
  }

  const commitLines =
    summary.github.data.commits.length > 0
      ? summary.github.data.commits
          .slice(0, 5)
          .map(
            (commit) =>
              `- ${commit.repo} ${commit.sha}: ${commit.message} (${commit.authoredAt}).`
          )
      : ["- No recent GitHub commits found in the selected timeframe."];

  const pullRequestLines =
    summary.github.data.pullRequests.length > 0
      ? summary.github.data.pullRequests.slice(0, 5).map(renderPullRequest)
      : ["- No recent GitHub pull requests found in the selected timeframe."];

  const jiraLines =
    summary.jira.data.issues.length > 0
      ? summary.jira.data.issues.slice(0, 5).map(renderIssue)
      : ["- No current Jira issues were found for this teammate."];

  const overviewParts = [
    `${summary.member.displayName} appears active during ${summary.timeframe.label}.`
  ];

  if (summary.jira.status.ok) {
    overviewParts.push(
      `Jira shows ${summary.jira.data.issues.length} assigned issue(s) with ${summary.jira.data.recentUpdateCount} updated in the timeframe.`
    );
  } else {
    overviewParts.push("Jira data is currently unavailable.");
  }

  if (summary.github.status.ok) {
    overviewParts.push(
      `GitHub shows ${summary.github.data.commits.length} commit(s) and ${summary.github.data.pullRequests.length} pull request signal(s).`
    );
  } else {
    overviewParts.push("GitHub data is currently unavailable.");
  }

  const caveats = summary.caveats.length > 0
    ? summary.caveats.map((caveat) => `- ${caveat}`)
    : [
        "- Jira reflects current assigned work; GitHub reflects recent code activity.",
        "- A missing signal does not necessarily mean no work happened."
      ];

  return [
    "Overview:",
    overviewParts.join(" "),
    "",
    "Jira:",
    summary.jira.status.ok
      ? jiraLines.join("\n")
      : `- Jira lookup failed: ${summary.jira.status.message ?? "Unknown Jira error."}`,
    "",
    "GitHub:",
    summary.github.status.ok
      ? [...commitLines, ...pullRequestLines].join("\n")
      : `- GitHub lookup failed: ${summary.github.status.message ?? "Unknown GitHub error."}`,
    "",
    "Caveats:",
    caveats.join("\n")
  ].join("\n");
}
