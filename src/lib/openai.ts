import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { ActivitySummary } from "../types/activity.js";

const RESPONSE_SYSTEM_PROMPT = `You are a delivery-focused team activity assistant.
You must answer only from the provided normalized activity JSON.
Never invent issues, pull requests, commits, repositories, or dates.
If a source failed, say so plainly.
If activity is inferred, label it as inferred.
Output exactly four sections in this order: Overview, Jira, GitHub, Caveats.
Keep the answer concise and reviewer-friendly.`;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function maybePolishResponse(
  config: AppConfig,
  summary: ActivitySummary,
  draft: string,
  logger: Logger
): Promise<string> {
  if (!config.openAiApiKey) {
    return draft;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openAiApiKey}`
      },
      body: JSON.stringify({
        model: config.openAiModel,
        messages: [
          {
            role: "system",
            content: RESPONSE_SYSTEM_PROMPT
          },
          {
            role: "user",
            content: `Polish this grounded response without adding any facts.\n\nActivity JSON:\n${JSON.stringify(
              summary,
              null,
              2
            )}\n\nDraft response:\n${draft}`
          }
        ],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      logger.warn(
        {
          statusCode: response.status
        },
        "OpenAI polish request failed; using deterministic renderer"
      );
      return draft;
    }

    const json = (await response.json()) as ChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content?.trim();
    return content || draft;
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : "Unknown OpenAI error"
      },
      "OpenAI polish request failed; using deterministic renderer"
    );
    return draft;
  }
}
