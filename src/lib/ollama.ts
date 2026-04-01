/**
 * Dashboard insight generation using the app's configured system model.
 *
 * This path stays server-managed on purpose: Vercel AI Gateway is preferred
 * for hosted deployments, while local Ollama remains the default fallback
 * for local development.
 */

import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { generateSystemText } from "./llm-pipeline.js";
import { toErrorMessage } from "./errors.js";
import type { GitHubDashboardData, JiraDashboardData } from "../types/dashboard.js";

function buildDashboardInsightPrompt(
  github: GitHubDashboardData | null,
  jira: JiraDashboardData | null
): string {
  const parts: string[] = [
    "Generate exactly ONE sentence (under 35 words) summarizing the team's recent work based only on the following numbers.",
    "Never invent data. Focus on the most notable signal.",
    ""
  ];

  if (github?.health.connected) {
    parts.push(
      `GitHub (last 7 days): ${github.metrics.totalCommits} commits, ${github.metrics.openPRs} open PRs, ${github.metrics.activeRepos} active repos out of ${github.metrics.trackedRepos} tracked.`
    );
    const topRepo = [...github.repoStats].sort((a, b) => b.commitCount - a.commitCount)[0];
    if (topRepo && topRepo.commitCount > 0) {
      parts.push(`Most active repo: ${topRepo.fullName} with ${topRepo.commitCount} commits.`);
    }
  }

  if (jira?.health.connected) {
    parts.push(
      `Jira: ${jira.metrics.openIssues} open issues, ${jira.metrics.inProgress} in progress, ${jira.metrics.recentlyUpdated} updated in the last 7 days across ${jira.metrics.projects} projects.`
    );
  }

  if (!github?.health.connected && !jira?.health.connected) {
    parts.push("No sources are connected.");
  }

  return parts.join("\n");
}

export async function generateDashboardInsight(
  config: AppConfig,
  github: GitHubDashboardData | null,
  jira: JiraDashboardData | null,
  logger: Logger
): Promise<string | null> {
  try {
    return await generateSystemText(
      config,
      "You are a concise team activity assistant. Output only the requested single sentence. No preamble, no follow-up.",
      buildDashboardInsightPrompt(github, jira),
      logger
    );
  } catch (error) {
    logger.warn({ error: toErrorMessage(error) }, "Dashboard insight generation failed");
    return null;
  }
}
