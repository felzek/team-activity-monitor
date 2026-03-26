/**
 * Gemini adapter.
 *
 * Uses generateContent (POST /v1beta/models/{model}:generateContent) for chat
 * and GET /v1beta/models for model discovery. Native fetch — no SDK dependency.
 *
 * Auth: API key passed as ?key= query parameter (Gemini standard).
 *
 * Role mapping: internal "assistant" → Gemini "model".
 * System prompt: passed via top-level systemInstruction field.
 */

import { LlmError, normalizeProviderError } from "../errors.js";
import type {
  LlmProviderAdapter,
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedModel,
  ProviderHealth,
} from "../types.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 2048;

const EXCLUDED_SUBSTRINGS = ["embedding", "aqa", "retrieval", "vision-only"];

function isChatCapable(name: string, supportedMethods: string[]): boolean {
  const lower = name.toLowerCase();
  if (EXCLUDED_SUBSTRINGS.some((s) => lower.includes(s))) return false;
  if (!lower.startsWith("models/gemini")) return false;
  return supportedMethods.includes("generateContent");
}

function stripModelsPrefix(name: string): string {
  return name.replace(/^models\//, "");
}

function toDisplayName(name: string, apiDisplayName?: string): string {
  if (apiDisplayName) return apiDisplayName;
  // "models/gemini-2.0-flash-001" → "Gemini 2.0 Flash 001"
  const short = stripModelsPrefix(name);
  return short
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function modelSortOrder(name: string): number {
  const lower = name.toLowerCase();
  if (lower.includes("2.5") && lower.includes("pro")) return 10;
  if (lower.includes("2.5") && lower.includes("flash")) return 20;
  if (lower.includes("2.0") && lower.includes("flash")) return 30;
  if (lower.includes("2.0") && lower.includes("pro")) return 40;
  if (lower.includes("1.5") && lower.includes("pro")) return 50;
  if (lower.includes("1.5") && lower.includes("flash")) return 60;
  return 100;
}

async function apiFetch(path: string, apiKey: string, init?: RequestInit): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE_URL}${path}${sep}key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
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
        response.status === 400
          ? "validation_error"
          : response.status === 401 || response.status === 403
            ? "authentication_error"
            : response.status === 429
              ? "rate_limit_error"
              : "unknown_provider_error",
      provider: "gemini",
      statusCode: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  return body;
}

export class GeminiAdapter implements LlmProviderAdapter {
  readonly provider = "gemini" as const;

  async listModels(apiKey: string): Promise<NormalizedModel[]> {
    try {
      const body = (await apiFetch("/models", apiKey)) as {
        models: Array<{
          name: string;
          displayName?: string;
          supportedGenerationMethods: string[];
        }>;
      };

      return (body.models ?? [])
        .filter((m) => isChatCapable(m.name, m.supportedGenerationMethods ?? []))
        .map((m) => {
          const short = stripModelsPrefix(m.name);
          return {
            id: `gemini:${m.name}`,
            provider: "gemini" as const,
            providerModelId: m.name,
            displayName: toDisplayName(m.name, m.displayName),
            supportsChat: true,
            supportsStreaming: (m.supportedGenerationMethods ?? []).includes(
              "streamGenerateContent"
            ),
            supportsTools: true,
            supportsVision: true,
            status: "available" as const,
            isDefaultCandidate: short.includes("2.0-flash") || short.includes("2.5-flash"),
            isPinned: false,
            latencyTier: (short.includes("flash") ? "fast" : "medium") as "fast" | "medium",
            reasoningTier: "standard" as const,
            sortOrder: modelSortOrder(m.name),
          };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder);
    } catch (err) {
      throw normalizeProviderError(err, "gemini", "Failed to list Gemini models");
    }
  }

  async chat(apiKey: string, request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    try {
      // Ensure model path uses the "models/" prefix
      const modelPath = request.modelId.startsWith("models/")
        ? request.modelId
        : `models/${request.modelId}`;

      const systemMsg = request.messages.find((m) => m.role === "system");
      const convoMessages = request.messages.filter((m) => m.role !== "system");

      // Map internal roles: "assistant" → Gemini "model"
      const contents = convoMessages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        },
      };

      if (systemMsg) {
        body.systemInstruction = { parts: [{ text: systemMsg.content }] };
      }

      const resp = (await apiFetch(`/${modelPath}:generateContent`, apiKey, {
        method: "POST",
        body: JSON.stringify(body),
      })) as {
        candidates: Array<{
          content: { parts: Array<{ text?: string }>; role: string };
          finishReason: string;
        }>;
        usageMetadata?: {
          promptTokenCount: number;
          candidatesTokenCount: number;
          totalTokenCount: number;
        };
      };

      const candidate = resp.candidates?.[0];
      const text =
        candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

      const usage = resp.usageMetadata ?? {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
      };

      return {
        provider: "gemini",
        modelId: request.modelId,
        message: { role: "assistant", content: text },
        usage: {
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount,
        },
        finishReason: candidate?.finishReason?.toLowerCase() ?? null,
        error: null,
      };
    } catch (err) {
      throw normalizeProviderError(err, "gemini", "Gemini chat failed");
    }
  }

  async healthCheck(apiKey: string): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await apiFetch("/models?pageSize=1", apiKey);
      return {
        provider: "gemini",
        status: "healthy",
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      const e = normalizeProviderError(err, "gemini", "Health check");
      return {
        provider: "gemini",
        status: e.llmCode === "authentication_error" ? "auth_error" : "unavailable",
        error: e.message,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
