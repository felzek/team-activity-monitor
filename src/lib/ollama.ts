import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { AppError, toErrorMessage } from "./errors.js";
import type { ActivitySummary } from "../types/activity.js";
import type { GitHubDashboardData, JiraDashboardData } from "../types/dashboard.js";

export const RESPONSE_SYSTEM_PROMPT = `You are a delivery-focused team activity assistant.
You must answer only from the provided normalized activity JSON.
Never invent issues, pull requests, commits, repositories, or dates.
If a source failed, say so plainly.
If activity is inferred, label it as inferred.
Output exactly four sections in this order: Overview, Jira, GitHub, Caveats.
Keep the answer concise and reviewer-friendly.`;

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

export function buildGroundedResponsePrompt(summary: ActivitySummary): string {
  return [
    "Generate a grounded teammate activity answer from the following normalized JSON.",
    "Use only the facts in the JSON.",
    "Return plain text with exactly these sections in this order: Overview, Jira, GitHub, Caveats.",
    "When a source failed, say so in that source section and in Caveats.",
    "Do not use markdown code fences.",
    "",
    "ActivitySummary JSON:",
    JSON.stringify(summary, null, 2)
  ].join("\n");
}

function modelNotReadyMessage(modelName: string): string {
  return `Your current model (${modelName}) isn't ready yet. Start Ollama if it's stopped, wait for the model to finish loading, or switch to a cloud model in Settings → LLM providers.`;
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

export async function generateGroundedResponse(
  config: AppConfig,
  summary: ActivitySummary,
  logger: Logger,
  modelOverride?: string
): Promise<string> {
  const modelName = modelOverride ?? config.ollamaModel;
  try {
    const response = await fetch(ollamaUrl(config.ollamaBaseUrl, "chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        stream: false,
        keep_alive: config.ollamaKeepAlive,
        messages: [
          {
            role: "system",
            content: RESPONSE_SYSTEM_PROMPT
          },
          {
            role: "user",
            content: buildGroundedResponsePrompt(summary)
          }
        ]
      })
    });

    const payload = (await response.json().catch(() => ({}))) as OllamaChatResponse;

    if (!response.ok) {
      throw new AppError(
        response.status === 404
          ? modelNotReadyMessage(modelName)
          : payload.error ||
            `Ollama request failed with status ${response.status}. Confirm the model is installed and the Ollama server is running.`,
        {
          code: response.status === 404 ? "OLLAMA_MODEL_MISSING" : "OLLAMA_REQUEST_FAILED",
          statusCode: 503
        }
      );
    }

    const content = payload.message?.content?.trim();
    if (!content) {
      throw new AppError("Ollama returned an empty response.", {
        code: "OLLAMA_EMPTY_RESPONSE",
        statusCode: 503
      });
    }

    logger.info(
      {
        ollamaModel: modelName,
        totalDurationMs: payload.total_duration
          ? Math.round(payload.total_duration / 1_000_000)
          : undefined,
        loadDurationMs: payload.load_duration
          ? Math.round(payload.load_duration / 1_000_000)
          : undefined,
        promptEvalCount: payload.prompt_eval_count,
        evalCount: payload.eval_count
      },
      "Generated grounded response with local model"
    );

    return content;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.warn(
      {
        error: toErrorMessage(error),
        ollamaBaseUrl: config.ollamaBaseUrl,
        ollamaModel: modelName
      },
      "Local model request failed"
    );

    throw new AppError(modelNotReadyMessage(modelName), {
      code: "OLLAMA_UNAVAILABLE",
      statusCode: 503,
      cause: error
    });
  }
}
