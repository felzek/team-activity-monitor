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
  NormalizedChatMessage,
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedModel,
  ProviderHealth,
  ToolCall,
} from "../types.js";

const BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 2048;

/** Model ID prefixes that indicate chat capability */
const CHAT_PREFIXES = ["gpt-5", "gpt-4", "gpt-3.5-turbo", "o1", "o3", "o4", "chatgpt-"];

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
    ["gpt-5.4", 5],
    ["gpt-5.3-chat-latest", 8],
    ["gpt-5.2-pro", 10],
    ["gpt-5.2", 12],
    ["gpt-5", 15],
    ["gpt-5-mini", 18],
    ["gpt-5-nano", 19],
    ["gpt-4o", 20],
    ["gpt-4o-mini", 25],
    ["o3", 30],
    ["o1", 40],
    ["o1-mini", 45],
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

/**
 * Convert normalized messages to OpenAI Chat Completions format.
 * Tool-result messages use role "tool" with tool_call_id.
 * Assistant messages that made tool calls include tool_calls array.
 */
function toOpenAiMessages(
  messages: NormalizedChatMessage[]
): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool",
        tool_call_id: msg.toolCallId ?? "",
        content: msg.content,
      };
    }
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return { role: msg.role, content: msg.content };
  });
}

export class OpenAiAdapter implements LlmProviderAdapter {
  readonly provider = "openai" as const;

  async listModels(apiKey: string): Promise<NormalizedModel[]> {
    try {
      const body = (await apiFetch("/models", apiKey)) as {
        data: Array<{ id: string; created: number }>;
      };
      const availableIds = new Set(body.data.map((model) => model.id));
      const preferredDefaultId = availableIds.has("gpt-5.4")
        ? "gpt-5.4"
        : availableIds.has("gpt-5")
          ? "gpt-5"
          : "gpt-4o";

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
          isDefaultCandidate: m.id === preferredDefaultId,
          isPinned: false,
          latencyTier: (m.id.includes("mini") || m.id.includes("nano") || m.id === "gpt-3.5-turbo"
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
    // Use Chat Completions API when tools are requested (standard tool use format);
    // fall back to Responses API for plain chat (preserves existing behavior).
    if (request.tools && request.tools.length > 0) {
      return this.chatCompletionsWithTools(apiKey, request);
    }
    return this.responsesApiChat(apiKey, request);
  }

  /** Chat Completions API — used for tool-enabled requests. */
  private async chatCompletionsWithTools(
    apiKey: string,
    request: NormalizedChatRequest
  ): Promise<NormalizedChatResponse> {
    try {
      const body: Record<string, unknown> = {
        model: request.modelId,
        messages: toOpenAiMessages(request.messages),
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      };

      if (request.temperature !== undefined) body.temperature = request.temperature;

      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
      }

      const resp = (await apiFetch("/chat/completions", apiKey, {
        method: "POST",
        body: JSON.stringify(body),
      })) as {
        choices: Array<{
          message: {
            role: string;
            content: string | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason: string;
        }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      const choice = resp.choices[0];
      const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      // Tool call response
      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
        const toolCalls: ToolCall[] = choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        }));

        return {
          provider: "openai",
          modelId: request.modelId,
          message: { role: "assistant", content: choice.message.content ?? "" },
          usage: {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          },
          finishReason: choice.finish_reason,
          error: null,
          toolCalls,
        };
      }

      return {
        provider: "openai",
        modelId: request.modelId,
        message: { role: "assistant", content: choice.message.content ?? "" },
        usage: {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
        finishReason: choice.finish_reason,
        error: null,
      };
    } catch (err) {
      throw normalizeProviderError(err, "openai", "OpenAI chat completions failed");
    }
  }

  /** Responses API — used for plain chat (no tools). Preserves existing behavior. */
  private async responsesApiChat(
    apiKey: string,
    request: NormalizedChatRequest
  ): Promise<NormalizedChatResponse> {
    try {
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
