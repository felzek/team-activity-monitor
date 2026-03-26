/**
 * Anthropic adapter.
 *
 * Uses the Messages API (POST /v1/messages) for chat and
 * GET /v1/models for model discovery. Native fetch — no SDK dependency.
 *
 * Auth: x-api-key header + anthropic-version header (required).
 */

import { LlmError, normalizeProviderError } from "../errors.js";
import type {
  LlmProviderAdapter,
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedModel,
  ProviderHealth,
} from "../types.js";

const BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 2048;

async function apiFetch(path: string, apiKey: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
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
      provider: "claude",
      statusCode: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  return body;
}

function toDisplayName(id: string, apiDisplayName?: string): string {
  if (apiDisplayName) return apiDisplayName;
  // "claude-opus-4-6-20250514" → "Claude Opus 4.6"
  // Strip trailing 8-digit date stamp
  const cleaned = id.replace(/-\d{8}$/, "");
  return cleaned
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function modelSortOrder(id: string): number {
  const lower = id.toLowerCase();
  if (lower.includes("opus")) return 10;
  if (lower.includes("sonnet")) return 20;
  if (lower.includes("haiku")) return 30;
  return 50;
}

export class AnthropicAdapter implements LlmProviderAdapter {
  readonly provider = "claude" as const;

  async listModels(apiKey: string): Promise<NormalizedModel[]> {
    try {
      const body = (await apiFetch("/models?limit=20", apiKey)) as {
        data: Array<{
          id: string;
          display_name?: string;
          type: string;
          created_at: string;
        }>;
      };

      return body.data
        .filter((m) => m.type === "model")
        .map((m) => ({
          id: `claude:${m.id}`,
          provider: "claude" as const,
          providerModelId: m.id,
          displayName: toDisplayName(m.id, m.display_name),
          supportsChat: true,
          supportsStreaming: true,
          supportsTools: true,
          supportsVision: true,
          status: "available" as const,
          isDefaultCandidate: m.id.toLowerCase().includes("sonnet"),
          isPinned: false,
          latencyTier: (m.id.toLowerCase().includes("haiku")
            ? "fast"
            : m.id.toLowerCase().includes("sonnet")
              ? "medium"
              : "slow") as "fast" | "medium" | "slow",
          reasoningTier: "standard" as const,
          sortOrder: modelSortOrder(m.id),
        }));
    } catch (err) {
      throw normalizeProviderError(err, "claude", "Failed to list Anthropic models");
    }
  }

  async chat(apiKey: string, request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    try {
      // Anthropic separates the system prompt from the messages array
      const systemMsg = request.messages.find((m) => m.role === "system");
      const convoMessages = request.messages.filter((m) => m.role !== "system");

      const body: Record<string, unknown> = {
        model: request.modelId,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        messages: convoMessages.map((m) => ({ role: m.role, content: m.content })),
      };

      if (systemMsg) body.system = systemMsg.content;
      if (request.temperature !== undefined) body.temperature = request.temperature;

      const resp = (await apiFetch("/messages", apiKey, {
        method: "POST",
        body: JSON.stringify(body),
      })) as {
        id: string;
        type: string;
        role: string;
        content: Array<{ type: string; text?: string }>;
        model: string;
        stop_reason: string | null;
        usage: { input_tokens: number; output_tokens: number };
      };

      const text = resp.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");

      return {
        provider: "claude",
        modelId: request.modelId,
        message: { role: "assistant", content: text },
        usage: {
          inputTokens: resp.usage.input_tokens,
          outputTokens: resp.usage.output_tokens,
          totalTokens: resp.usage.input_tokens + resp.usage.output_tokens,
        },
        finishReason: resp.stop_reason,
        error: null,
      };
    } catch (err) {
      throw normalizeProviderError(err, "claude", "Anthropic chat failed");
    }
  }

  async healthCheck(apiKey: string): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await apiFetch("/models?limit=1", apiKey);
      return {
        provider: "claude",
        status: "healthy",
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      const e = normalizeProviderError(err, "claude", "Health check");
      return {
        provider: "claude",
        status: e.llmCode === "authentication_error" ? "auth_error" : "unavailable",
        error: e.message,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
