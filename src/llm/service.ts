import type { Logger } from "pino";

import type { AppDatabase } from "../db.js";
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

export class LlmService {
  constructor(
    private readonly registry: LlmProviderRegistry,
    private readonly database: AppDatabase,
    private readonly logger: Logger
  ) {}

  /**
   * Aggregate chat-capable models from all connected providers for this user.
   * Cloud providers use API keys from the DB; local Ollama does not need a key.
   * Providers that fail to respond are silently omitted (logged as warnings).
   */
  async listModels(userId: string): Promise<NormalizedModel[]> {
    const models: NormalizedModel[] = [];

    if (this.registry.hasAdapter("gateway")) {
      try {
        models.push(...(await this.registry.getAdapter("gateway").listModels("")));
      } catch (err) {
        this.logger.warn({ provider: "gateway", err }, "Model listing failed for provider");
      }
    }

    const keys = this.database.listLlmProviderKeys(userId);

    const perProvider = await Promise.allSettled(
      keys.map(async (keyRecord): Promise<NormalizedModel[]> => {
        const apiKey = this.database.decryptLlmProviderKey(userId, keyRecord.provider);
        if (!apiKey) return [];

        if (!this.registry.hasAdapter(keyRecord.provider)) {
          this.logger.warn({ provider: keyRecord.provider }, "No adapter registered for provider");
          return [];
        }

        const adapter = this.registry.getAdapter(keyRecord.provider);
        try {
          return await adapter.listModels(apiKey);
        } catch (err) {
          this.logger.warn(
            { provider: keyRecord.provider, err },
            "Model listing failed for provider"
          );
          return [];
        }
      })
    );

    for (const result of perProvider) {
      if (result.status === "fulfilled") models.push(...result.value);
    }

    // Local Ollama does not require a stored API key — always attempt to list
    if (this.registry.hasAdapter("local")) {
      try {
        const localModels = await this.registry.getAdapter("local").listModels("");
        models.push(...localModels);
      } catch {
        // Ollama not running — omit local models silently
      }
    }

    return models.sort((a, b) => {
      const pp = (PROVIDER_PRIORITY[a.provider] ?? 9) - (PROVIDER_PRIORITY[b.provider] ?? 9);
      return pp !== 0 ? pp : a.sortOrder - b.sortOrder;
    });
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
      const stored = this.database.decryptLlmProviderKey(userId, provider);
      if (!stored) {
        throw new LlmError(
          `No ${provider} API key saved yet. Add it in Settings → LLM providers first (paste and Save key).`,
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
