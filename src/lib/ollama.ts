import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { AppError, toErrorMessage } from "./errors.js";
import type { ActivitySummary } from "../types/activity.js";

const RESPONSE_SYSTEM_PROMPT = `You are a delivery-focused team activity assistant.
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

function modelNotReachableMessage(config: AppConfig): string {
  return `Local model generation is unavailable. Start Ollama and ensure ${config.ollamaModel} is available at ${config.ollamaBaseUrl}.`;
}

export async function generateGroundedResponse(
  config: AppConfig,
  summary: ActivitySummary,
  logger: Logger
): Promise<string> {
  try {
    const response = await fetch(ollamaUrl(config.ollamaBaseUrl, "chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.ollamaModel,
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
        payload.error ||
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
        ollamaModel: config.ollamaModel,
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
        ollamaModel: config.ollamaModel
      },
      "Local model request failed"
    );

    throw new AppError(modelNotReachableMessage(config), {
      code: "OLLAMA_UNAVAILABLE",
      statusCode: 503,
      cause: error
    });
  }
}
