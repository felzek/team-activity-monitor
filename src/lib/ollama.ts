/**
 * Dashboard insight generation using Ollama.
 *
 * This module is intentionally scoped to the dashboard one-sentence insight.
 * For grounded query responses, use src/lib/llm-pipeline.ts (which routes
 * through LlmService and supports all providers, including local Ollama).
 */

import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { toErrorMessage } from "./errors.js";
import type { GitHubDashboardData, JiraDashboardData } from "../types/dashboard.js";

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
  };
  error?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

function ollamaUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

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
    const response = await fetch(ollamaUrl(config.ollamaBaseUrl, "chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        keep_alive: config.ollamaKeepAlive,
        messages: [
          {
            role: "system",
            content:
              "You are a concise team activity assistant. Output only the requested single sentence. No preamble, no follow-up."
          },
          {
            role: "user",
            content: buildDashboardInsightPrompt(github, jira)
          }
        ]
      })
    });

    const payload = (await response.json().catch(() => ({}))) as OllamaChatResponse;

    if (!response.ok) {
      logger.warn(
        { statusCode: response.status },
        "Dashboard insight request returned non-OK status"
      );
      return null;
    }

    const content = payload.message?.content?.trim();
    return content || null;
  } catch (error) {
    logger.warn({ error: toErrorMessage(error) }, "Dashboard insight generation failed");
    return null;
  }
}

