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
  /** Namespaced: "gateway:alibaba/qwen-3-32b", "openai:gpt-5.4", "claude:claude-sonnet-4-6" */
  id: string;
  provider: LlmProvider;
  /** Raw provider model ID: "alibaba/qwen-3-32b", "gpt-5.4", "claude-sonnet-4-6" */
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

// ── Tool use types ────────────────────────────────────────────────────────────

export interface ToolParameterSchema {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
}

/** Provider-agnostic tool definition (JSON Schema). */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameterSchema>;
    required: string[];
  };
}

/** A single tool call the LLM wants to execute. */
export interface ToolCall {
  /** Provider-assigned call ID — must be echoed back in the tool result. */
  id: string;
  name: string;
  /** Parsed from JSON. */
  arguments: Record<string, unknown>;
}

// ── Chat message types ────────────────────────────────────────────────────────

export interface NormalizedChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** On assistant messages that contained tool calls. */
  toolCalls?: ToolCall[];
  /** On tool-result messages: the ID of the tool call being answered. */
  toolCallId?: string;
  /** On tool-result messages: the tool name. */
  toolName?: string;
}

export interface NormalizedChatRequest {
  /**
   * When coming from the client: namespaced "gateway:alibaba/qwen-3-32b".
   * When coming from the service to an adapter: raw provider ID "alibaba/qwen-3-32b".
   */
  modelId: string;
  messages: NormalizedChatMessage[];
  conversationId?: string;
  stream?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
  /** When present, the adapter enables tool use. */
  tools?: ToolDefinition[];
}

export interface NormalizedChatResponse {
  provider: LlmProvider;
  /** Namespaced model ID as sent in the original request */
  modelId: string;
  message: { role: "assistant"; content: string };
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string | null;
  error: null;
  /**
   * Present when the model wants to call one or more tools instead of
   * returning a final text response. The caller should execute the tools,
   * append results to the message history, and call again.
   */
  toolCalls?: ToolCall[];
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
