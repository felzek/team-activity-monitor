/**
 * OpenAI adapter.
 *
 * Uses the Responses API (POST /v1/responses) for chat generation and
 * GET /v1/models for model discovery. Native fetch — no SDK dependency.
 *
 * To swap to the Chat Completions API, replace the `chat` method body
 * with a POST to /v1/chat/completions and adjust the response parsing.
 */

import { LlmError, normalizeProviderError } from "../errors.js";
import type {
  LlmProviderAdapter,
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedModel,
  ProviderHealth,
} from "../types.js";

const BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 2048;

/** Model ID prefixes that indicate chat capability */
const CHAT_PREFIXES = ["gpt-4", "gpt-3.5-turbo", "o1", "o3", "o4", "chatgpt-"];

/** Model ID substrings that disqualify a model for chat */
const EXCLUDED = [
  "embedding",
  "whisper",
  "dall-e",
  "tts",
  "babbage",
  "davinci",
  "instruct",
  "moderation",
  "realtime",
  "audio",
  "ft:",
];

function isChatCapable(id: string): boolean {
  const lower = id.toLowerCase();
  if (EXCLUDED.some((s) => lower.includes(s))) return false;
  return CHAT_PREFIXES.some((p) => lower.startsWith(p));
}

function toDisplayName(id: string): string {
  // "gpt-4o" → "GPT-4o", "gpt-4o-mini" → "GPT-4o Mini", "o1-mini" → "O1 Mini"
  return id
    .split("-")
    .map((part, i) => {
      if (i === 0) {
        if (part === "gpt") return "GPT";
        if (part === "chatgpt") return "ChatGPT";
        // o1, o3, o4 etc.
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function modelSortOrder(id: string): number {
  // Lower = shown first
  const table: Array<[string, number]> = [
    ["gpt-4o-mini", 25],
    ["gpt-4o", 20],
    ["o3", 30],
    ["o1-mini", 45],
    ["o1", 40],
    ["gpt-4-turbo", 60],
    ["gpt-4", 70],
    ["gpt-3.5-turbo", 80],
  ];
  for (const [prefix, order] of table) {
    if (id === prefix || id.startsWith(`${prefix}-`)) return order;
  }
  return 100;
}

async function apiFetch(path: string, apiKey: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg =
      (body as { error?: { message?: string } })?.error?.message ??
      `HTTP ${response.status}`;
    throw new LlmError(errorMsg, {
      llmCode:
        response.status === 401
          ? "authentication_error"
          : response.status === 403
            ? "authorization_error"
            : response.status === 429
              ? "rate_limit_error"
              : "unknown_provider_error",
      provider: "openai",
      statusCode: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  return body;
}

export class OpenAiAdapter implements LlmProviderAdapter {
  readonly provider = "openai" as const;

  async listModels(apiKey: string): Promise<NormalizedModel[]> {
    try {
      const body = (await apiFetch("/models", apiKey)) as {
        data: Array<{ id: string; created: number }>;
      };

      return body.data
        .filter((m) => isChatCapable(m.id))
        .map((m) => ({
          id: `openai:${m.id}`,
          provider: "openai" as const,
          providerModelId: m.id,
          displayName: toDisplayName(m.id),
          supportsChat: true,
          supportsStreaming: true,
          supportsTools: true,
          supportsVision:
            m.id.includes("vision") ||
            m.id.startsWith("gpt-4o") ||
            m.id.includes("4-turbo"),
          status: "available" as const,
          isDefaultCandidate: m.id === "gpt-4o",
          isPinned: false,
          latencyTier: (m.id.includes("mini") || m.id === "gpt-3.5-turbo"
            ? "fast"
            : "medium") as "fast" | "medium",
          reasoningTier: (m.id.startsWith("o1") || m.id.startsWith("o3") || m.id.startsWith("o4")
            ? "extended"
            : "standard") as "extended" | "standard",
          sortOrder: modelSortOrder(m.id),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
    } catch (err) {
      throw normalizeProviderError(err, "openai", "Failed to list OpenAI models");
    }
  }

  async chat(apiKey: string, request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    try {
      // Responses API separates system prompt (instructions) from conversation input
      const systemMsg = request.messages.find((m) => m.role === "system");
      const convoMessages = request.messages.filter((m) => m.role !== "system");

      const body: Record<string, unknown> = {
        model: request.modelId,
        input: convoMessages.map((m) => ({ role: m.role, content: m.content })),
        max_output_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      };

      if (systemMsg) body.instructions = systemMsg.content;
      if (request.temperature !== undefined) body.temperature = request.temperature;

      const resp = (await apiFetch("/responses", apiKey, {
        method: "POST",
        body: JSON.stringify(body),
      })) as {
        model: string;
        status: string;
        output: Array<{
          type: string;
          role: string;
          content: Array<{ type: string; text?: string }>;
        }>;
        usage: { input_tokens: number; output_tokens: number; total_tokens?: number };
      };

      const msgOutput = resp.output?.find((o) => o.type === "message");
      const text =
        msgOutput?.content
          ?.filter((c) => c.type === "output_text")
          .map((c) => c.text ?? "")
          .join("") ?? "";

      const usage = resp.usage ?? { input_tokens: 0, output_tokens: 0 };

      return {
        provider: "openai",
        modelId: request.modelId,
        message: { role: "assistant", content: text },
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          totalTokens: usage.total_tokens ?? usage.input_tokens + usage.output_tokens,
        },
        finishReason: resp.status === "completed" ? "stop" : (resp.status ?? null),
        error: null,
      };
    } catch (err) {
      throw normalizeProviderError(err, "openai", "OpenAI chat failed");
    }
  }

  async healthCheck(apiKey: string): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await apiFetch("/models?limit=1", apiKey);
      return {
        provider: "openai",
        status: "healthy",
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      const e = normalizeProviderError(err, "openai", "Health check");
      return {
        provider: "openai",
        status: e.llmCode === "authentication_error" ? "auth_error" : "unavailable",
        error: e.message,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
