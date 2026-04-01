/**
 * Ollama adapter — local models via the Ollama HTTP API.
 *
 * No API key required; the server URL is configured at construction time.
 * The `apiKey` parameter on listModels/chat is intentionally ignored.
 *
 * Tool calling is not supported by local models in this adapter.
 * If request.tools is present, tools are omitted and the model answers
 * directly from its context (this is acceptable for grounded-response
 * queries which do not need a tool loop). For the tool-first chat
 * pipeline, prefer a cloud model.
 */

import type { Logger } from "pino";
import { LlmError } from "../errors.js";
import type {
  LlmProviderAdapter,
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedModel,
  ProviderHealth,
} from "../types.js";

const CHAT_TIMEOUT_MS = 120_000; // Local models can be slow to load/generate
const HEALTH_TIMEOUT_MS = 5_000;

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    model?: string;
    modified_at?: string;
    size?: number;
    details?: { parameter_size?: string; family?: string };
  }>;
}

interface OllamaChatResponse {
  message?: { role?: string; content?: string };
  error?: string;
  done?: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

function joinUrl(base: string, segment: string): string {
  return `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
}

function toDisplayName(name: string): string {
  const [model, tag] = name.split(":");
  const formatted = (model ?? name)
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return tag ? `${formatted} · ${tag.toUpperCase()}` : formatted;
}

export class OllamaAdapter implements LlmProviderAdapter {
  readonly provider = "local" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly defaultModel: string,
    private readonly keepAlive: string = "10m",
    private readonly logger?: Logger
  ) {}

  /**
   * Lists all locally pulled Ollama models.
   * Returns an empty array (not an error) when Ollama is not running —
   * the caller can handle absence gracefully.
   */
  async listModels(_apiKey: string): Promise<NormalizedModel[]> {
    try {
      const response = await fetch(joinUrl(this.baseUrl, "tags"), {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });

      if (!response.ok) return [];

      const body = (await response.json().catch(() => ({ models: [] }))) as OllamaTagsResponse;
      const models = body.models ?? [];

      return models.map((m, i) => ({
        id: `local:${m.name}`,
        provider: "local" as const,
        providerModelId: m.name,
        displayName: toDisplayName(m.name),
        supportsChat: true,
        supportsStreaming: false,
        supportsTools: false,
        supportsVision: false,
        status: "available" as const,
        isDefaultCandidate: m.name === this.defaultModel,
        isPinned: m.name === this.defaultModel,
        latencyTier: "slow" as const,
        reasoningTier: "standard" as const,
        sortOrder: m.name === this.defaultModel ? 0 : i + 1,
      }));
    } catch {
      // Ollama may not be running — silently return nothing
      return [];
    }
  }

  async chat(_apiKey: string, request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    if (request.tools && request.tools.length > 0) {
      this.logger?.warn(
        { model: request.modelId },
        "OllamaAdapter: tools not supported for local models — answering from context only"
      );
    }

    try {
      const response = await fetch(joinUrl(this.baseUrl, "chat"), {
        method: "POST",
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.modelId,
          stream: false,
          keep_alive: this.keepAlive,
          messages: request.messages
            .filter((m) => m.role !== "tool") // skip tool-result turns
            .map((m) => ({
              role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
              content: m.content,
            })),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as OllamaChatResponse;

      if (!response.ok) {
        throw new LlmError(
          response.status === 404
            ? `Local model "${request.modelId}" not found. Pull it first: ollama pull ${request.modelId}`
            : payload.error ?? `Ollama returned HTTP ${response.status}`,
          {
            llmCode: response.status === 404 ? "invalid_model" : "provider_unavailable",
            provider: "local",
            statusCode: response.status === 404 ? 400 : 503,
          }
        );
      }

      const content = payload.message?.content?.trim() ?? "";
      if (!content) {
        throw new LlmError("Local model returned an empty response.", {
          llmCode: "unknown_provider_error",
          provider: "local",
          statusCode: 503,
        });
      }

      return {
        provider: "local",
        modelId: request.modelId,
        message: { role: "assistant", content },
        usage: {
          inputTokens: payload.prompt_eval_count ?? 0,
          outputTokens: payload.eval_count ?? 0,
          totalTokens: (payload.prompt_eval_count ?? 0) + (payload.eval_count ?? 0),
        },
        finishReason: payload.done ? "stop" : null,
        error: null,
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError(
        `Local model server is unreachable at ${this.baseUrl}. Is Ollama running?`,
        {
          llmCode: "provider_unavailable",
          provider: "local",
          statusCode: 503,
          cause: err,
        }
      );
    }
  }

  async healthCheck(_apiKey: string): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const response = await fetch(joinUrl(this.baseUrl, "tags"), {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return {
          provider: "local",
          status: "unavailable",
          error: `Ollama responded with HTTP ${response.status}`,
          latencyMs,
          checkedAt: new Date().toISOString(),
        };
      }

      const body = (await response.json().catch(() => ({ models: [] }))) as OllamaTagsResponse;
      const modelCount = body.models?.length ?? 0;

      return {
        provider: "local",
        status: modelCount === 0 ? "no_models" : "healthy",
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        provider: "local",
        status: "unavailable",
        error: `Ollama is not reachable at ${this.baseUrl}`,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
