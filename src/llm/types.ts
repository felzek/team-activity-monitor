import type { LlmProvider } from "../types/auth.js";

export type { LlmProvider };

export type LlmErrorCode =
  | "configuration_error"
  | "authentication_error"
  | "authorization_error"
  | "rate_limit_error"
  | "provider_unavailable"
  | "invalid_model"
  | "validation_error"
  | "timeout_error"
  | "unknown_provider_error"
  | "unknown_error";

export type ModelStatus = "available" | "deprecated" | "unavailable";
export type LatencyTier = "fast" | "medium" | "slow";
export type ReasoningTier = "standard" | "extended";
export type ProviderHealthStatus =
  | "healthy"
  | "auth_error"
  | "unavailable"
  | "no_models"
  | "not_configured";

export interface NormalizedModel {
  /** Namespaced: "openai:gpt-4o", "claude:claude-opus-4-6", "gemini:models/gemini-2.0-flash-001" */
  id: string;
  provider: LlmProvider;
  /** Raw provider model ID: "gpt-4o", "claude-opus-4-6", "models/gemini-2.0-flash-001" */
  providerModelId: string;
  displayName: string;
  supportsChat: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  status: ModelStatus;
  isDefaultCandidate: boolean;
  isPinned: boolean;
  latencyTier?: LatencyTier;
  reasoningTier?: ReasoningTier;
  /** Lower = higher priority in sorted list */
  sortOrder: number;
}

export interface NormalizedChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface NormalizedChatRequest {
  /**
   * When coming from the client: namespaced "openai:gpt-4o".
   * When coming from the service to an adapter: raw provider ID "gpt-4o".
   */
  modelId: string;
  messages: NormalizedChatMessage[];
  conversationId?: string;
  stream?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface NormalizedChatResponse {
  provider: LlmProvider;
  /** Namespaced model ID as sent in the original request */
  modelId: string;
  message: { role: "assistant"; content: string };
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string | null;
  error: null;
}

export interface ProviderHealth {
  provider: LlmProvider;
  status: ProviderHealthStatus;
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}

export interface LlmProviderAdapter {
  readonly provider: LlmProvider;
  /** apiKey is the raw (decrypted) key */
  listModels(apiKey: string): Promise<NormalizedModel[]>;
  /** request.modelId is the raw provider model ID (not namespaced) */
  chat(apiKey: string, request: NormalizedChatRequest): Promise<NormalizedChatResponse>;
  healthCheck?(apiKey: string): Promise<ProviderHealth>;
}
