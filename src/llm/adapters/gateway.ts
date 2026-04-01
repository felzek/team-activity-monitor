import type { AppConfig } from "../../config.js";
import { normalizeProviderError } from "../errors.js";
import { gatewayFetch, isGatewayConfigured } from "../gateway-client.js";
import type {
  LlmProviderAdapter,
  NormalizedChatMessage,
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedModel,
  ProviderHealth,
  ToolCall,
} from "../types.js";

const DEFAULT_MAX_TOKENS = 2048;

function toDisplayName(modelId: string): string {
  const [provider, rawModel] = modelId.split("/", 2);
  const modelLabel = (rawModel ?? modelId)
    .split(/[-._/]/)
    .map((part) =>
      /^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(" ");

  return `${modelLabel} (${provider ?? "gateway"})`;
}

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
        tool_calls: msg.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      };
    }

    return { role: msg.role, content: msg.content };
  });
}

function inferLatencyTier(modelId: string): "fast" | "medium" | "slow" {
  const lower = modelId.toLowerCase();
  if (lower.includes("flash") || lower.includes("mini") || lower.includes("haiku")) {
    return "fast";
  }

  if (lower.includes("opus") || lower.includes("pro")) {
    return "slow";
  }

  return "medium";
}

function inferReasoningTier(modelId: string): "standard" | "extended" {
  const lower = modelId.toLowerCase();
  return lower.includes("reasoning") ||
    lower.includes("gpt-5") ||
    lower.includes("opus") ||
    lower.includes("sonnet")
    ? "extended"
    : "standard";
}

export class GatewayAdapter implements LlmProviderAdapter {
  readonly provider = "gateway" as const;

  constructor(
    private readonly config: Pick<
      AppConfig,
      | "aiGatewayApiKey"
      | "vercelOidcToken"
      | "aiGatewayBaseUrl"
      | "aiGatewayDefaultModel"
      | "aiGatewayModels"
    >
  ) {}

  async listModels(): Promise<NormalizedModel[]> {
    if (!isGatewayConfigured(this.config)) {
      return [];
    }

    return this.config.aiGatewayModels.map((modelId, index) => ({
      id: `gateway:${modelId}`,
      provider: "gateway" as const,
      providerModelId: modelId,
      displayName: toDisplayName(modelId),
      supportsChat: true,
      supportsStreaming: true,
      supportsTools: true,
      supportsVision: !modelId.includes("coder"),
      status: "available" as const,
      isDefaultCandidate: modelId === this.config.aiGatewayDefaultModel,
      isPinned: modelId === this.config.aiGatewayDefaultModel,
      latencyTier: inferLatencyTier(modelId),
      reasoningTier: inferReasoningTier(modelId),
      sortOrder: modelId === this.config.aiGatewayDefaultModel ? 0 : index + 1,
    }));
  }

  async chat(_apiKey: string, request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    try {
      const body: Record<string, unknown> = {
        model: request.modelId,
        messages: toOpenAiMessages(request.messages),
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      };

      if (request.temperature !== undefined) {
        body.temperature = request.temperature;
      }

      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }));
      }

      const response = (await gatewayFetch(this.config, "/chat/completions", {
        method: "POST",
        body: JSON.stringify(body),
      })) as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason: string | null;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      };

      const choice = response.choices[0];
      const usage = response.usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

      const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
      }));

      return {
        provider: "gateway",
        modelId: request.modelId,
        message: { role: "assistant", content: choice.message.content ?? "" },
        usage: {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
        finishReason: choice.finish_reason,
        error: null,
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      };
    } catch (error) {
      throw normalizeProviderError(error, "gateway", "Vercel AI Gateway request failed");
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startedAt = Date.now();

    if (!isGatewayConfigured(this.config)) {
      return {
        provider: "gateway",
        status: "not_configured",
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      await gatewayFetch(this.config, "/models");
      return {
        provider: "gateway",
        status: "healthy",
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const normalized = normalizeProviderError(
        error,
        "gateway",
        "Vercel AI Gateway health check"
      );

      return {
        provider: "gateway",
        status:
          normalized.llmCode === "authentication_error"
            ? "auth_error"
            : "unavailable",
        error: normalized.message,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
