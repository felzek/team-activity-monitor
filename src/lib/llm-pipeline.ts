import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { AppError, toErrorMessage } from "./errors.js";
import type { ActivitySummary } from "../types/activity.js";

export const RESPONSE_SYSTEM_PROMPT = `You are a delivery-focused engineering team activity assistant.
Your answers are grounded in structured JSON activity data retrieved from live Jira and GitHub APIs.

GROUNDING RULES — non-negotiable:
• Use ONLY facts present in the ActivitySummary JSON the user provides.
• Quote issue keys (e.g., PROJ-123), PR numbers, repository names, commit messages, and dates verbatim from the data.
• If a data source has errors or returned zero items, state that explicitly in the relevant section and in Caveats.
• If an "integration" object is present, you MUST reflect each provider's "explanation" field in the Overview and again in Caveats (e.g. Jira or GitHub not connected for this workspace, or not in scope for this query). Do not contradict those explanations.
• Never invent, infer, or extrapolate any fact beyond what the JSON contains.
• Never use markdown code fences.

OUTPUT — exactly four labeled sections, in this order, with no additional sections:

## Overview
One paragraph naming the team member and timeframe (use the label from the JSON). If the "integration" object is present, state whether Jira and GitHub were connected/in scope for this workspace using each provider's "explanation" string. State the total count of active Jira issues, total commits, and total pull requests. Give a one-sentence characterization of activity level.

## Jira
For each issue: key, summary, current status, priority (if present), and last-updated date. If there are recent changelog entries within the timeframe, mention the field that changed and the new value. If Jira failed or returned no issues, say so.

## GitHub
For each repository: name the repo, then list commits (message first line + date) and open/merged pull requests (title, number, state). If GitHub failed or returned no activity, say so.

## Caveats
List any failed sources, empty result sets, workspace connection issues from the "integration" object, or ambiguous data. If everything succeeded and data is complete, write: "No caveats — all sources returned data."`;

/** Chat message shape sent to the local HTTP LLM API. */
export interface LocalLlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Response shape for an Ollama-compatible POST …/chat endpoint.
 * Many local runtimes (Ollama, some proxies) use this JSON contract.
 */
export interface OllamaCompatibleChatResponse {
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

const LOCAL_LLM_CHAT_PATH = "chat";

function joinLocalLlmUrl(baseUrl: string, pathSegment: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = pathSegment.replace(/^\/+/, "");
  return `${base}/${path}`;
}

function buildOllamaCompatibleChatBody(
  config: AppConfig,
  modelName: string,
  messages: LocalLlmChatMessage[]
): Record<string, unknown> {
  return {
    model: modelName,
    stream: false,
    keep_alive: config.ollamaKeepAlive,
    messages
  };
}

function extractAssistantText(payload: OllamaCompatibleChatResponse): string | null {
  const text = payload.message?.content?.trim();
  return text || null;
}

export function buildGroundedResponsePrompt(summary: ActivitySummary): string {
  const memberName = summary.member.displayName;
  const timeframeLabel = summary.timeframe.label;
  const jiraOk = summary.jira.status.ok;
  const githubOk = summary.github.status.ok;
  const issueCount = summary.jira.data.issues.length;
  const commitCount = summary.github.data.commits.length;
  const prCount = summary.github.data.pullRequests.length;
  const int = summary.integration;

  return [
    `Generate a structured activity report for ${memberName} covering ${timeframeLabel}.`,
    "",
    "Follow these extraction steps before writing:",
    `Step 1 — Confirm subject: member="${memberName}", timeframe="${timeframeLabel}", jira_ok=${jiraOk}, github_ok=${githubOk}.`,
    int
      ? `Step 1b — Workspace integration: Jira — ${int.jira.explanation} GitHub — ${int.github.explanation} Repeat these facts in Overview and Caveats.`
      : "Step 1b — No integration block in JSON; infer connection scope only from status fields and caveats.",
    `Step 2 — Jira: ${issueCount} issue(s) found. List each key and status from the data.`,
    `Step 3 — GitHub: ${commitCount} commit(s), ${prCount} PR(s) found. Group by repository.`,
    "Step 4 — Identify any source errors or empty arrays from the status fields.",
    "Step 5 — Write the four-section report (## Overview, ## Jira, ## GitHub, ## Caveats) using ONLY what you found in steps 1-4.",
    "",
    "Do not use markdown code fences. Do not add sections beyond the four listed.",
    "",
    "ActivitySummary JSON:",
    JSON.stringify(summary, null, 2)
  ].join("\n");
}

function localModelNotReadyMessage(modelName: string, endpointHint: string): string {
  return `Your current model (${modelName}) isn't ready yet. Ensure your local LLM server is reachable at ${endpointHint}, the model is available and loaded (e.g. Ollama: model pulled), or switch to a cloud model in Settings → LLM providers.`;
}

/**
 * POST to an Ollama-compatible `/chat` endpoint and return the assistant message text.
 * `config.ollamaBaseUrl` is treated as the API base (e.g. `http://localhost:11434/api`).
 */
export async function postOllamaCompatibleChat(
  config: AppConfig,
  modelName: string,
  messages: LocalLlmChatMessage[],
  logger: Logger
): Promise<string> {
  const url = joinLocalLlmUrl(config.ollamaBaseUrl, LOCAL_LLM_CHAT_PATH);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildOllamaCompatibleChatBody(config, modelName, messages))
    });

    const payload = (await response.json().catch(() => ({}))) as OllamaCompatibleChatResponse;

    if (!response.ok) {
      throw new AppError(
        response.status === 404
          ? localModelNotReadyMessage(modelName, config.ollamaBaseUrl)
          : payload.error ||
            `Local LLM request failed with status ${response.status}. Confirm the server is running and the model exists.`,
        {
          code: response.status === 404 ? "LOCAL_LLM_MODEL_MISSING" : "LOCAL_LLM_REQUEST_FAILED",
          statusCode: 503
        }
      );
    }

    const content = extractAssistantText(payload);
    if (!content) {
      throw new AppError("Local LLM returned an empty response.", {
        code: "LOCAL_LLM_EMPTY_RESPONSE",
        statusCode: 503
      });
    }

    logger.info(
      {
        localLlmModel: modelName,
        localLlmBaseUrl: config.ollamaBaseUrl,
        totalDurationMs: payload.total_duration
          ? Math.round(payload.total_duration / 1_000_000)
          : undefined,
        loadDurationMs: payload.load_duration
          ? Math.round(payload.load_duration / 1_000_000)
          : undefined,
        promptEvalCount: payload.prompt_eval_count,
        evalCount: payload.eval_count
      },
      "Generated grounded response via local HTTP LLM (Ollama-compatible chat API)"
    );

    return content;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.warn(
      {
        error: toErrorMessage(error),
        localLlmBaseUrl: config.ollamaBaseUrl,
        localLlmModel: modelName
      },
      "Local LLM HTTP request failed"
    );

    throw new AppError(localModelNotReadyMessage(modelName, config.ollamaBaseUrl), {
      code: "LOCAL_LLM_UNAVAILABLE",
      statusCode: 503,
      cause: error
    });
  }
}

/**
 * Run the grounded activity summary through the configured **local** LLM.
 * Uses an Ollama-compatible HTTP chat API (`POST {base}/chat`); env still names this `OLLAMA_*` for compatibility.
 */
export async function generateGroundedResponse(
  config: AppConfig,
  summary: ActivitySummary,
  logger: Logger,
  modelOverride?: string
): Promise<string> {
  const modelName = modelOverride ?? config.ollamaModel;
  const messages: LocalLlmChatMessage[] = [
    { role: "system", content: RESPONSE_SYSTEM_PROMPT },
    { role: "user", content: buildGroundedResponsePrompt(summary) }
  ];
  return postOllamaCompatibleChat(config, modelName, messages, logger);
}
