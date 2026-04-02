import type { Logger } from "pino";

import type { AppDatabase } from "../db.js";
import type { LlmProvider } from "../types/auth.js";
import { LlmError, normalizeProviderError } from "./errors.js";
import { LlmProviderRegistry } from "./registry.js";
import type {
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedModel,
  ProviderHealth,
} from "./types.js";

/**
 * Provider display priority — lower = shown first in sorted results.
 * local is intentionally last since the UI groups local models separately.
 */
const PROVIDER_PRIORITY: Record<string, number> = {
  gateway: 0,
  claude: 1,
  openai: 2,
  gemini: 3,
  local: 99,
};

type KeyedProvider = Extract<LlmProvider, "claude" | "openai" | "gemini">;

const PROVIDER_LABELS: Record<KeyedProvider, string> = {
  claude: "Anthropic Claude",
  openai: "OpenAI",
  gemini: "Google Gemini",
};

const BYOK_PLACEHOLDERS: Record<KeyedProvider, Omit<NormalizedModel, "availabilityReason">> = {
  claude: {
    id: "claude:claude-sonnet-4-6-20251022",
    provider: "claude",
    providerModelId: "claude-sonnet-4-6-20251022",
    displayName: "Claude Sonnet 4.6",
    supportsChat: true,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    status: "unavailable",
    isDefaultCandidate: false,
    isPinned: false,
    sortOrder: 20,
  },
  openai: {
    id: "openai:gpt-5.4",
    provider: "openai",
    providerModelId: "gpt-5.4",
    displayName: "GPT-5.4",
    supportsChat: true,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    status: "unavailable",
    isDefaultCandidate: false,
    isPinned: false,
    sortOrder: 5,
  },
  gemini: {
    id: "gemini:models/gemini-2.0-flash-001",
    provider: "gemini",
    providerModelId: "models/gemini-2.0-flash-001",
    displayName: "Gemini 2.0 Flash",
    supportsChat: true,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    status: "unavailable",
    isDefaultCandidate: false,
    isPinned: false,
    sortOrder: 30,
  },
};

export class LlmService {
  constructor(
    private readonly registry: LlmProviderRegistry,
    private readonly database: AppDatabase,
    private readonly logger: Logger,
    private readonly fallbackApiKeys: Partial<Record<KeyedProvider, string>> = {}
  ) {}

  private resolveApiKey(userId: string, provider: KeyedProvider): string | null {
    const storedKey = this.database.decryptLlmProviderKey(userId, provider);
    if (storedKey) {
      return storedKey;
    }

    return this.fallbackApiKeys[provider] ?? null;
  }

  private buildUnavailableProviderModel(
    provider: KeyedProvider,
    availabilityReason: string
  ): NormalizedModel {
    return {
      ...BYOK_PLACEHOLDERS[provider],
      availabilityReason,
    };
  }

  private sortModels(models: NormalizedModel[]): NormalizedModel[] {
    return models.sort((a, b) => {
      const pp = (PROVIDER_PRIORITY[a.provider] ?? 9) - (PROVIDER_PRIORITY[b.provider] ?? 9);
      return pp !== 0 ? pp : a.sortOrder - b.sortOrder;
    });
  }

  private async listGatewayModels(): Promise<NormalizedModel[]> {
    if (!this.registry.hasAdapter("gateway")) {
      return [];
    }

    try {
      const models = await this.registry.getAdapter("gateway").listModels("");
      if (models.length === 0 || models.some((model) => model.isPinned || model.isDefaultCandidate)) {
        return models;
      }

      const [firstModel, ...rest] = models;
      return [
        {
          ...firstModel,
          isPinned: true,
          isDefaultCandidate: true,
        },
        ...rest,
      ];
    } catch (err) {
      this.logger.warn({ provider: "gateway", err }, "Model listing failed for provider");
      return [];
    }
  }

  private async listLocalModels(): Promise<NormalizedModel[]> {
    if (!this.registry.hasAdapter("local")) {
      return [];
    }

    try {
      return await this.registry.getAdapter("local").listModels("");
    } catch {
      return [];
    }
  }

  /**
   * Aggregate chat-capable models from all connected providers for this user.
   * Cloud providers use API keys from the DB; local Ollama does not need a key.
   * Providers that fail to respond are silently omitted (logged as warnings).
   */
  async listModels(userId: string): Promise<NormalizedModel[]> {
    const models: NormalizedModel[] = [];

    models.push(...(await this.listGatewayModels()));

    for (const provider of ["claude", "openai", "gemini"] as const) {
      const apiKey = this.resolveApiKey(userId, provider);
      if (!apiKey) {
        models.push(
          this.buildUnavailableProviderModel(
            provider,
            `Add your ${PROVIDER_LABELS[provider]} key in Settings to enable this model.`
          )
        );
        continue;
      }

      if (!this.registry.hasAdapter(provider)) {
        models.push(
          this.buildUnavailableProviderModel(
            provider,
            `${PROVIDER_LABELS[provider]} is not available in this deployment.`
          )
        );
        continue;
      }

      const adapter = this.registry.getAdapter(provider);
      try {
        const providerModels = await adapter.listModels(apiKey);
        if (providerModels.length === 0) {
          models.push(
            this.buildUnavailableProviderModel(
              provider,
              `${PROVIDER_LABELS[provider]} did not return any chat-capable models.`
            )
          );
          continue;
        }

        models.push(...providerModels);
      } catch (err) {
        this.logger.warn({ provider, err }, "Model listing failed for provider");
        models.push(
          this.buildUnavailableProviderModel(
            provider,
            `${PROVIDER_LABELS[provider]} is unavailable right now.`
          )
        );
      }
    }

    models.push(...(await this.listLocalModels()));

    return this.sortModels(models);
  }

  async listPublicModels(): Promise<NormalizedModel[]> {
    const gatewayModels = await this.listGatewayModels();
    if (gatewayModels.length > 0) {
      return this.sortModels(gatewayModels);
    }

    return this.sortModels(await this.listLocalModels());
  }

  /**
   * Route a chat request to the correct provider based on the namespaced modelId.
   * Local models ("local:*") do not require a stored API key.
   * Throws LlmError for missing keys, unknown providers, or adapter failures.
   */
  async chat(userId: string, request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const { provider, providerModelId } = LlmProviderRegistry.parseModelId(request.modelId);

    let apiKey: string;
    if (provider === "local" || provider === "gateway") {
      // Ollama does not require a stored key — use the registered adapter directly
      apiKey = "";
    } else {
      const stored = this.resolveApiKey(userId, provider);
      if (!stored) {
        throw new LlmError(
          `No ${provider} API key is configured for this account or the server default. Add it in Settings → LLM providers first if you want a personal key.`,
          { llmCode: "configuration_error", provider, statusCode: 422 }
        );
      }
      apiKey = stored;
    }

    const adapter = this.registry.getAdapter(provider);

    try {
      const resp = await adapter.chat(apiKey, {
        ...request,
        modelId: providerModelId, // pass raw provider model ID to the adapter
      });
      // Return the caller's original namespaced modelId, not the raw provider ID
      return { ...resp, modelId: request.modelId };
    } catch (err) {
      throw normalizeProviderError(err, provider, "Chat request failed");
    }
  }

  /**
   * Check connectivity for all connected providers, including local Ollama.
   * Uses adapter.healthCheck() when available, falls back to listing models.
   */
  async getProviderHealth(userId: string): Promise<ProviderHealth[]> {
    const keys = this.database.listLlmProviderKeys(userId);

    const results = await Promise.allSettled(
      keys.map(async (keyRecord): Promise<ProviderHealth> => {
        const apiKey = this.database.decryptLlmProviderKey(userId, keyRecord.provider);
        if (!apiKey) {
          return {
            provider: keyRecord.provider,
            status: "auth_error",
            error: "Failed to decrypt API key.",
            checkedAt: new Date().toISOString(),
          };
        }

        if (!this.registry.hasAdapter(keyRecord.provider)) {
          return {
            provider: keyRecord.provider,
            status: "unavailable",
            error: "No adapter registered.",
            checkedAt: new Date().toISOString(),
          };
        }

        const adapter = this.registry.getAdapter(keyRecord.provider);

        if (adapter.healthCheck) {
          return adapter.healthCheck(apiKey);
        }

        // Fallback: attempt model listing
        try {
          const models = await adapter.listModels(apiKey);
          return {
            provider: keyRecord.provider,
            status: models.length === 0 ? "no_models" : "healthy",
            checkedAt: new Date().toISOString(),
          };
        } catch (err) {
          const normalized = normalizeProviderError(err, keyRecord.provider, "Health check");
          return {
            provider: keyRecord.provider,
            status: normalized.llmCode === "authentication_error" ? "auth_error" : "unavailable",
            error: normalized.message,
            checkedAt: new Date().toISOString(),
          };
        }
      })
    );

    const healths: ProviderHealth[] = results
      .filter((r): r is PromiseFulfilledResult<ProviderHealth> => r.status === "fulfilled")
      .map((r) => r.value);

    if (this.registry.hasAdapter("gateway")) {
      const gatewayAdapter = this.registry.getAdapter("gateway");
      if (gatewayAdapter.healthCheck) {
        const gatewayHealth = await gatewayAdapter.healthCheck("").catch(
          (): ProviderHealth => ({
            provider: "gateway",
            status: "unavailable",
            error: "Health check failed",
            checkedAt: new Date().toISOString(),
          })
        );
        healths.push(gatewayHealth);
      }
    }

    // Always check local Ollama health (no DB key needed)
    if (this.registry.hasAdapter("local")) {
      const localAdapter = this.registry.getAdapter("local");
      if (localAdapter.healthCheck) {
        const localHealth = await localAdapter.healthCheck("").catch((): ProviderHealth => ({
          provider: "local",
          status: "unavailable",
          error: "Health check failed",
          checkedAt: new Date().toISOString(),
        }));
        healths.push(localHealth);
      }
    }

    return healths;
  }
}
