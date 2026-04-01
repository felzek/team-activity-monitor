import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LlmError } from "../src/llm/errors.js";
import { LlmProviderRegistry } from "../src/llm/registry.js";
import { LlmService } from "../src/llm/service.js";
import type { LlmProviderAdapter, NormalizedChatRequest, NormalizedChatResponse, NormalizedModel, ProviderHealth } from "../src/llm/types.js";
import type { LlmProvider, LlmProviderKey } from "../src/types/auth.js";

// ── Stub database ─────────────────────────────────────────────────────────────

interface StubDb {
  keys: Record<string, string>; // provider → raw api key
  listLlmProviderKeys(userId: string): LlmProviderKey[];
  decryptLlmProviderKey(userId: string, provider: LlmProvider): string | null;
}

function makeDb(keys: Record<string, string>): StubDb {
  return {
    keys,
    listLlmProviderKeys(_userId) {
      return Object.keys(keys).map((p) => ({
        id: `key-${p}`,
        userId: "user1",
        provider: p as LlmProvider,
        displayLabel: `${p}-key`,
        maskedKey: "****",
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    },
    decryptLlmProviderKey(_userId, provider) {
      return keys[provider] ?? null;
    },
  };
}

// ── Stub adapters ─────────────────────────────────────────────────────────────

function makeAdapter(
  provider: LlmProvider,
  models: NormalizedModel[],
  chatResp?: Partial<NormalizedChatResponse>
): LlmProviderAdapter {
  return {
    provider,
    async listModels() {
      return models;
    },
    async chat(_apiKey, req) {
      return {
        provider,
        modelId: req.modelId,
        message: { role: "assistant", content: "ok" },
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        finishReason: "stop",
        error: null,
        ...chatResp,
      };
    },
  };
}

function makeFailingAdapter(provider: LlmProvider, error: Error): LlmProviderAdapter {
  return {
    provider,
    async listModels() {
      throw error;
    },
    async chat() {
      throw error;
    },
  };
}

function model(provider: LlmProvider, id: string, sortOrder = 10): NormalizedModel {
  return {
    id: `${provider}:${id}`,
    provider,
    providerModelId: id,
    displayName: id,
    supportsChat: true,
    supportsStreaming: true,
    supportsTools: false,
    supportsVision: false,
    status: "available",
    isDefaultCandidate: false,
    isPinned: false,
    sortOrder,
  };
}

// ── makeLogger stub ───────────────────────────────────────────────────────────

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

// ── Tests: listModels ─────────────────────────────────────────────────────────

describe("LlmService.listModels", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns empty array when no providers connected", async () => {
    const db = makeDb({});
    const registry = new LlmProviderRegistry();
    const service = new LlmService(registry, db as never, logger);
    const models = await service.listModels("user1");
    expect(models).toEqual([]);
  });

  it("includes Vercel AI Gateway models without requiring a stored user key", async () => {
    const db = makeDb({});
    const registry = new LlmProviderRegistry().register(
      makeAdapter("gateway", [model("gateway", "alibaba/qwen3.5-flash")])
    );
    const service = new LlmService(registry, db as never, logger);
    const models = await service.listModels("user1");
    expect(models).toHaveLength(1);
    expect(models[0].provider).toBe("gateway");
  });

  it("aggregates models from a single provider", async () => {
    const db = makeDb({ claude: "sk-ant-test" });
    const registry = new LlmProviderRegistry().register(
      makeAdapter("claude", [model("claude", "claude-opus")])
    );
    const service = new LlmService(registry, db as never, logger);
    const models = await service.listModels("user1");
    expect(models).toHaveLength(1);
    expect(models[0].provider).toBe("claude");
  });

  it("aggregates models from all three providers", async () => {
    const db = makeDb({ claude: "sk-ant", openai: "sk-oai", gemini: "AIza" });
    const registry = new LlmProviderRegistry()
      .register(makeAdapter("claude", [model("claude", "opus")]))
      .register(makeAdapter("openai", [model("openai", "gpt-4o"), model("openai", "gpt-4o-mini")]))
      .register(makeAdapter("gemini", [model("gemini", "gemini-2.0-flash")]));
    const service = new LlmService(registry, db as never, logger);
    const models = await service.listModels("user1");
    expect(models).toHaveLength(4);
    const providers = [...new Set(models.map((m) => m.provider))];
    expect(providers.sort()).toEqual(["claude", "gemini", "openai"]);
  });

  it("places claude models before openai before gemini", async () => {
    const db = makeDb({ claude: "sk-ant", openai: "sk-oai", gemini: "AIza" });
    const registry = new LlmProviderRegistry()
      .register(makeAdapter("claude", [model("claude", "opus")]))
      .register(makeAdapter("openai", [model("openai", "gpt-4o")]))
      .register(makeAdapter("gemini", [model("gemini", "flash")]));
    const service = new LlmService(registry, db as never, logger);
    const models = await service.listModels("user1");
    expect(models[0].provider).toBe("claude");
    expect(models[1].provider).toBe("openai");
    expect(models[2].provider).toBe("gemini");
  });

  it("silently omits a provider that fails to list models", async () => {
    const db = makeDb({ claude: "sk-ant", openai: "sk-oai" });
    const registry = new LlmProviderRegistry()
      .register(makeAdapter("claude", [model("claude", "opus")]))
      .register(makeFailingAdapter("openai", new Error("HTTP 503")));
    const service = new LlmService(registry, db as never, logger);
    const models = await service.listModels("user1");
    expect(models).toHaveLength(1);
    expect(models[0].provider).toBe("claude");
  });

  it("returns empty array if provider returns invalid/empty model list", async () => {
    const db = makeDb({ openai: "sk-oai" });
    const registry = new LlmProviderRegistry().register(makeAdapter("openai", []));
    const service = new LlmService(registry, db as never, logger);
    const models = await service.listModels("user1");
    expect(models).toEqual([]);
  });

  it("skips provider if key decryption returns null", async () => {
    const db: StubDb = {
      keys: {},
      listLlmProviderKeys: () => [
        {
          id: "k1",
          userId: "u1",
          provider: "openai",
          displayLabel: "****",
          maskedKey: "****",
          connectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      decryptLlmProviderKey: () => null,
    };
    const listSpy = vi.fn().mockResolvedValue([]);
    const registry = new LlmProviderRegistry().register({
      provider: "openai",
      listModels: listSpy,
      chat: vi.fn(),
    });
    const service = new LlmService(registry, db as never, logger);
    await service.listModels("u1");
    expect(listSpy).not.toHaveBeenCalled();
  });
});

// ── Tests: chat ───────────────────────────────────────────────────────────────

describe("LlmService.chat", () => {
  afterEach(() => vi.clearAllMocks());

  const request: NormalizedChatRequest = {
    modelId: "openai:gpt-4o",
    messages: [{ role: "user", content: "Hello" }],
  };

  it("routes to the correct adapter based on modelId prefix", async () => {
    const db = makeDb({ openai: "sk-oai" });
    const chatSpy = vi.fn().mockResolvedValue({
      provider: "openai",
      modelId: "gpt-4o",
      message: { role: "assistant", content: "hi" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: "stop",
      error: null,
    });
    const registry = new LlmProviderRegistry().register({
      provider: "openai",
      listModels: vi.fn(),
      chat: chatSpy,
    });
    const service = new LlmService(registry, db as never, logger);
    const resp = await service.chat("user1", request);
    expect(chatSpy).toHaveBeenCalledOnce();
    // Adapter receives raw model ID (without provider prefix)
    expect(chatSpy.mock.calls[0]![1].modelId).toBe("gpt-4o");
    // Response carries back the original namespaced modelId
    expect(resp.modelId).toBe("openai:gpt-4o");
  });

  it("routes gateway:* models without requiring a stored user key", async () => {
    const db = makeDb({});
    const chatSpy = vi.fn().mockResolvedValue({
      provider: "gateway",
      modelId: "alibaba/qwen3.5-flash",
      message: { role: "assistant", content: "hi" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: "stop",
      error: null,
    });
    const registry = new LlmProviderRegistry().register({
      provider: "gateway",
      listModels: vi.fn(),
      chat: chatSpy,
    });
    const service = new LlmService(registry, db as never, logger);
    const resp = await service.chat("user1", {
      modelId: "gateway:alibaba/qwen3.5-flash",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(chatSpy).toHaveBeenCalledOnce();
    expect(chatSpy.mock.calls[0]![1].modelId).toBe("alibaba/qwen3.5-flash");
    expect(resp.modelId).toBe("gateway:alibaba/qwen3.5-flash");
  });

  it("throws configuration_error if no API key is configured", async () => {
    const db = makeDb({});
    const registry = new LlmProviderRegistry().register(makeAdapter("openai", []));
    const service = new LlmService(registry, db as never, logger);
    await expect(service.chat("user1", request)).rejects.toMatchObject({
      llmCode: "configuration_error",
      provider: "openai",
    });
  });

  it("throws invalid_model for an unknown provider prefix", async () => {
    const db = makeDb({ openai: "sk-oai" });
    const registry = new LlmProviderRegistry().register(makeAdapter("openai", []));
    const service = new LlmService(registry, db as never, logger);
    await expect(
      service.chat("user1", { ...request, modelId: "unknown:some-model" })
    ).rejects.toMatchObject({ llmCode: "invalid_model" });
  });

  it("throws invalid_model for a missing colon separator", async () => {
    const db = makeDb({ openai: "sk-oai" });
    const registry = new LlmProviderRegistry().register(makeAdapter("openai", []));
    const service = new LlmService(registry, db as never, logger);
    await expect(
      service.chat("user1", { ...request, modelId: "gpt-4o" })
    ).rejects.toMatchObject({ llmCode: "invalid_model" });
  });

  it("normalizes provider errors from the adapter", async () => {
    const db = makeDb({ openai: "sk-oai" });
    const registry = new LlmProviderRegistry().register(
      makeFailingAdapter("openai", new Error("401 Unauthorized"))
    );
    const service = new LlmService(registry, db as never, logger);
    await expect(service.chat("user1", request)).rejects.toMatchObject({
      llmCode: "authentication_error",
      provider: "openai",
    });
  });
});

// ── Tests: LlmProviderRegistry.parseModelId ───────────────────────────────────

describe("LlmProviderRegistry.parseModelId", () => {
  it("parses openai:gpt-4o correctly", () => {
    const result = LlmProviderRegistry.parseModelId("openai:gpt-4o");
    expect(result).toEqual({ provider: "openai", providerModelId: "gpt-4o" });
  });

  it("parses claude:claude-opus-4-6 correctly", () => {
    const result = LlmProviderRegistry.parseModelId("claude:claude-opus-4-6");
    expect(result).toEqual({ provider: "claude", providerModelId: "claude-opus-4-6" });
  });

  it("parses gemini with nested model path", () => {
    const result = LlmProviderRegistry.parseModelId("gemini:models/gemini-2.0-flash-001");
    expect(result).toEqual({ provider: "gemini", providerModelId: "models/gemini-2.0-flash-001" });
  });

  it("throws invalid_model when no colon present", () => {
    expect(() => LlmProviderRegistry.parseModelId("gpt-4o")).toThrow(LlmError);
    expect(() => LlmProviderRegistry.parseModelId("gpt-4o")).toThrow(
      expect.objectContaining({ llmCode: "invalid_model" })
    );
  });

  it("throws invalid_model for unknown provider", () => {
    expect(() => LlmProviderRegistry.parseModelId("mistral:mistral-7b")).toThrow(
      expect.objectContaining({ llmCode: "invalid_model" })
    );
  });
});

// ── Tests: provider health isolation ─────────────────────────────────────────

describe("LlmService.getProviderHealth", () => {
  afterEach(() => vi.clearAllMocks());

  it("reports healthy for a working provider", async () => {
    const db = makeDb({ openai: "sk-oai" });
    const adapter = makeAdapter("openai", [model("openai", "gpt-4o")]);
    const registry = new LlmProviderRegistry().register(adapter);
    const service = new LlmService(registry, db as never, logger);
    const health = await service.getProviderHealth("user1");
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({ provider: "openai", status: "healthy" });
  });

  it("reports auth_error when provider returns 401", async () => {
    const db = makeDb({ openai: "sk-oai" });
    const adapter: LlmProviderAdapter = {
      provider: "openai",
      async listModels() {
        throw new LlmError("Unauthorized", { llmCode: "authentication_error", provider: "openai" });
      },
      chat: vi.fn(),
    };
    const registry = new LlmProviderRegistry().register(adapter);
    const service = new LlmService(registry, db as never, logger);
    const health = await service.getProviderHealth("user1");
    expect(health[0]).toMatchObject({ provider: "openai", status: "auth_error" });
  });

  it("returns no_models when provider has zero chat-capable models", async () => {
    const db = makeDb({ gemini: "AIza-test" });
    const adapter = makeAdapter("gemini", []); // empty list
    const registry = new LlmProviderRegistry().register(adapter);
    const service = new LlmService(registry, db as never, logger);
    const health = await service.getProviderHealth("user1");
    expect(health[0]).toMatchObject({ provider: "gemini", status: "no_models" });
  });
});

// ── Tests: provider routing isolation ────────────────────────────────────────

describe("LlmService.chat — provider routing isolation", () => {
  afterEach(() => vi.clearAllMocks());

  const userMsg = { role: "user" as const, content: "Hello" };

  it("routes claude:* only to the Anthropic adapter", async () => {
    const db = makeDb({ claude: "sk-ant", openai: "sk-oai" });
    const claudeChat = vi.fn().mockResolvedValue({
      provider: "claude", modelId: "claude-opus-4-6", message: { role: "assistant", content: "hi" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, finishReason: "stop", error: null,
    });
    const openaiChat = vi.fn();
    const registry = new LlmProviderRegistry()
      .register({ provider: "claude",  listModels: vi.fn(), chat: claudeChat })
      .register({ provider: "openai", listModels: vi.fn(), chat: openaiChat });
    const service = new LlmService(registry, db as never, logger);
    await service.chat("user1", { modelId: "claude:claude-opus-4-6", messages: [userMsg] });
    expect(claudeChat).toHaveBeenCalledOnce();
    expect(openaiChat).not.toHaveBeenCalled();
  });

  it("routes openai:* only to the OpenAI adapter", async () => {
    const db = makeDb({ openai: "sk-oai", claude: "sk-ant", gemini: "AIza" });
    const openaiChat = vi.fn().mockResolvedValue({
      provider: "openai", modelId: "gpt-4o", message: { role: "assistant", content: "hi" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, finishReason: "stop", error: null,
    });
    const claudeChat = vi.fn();
    const geminiChat = vi.fn();
    const registry = new LlmProviderRegistry()
      .register({ provider: "openai", listModels: vi.fn(), chat: openaiChat })
      .register({ provider: "claude",  listModels: vi.fn(), chat: claudeChat })
      .register({ provider: "gemini", listModels: vi.fn(), chat: geminiChat });
    const service = new LlmService(registry, db as never, logger);
    await service.chat("user1", { modelId: "openai:gpt-4o", messages: [userMsg] });
    expect(openaiChat).toHaveBeenCalledOnce();
    expect(claudeChat).not.toHaveBeenCalled();
    expect(geminiChat).not.toHaveBeenCalled();
  });

  it("routes gemini:* only to the Gemini adapter", async () => {
    const db = makeDb({ gemini: "AIza", openai: "sk-oai" });
    const geminiChat = vi.fn().mockResolvedValue({
      provider: "gemini", modelId: "models/gemini-2.0-flash-001", message: { role: "assistant", content: "hi" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, finishReason: "stop", error: null,
    });
    const openaiChat = vi.fn();
    const registry = new LlmProviderRegistry()
      .register({ provider: "gemini", listModels: vi.fn(), chat: geminiChat })
      .register({ provider: "openai", listModels: vi.fn(), chat: openaiChat });
    const service = new LlmService(registry, db as never, logger);
    await service.chat("user1", { modelId: "gemini:models/gemini-2.0-flash-001", messages: [userMsg] });
    expect(geminiChat).toHaveBeenCalledOnce();
    expect(openaiChat).not.toHaveBeenCalled();
  });

  it("passes raw provider model ID to the adapter, not the namespaced ID", async () => {
    const db = makeDb({ openai: "sk-oai" });
    const openaiChat = vi.fn().mockResolvedValue({
      provider: "openai", modelId: "gpt-4o-mini", message: { role: "assistant", content: "hi" },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, finishReason: "stop", error: null,
    });
    const registry = new LlmProviderRegistry()
      .register({ provider: "openai", listModels: vi.fn(), chat: openaiChat });
    const service = new LlmService(registry, db as never, logger);
    await service.chat("user1", { modelId: "openai:gpt-4o-mini", messages: [userMsg] });
    // Adapter must receive "gpt-4o-mini", not "openai:gpt-4o-mini"
    expect(openaiChat.mock.calls[0]![1].modelId).toBe("gpt-4o-mini");
  });

  it("propagates LlmError without masking it when adapter fails", async () => {
    const db = makeDb({ openai: "sk-oai" });
    const registry = new LlmProviderRegistry().register(
      makeFailingAdapter("openai", new LlmError("quota exceeded", { llmCode: "rate_limit_error", provider: "openai" }))
    );
    const service = new LlmService(registry, db as never, logger);
    await expect(
      service.chat("user1", { modelId: "openai:gpt-4o", messages: [userMsg] })
    ).rejects.toMatchObject({ llmCode: "rate_limit_error", provider: "openai" });
  });
});
