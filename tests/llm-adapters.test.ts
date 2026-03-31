import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnthropicAdapter } from "../src/llm/adapters/anthropic.js";
import { GeminiAdapter } from "../src/llm/adapters/gemini.js";
import { OllamaAdapter } from "../src/llm/adapters/ollama.js";
import { OpenAiAdapter } from "../src/llm/adapters/openai.js";
import { LlmError } from "../src/llm/errors.js";
import { LlmProviderRegistry } from "../src/llm/registry.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OPENAI_MODELS_FIXTURE = {
  data: [
    { id: "gpt-4o", created: 1700000000 },
    { id: "gpt-4o-mini", created: 1700000001 },
    { id: "o1", created: 1700000002 },
    { id: "text-embedding-3-small", created: 1700000003 }, // should be excluded
    { id: "whisper-1", created: 1700000004 },               // should be excluded
    { id: "dall-e-3", created: 1700000005 },                // should be excluded
    { id: "gpt-3.5-turbo", created: 1700000006 },
  ],
};

const OPENAI_CHAT_RESPONSE_FIXTURE = {
  model: "gpt-4o-2024-11-20",
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello from OpenAI!" }],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
};

const ANTHROPIC_MODELS_FIXTURE = {
  data: [
    { id: "claude-opus-4-6-20250514", display_name: "Claude Opus 4.6", type: "model", created_at: "2025-01-01T00:00:00Z" },
    { id: "claude-sonnet-4-6-20251022", display_name: "Claude Sonnet 4.6", type: "model", created_at: "2025-01-01T00:00:00Z" },
    { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5", type: "model", created_at: "2025-01-01T00:00:00Z" },
  ],
};

const ANTHROPIC_CHAT_RESPONSE_FIXTURE = {
  id: "msg_abc123",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Hello from Anthropic!" }],
  model: "claude-opus-4-6-20250514",
  stop_reason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 8 },
};

const GEMINI_MODELS_FIXTURE = {
  models: [
    {
      name: "models/gemini-2.0-flash-001",
      displayName: "Gemini 2.0 Flash",
      supportedGenerationMethods: ["generateContent", "countTokens", "streamGenerateContent"],
    },
    {
      name: "models/gemini-2.5-pro-preview-001",
      displayName: "Gemini 2.5 Pro Preview",
      supportedGenerationMethods: ["generateContent", "countTokens"],
    },
    {
      name: "models/text-embedding-004",       // should be excluded
      displayName: "Text Embedding 004",
      supportedGenerationMethods: ["embedContent"],
    },
  ],
};

const GEMINI_CHAT_RESPONSE_FIXTURE = {
  candidates: [
    {
      content: { parts: [{ text: "Hello from Gemini!" }], role: "model" },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 6, totalTokenCount: 14 },
};

const OLLAMA_TAGS_FIXTURE = {
  models: [
    { name: "qwen2.5:7b", model: "qwen2.5:7b", modified_at: "2024-01-01T00:00:00Z", details: { parameter_size: "7B" } },
    { name: "llama3.2:3b", model: "llama3.2:3b", modified_at: "2024-01-01T00:00:00Z", details: { parameter_size: "3B" } },
  ],
};

const OLLAMA_CHAT_RESPONSE_FIXTURE = {
  message: { role: "assistant", content: "Hello from Ollama!" },
  done: true,
  prompt_eval_count: 15,
  eval_count: 7,
};

const GEMINI_TOOL_CALL_RESPONSE_FIXTURE = {
  candidates: [
    {
      content: {
        parts: [{ functionCall: { name: "getJiraIssues", args: { project: "ENG", limit: 10 } } }],
        role: "model",
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  let call = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const r = responses[call++ % responses.length]!;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function mockFetchThrows(error: Error) {
  return vi.spyOn(globalThis, "fetch").mockRejectedValue(error);
}

function ok(body: unknown) {
  return { ok: true, status: 200, body };
}

function fail(status: number, message: string) {
  return { ok: false, status, body: { error: { message } } };
}

// ── OpenAI adapter ────────────────────────────────────────────────────────────

describe("OpenAiAdapter", () => {
  let adapter: OpenAiAdapter;

  beforeEach(() => {
    adapter = new OpenAiAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists only chat-capable models", async () => {
    mockFetch([ok(OPENAI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-test");
    const ids = models.map((m) => m.providerModelId);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4o-mini");
    expect(ids).toContain("o1");
    expect(ids).toContain("gpt-3.5-turbo");
    // Excluded models must not appear
    expect(ids).not.toContain("text-embedding-3-small");
    expect(ids).not.toContain("whisper-1");
    expect(ids).not.toContain("dall-e-3");
  });

  it("returns namespaced model IDs", async () => {
    mockFetch([ok(OPENAI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-test");
    expect(models[0].id).toMatch(/^openai:/);
  });

  it("marks gpt-4o as default candidate", async () => {
    mockFetch([ok(OPENAI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-test");
    const gpt4o = models.find((m) => m.providerModelId === "gpt-4o");
    expect(gpt4o?.isDefaultCandidate).toBe(true);
  });

  it("marks o1 as extended reasoning tier", async () => {
    mockFetch([ok(OPENAI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-test");
    const o1 = models.find((m) => m.providerModelId === "o1");
    expect(o1?.reasoningTier).toBe("extended");
  });

  it("sends chat to Responses API and normalizes response", async () => {
    mockFetch([ok(OPENAI_CHAT_RESPONSE_FIXTURE)]);
    const resp = await adapter.chat("sk-test", {
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(resp.provider).toBe("openai");
    expect(resp.message.role).toBe("assistant");
    expect(resp.message.content).toBe("Hello from OpenAI!");
    expect(resp.usage.inputTokens).toBe(10);
    expect(resp.usage.outputTokens).toBe(5);
    expect(resp.usage.totalTokens).toBe(15);
    expect(resp.finishReason).toBe("stop");
    expect(resp.error).toBeNull();
  });

  it("extracts system message as instructions field", async () => {
    const fetchSpy = mockFetch([ok(OPENAI_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("sk-test", {
      modelId: "gpt-4o",
      messages: [
        { role: "system", content: "You are a pirate." },
        { role: "user", content: "Hello" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.instructions).toBe("You are a pirate.");
    // System message must NOT appear in input array
    expect(body.input.every((m: { role: string }) => m.role !== "system")).toBe(true);
  });

  it("throws LlmError with authentication_error code on 401", async () => {
    mockFetch([fail(401, "Incorrect API key provided")]);
    await expect(adapter.listModels("bad-key")).rejects.toMatchObject({
      llmCode: "authentication_error",
      provider: "openai",
    });
  });

  it("throws LlmError with rate_limit_error code on 429", async () => {
    mockFetch([fail(429, "Rate limit exceeded")]);
    await expect(adapter.chat("sk-test", {
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    })).rejects.toMatchObject({
      llmCode: "rate_limit_error",
      retryable: true,
    });
  });
});

// ── Anthropic adapter ─────────────────────────────────────────────────────────

describe("AnthropicAdapter", () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    adapter = new AnthropicAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists models and preserves API display names", async () => {
    mockFetch([ok(ANTHROPIC_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-ant-test");
    expect(models).toHaveLength(3);
    const opus = models.find((m) => m.providerModelId.includes("opus"));
    expect(opus?.displayName).toBe("Claude Opus 4.6");
  });

  it("returns namespaced model IDs with claude: prefix", async () => {
    mockFetch([ok(ANTHROPIC_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-ant-test");
    expect(models.every((m) => m.id.startsWith("claude:"))).toBe(true);
  });

  it("marks haiku as fast latency tier", async () => {
    mockFetch([ok(ANTHROPIC_MODELS_FIXTURE)]);
    const models = await adapter.listModels("sk-ant-test");
    const haiku = models.find((m) => m.providerModelId.includes("haiku"));
    expect(haiku?.latencyTier).toBe("fast");
  });

  it("sends system message via top-level system field", async () => {
    const fetchSpy = mockFetch([ok(ANTHROPIC_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("sk-ant-test", {
      modelId: "claude-opus-4-6-20250514",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "What is 2+2?" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.system).toBe("Be brief.");
    expect(body.messages.every((m: { role: string }) => m.role !== "system")).toBe(true);
  });

  it("normalizes Messages API response correctly", async () => {
    mockFetch([ok(ANTHROPIC_CHAT_RESPONSE_FIXTURE)]);
    const resp = await adapter.chat("sk-ant-test", {
      modelId: "claude-opus-4-6-20250514",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(resp.provider).toBe("claude");
    expect(resp.message.content).toBe("Hello from Anthropic!");
    expect(resp.usage.inputTokens).toBe(12);
    expect(resp.usage.outputTokens).toBe(8);
    expect(resp.usage.totalTokens).toBe(20);
    expect(resp.finishReason).toBe("end_turn");
    expect(resp.error).toBeNull();
  });

  it("throws LlmError with authentication_error on 401", async () => {
    mockFetch([fail(401, "Invalid x-api-key")]);
    await expect(adapter.listModels("bad-key")).rejects.toMatchObject({
      llmCode: "authentication_error",
      provider: "claude",
    });
  });
});

// ── Gemini adapter ────────────────────────────────────────────────────────────

describe("GeminiAdapter", () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    adapter = new GeminiAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists only generateContent-capable models", async () => {
    mockFetch([ok(GEMINI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("AIza-test");
    const names = models.map((m) => m.providerModelId);
    expect(names).toContain("models/gemini-2.0-flash-001");
    expect(names).toContain("models/gemini-2.5-pro-preview-001");
    expect(names).not.toContain("models/text-embedding-004");
  });

  it("uses API displayName when available", async () => {
    mockFetch([ok(GEMINI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("AIza-test");
    const flash = models.find((m) => m.providerModelId === "models/gemini-2.0-flash-001");
    expect(flash?.displayName).toBe("Gemini 2.0 Flash");
  });

  it("marks flash models as fast latency tier", async () => {
    mockFetch([ok(GEMINI_MODELS_FIXTURE)]);
    const models = await adapter.listModels("AIza-test");
    const flash = models.find((m) => m.providerModelId.includes("flash"));
    expect(flash?.latencyTier).toBe("fast");
  });

  it("maps assistant role to Gemini model role in request", async () => {
    const fetchSpy = mockFetch([ok(GEMINI_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("AIza-test", {
      modelId: "models/gemini-2.0-flash-001",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
        { role: "user", content: "How are you?" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.contents[1].role).toBe("model"); // "assistant" → "model"
  });

  it("sends system prompt as systemInstruction field", async () => {
    const fetchSpy = mockFetch([ok(GEMINI_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("AIza-test", {
      modelId: "models/gemini-2.0-flash-001",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.systemInstruction.parts[0].text).toBe("Be concise.");
    expect(body.contents.every((c: { role: string }) => c.role !== "system")).toBe(true);
  });

  it("normalizes generateContent response correctly", async () => {
    mockFetch([ok(GEMINI_CHAT_RESPONSE_FIXTURE)]);
    const resp = await adapter.chat("AIza-test", {
      modelId: "models/gemini-2.0-flash-001",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(resp.provider).toBe("gemini");
    expect(resp.message.content).toBe("Hello from Gemini!");
    expect(resp.usage.inputTokens).toBe(8);
    expect(resp.usage.outputTokens).toBe(6);
    expect(resp.usage.totalTokens).toBe(14);
    expect(resp.finishReason).toBe("stop");
    expect(resp.error).toBeNull();
  });

  it("throws LlmError with authentication_error on 403", async () => {
    mockFetch([fail(403, "API key not valid")]);
    await expect(adapter.listModels("bad-key")).rejects.toMatchObject({
      llmCode: "authentication_error",
      provider: "gemini",
    });
  });
});

// ── Gemini adapter — tool calling ─────────────────────────────────────────────

describe("GeminiAdapter — tool calling", () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    adapter = new GeminiAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes tools field in request body when tools are provided", async () => {
    const fetchSpy = mockFetch([ok(GEMINI_TOOL_CALL_RESPONSE_FIXTURE)]);
    await adapter.chat("AIza-test", {
      modelId: "models/gemini-2.0-flash-001",
      messages: [{ role: "user", content: "Show open Jira issues" }],
      tools: [
        {
          name: "getJiraIssues",
          description: "Fetch Jira issues",
          parameters: { type: "object", properties: { project: { type: "string" }, limit: { type: "number" } } },
        },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.tools).toBeDefined();
    expect(body.tools[0].functionDeclarations[0].name).toBe("getJiraIssues");
  });

  it("returns toolCalls when response contains functionCall parts", async () => {
    mockFetch([ok(GEMINI_TOOL_CALL_RESPONSE_FIXTURE)]);
    const resp = await adapter.chat("AIza-test", {
      modelId: "models/gemini-2.0-flash-001",
      messages: [{ role: "user", content: "Show open Jira issues" }],
      tools: [
        {
          name: "getJiraIssues",
          description: "Fetch Jira issues",
          parameters: { type: "object", properties: {} },
        },
      ],
    });
    expect(resp.finishReason).toBe("tool_calls");
    expect(resp.toolCalls).toHaveLength(1);
    expect(resp.toolCalls![0].name).toBe("getJiraIssues");
    expect(resp.toolCalls![0].arguments).toEqual({ project: "ENG", limit: 10 });
    // Synthesized ID includes the function name
    expect(resp.toolCalls![0].id).toMatch(/gemini-0-getJiraIssues/);
    // Content is empty for tool-call responses
    expect(resp.message.content).toBe("");
  });

  it("maps role:tool messages to functionResponse parts in contents", async () => {
    const fetchSpy = mockFetch([ok(GEMINI_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("AIza-test", {
      modelId: "models/gemini-2.0-flash-001",
      messages: [
        { role: "user", content: "Show issues" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "gemini-0-getJiraIssues", name: "getJiraIssues", arguments: {} }],
        },
        { role: "tool", content: JSON.stringify({ issues: [] }), toolName: "getJiraIssues", toolCallId: "gemini-0-getJiraIssues" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    // Last content turn should be role:"user" with functionResponse
    const toolTurn = body.contents.find((c: { role: string }) => c.role === "user" && c.parts?.[0]?.functionResponse);
    expect(toolTurn).toBeDefined();
    expect(toolTurn.parts[0].functionResponse.name).toBe("getJiraIssues");
    expect(toolTurn.parts[0].functionResponse.response).toEqual({ issues: [] });
  });

  it("maps assistant messages with toolCalls to functionCall parts", async () => {
    const fetchSpy = mockFetch([ok(GEMINI_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("AIza-test", {
      modelId: "models/gemini-2.0-flash-001",
      messages: [
        { role: "user", content: "Show issues" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "gemini-0-search", name: "search", arguments: { q: "ENG" } }],
        },
        { role: "tool", content: "{}", toolName: "search", toolCallId: "gemini-0-search" },
        { role: "user", content: "Thanks" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const modelTurn = body.contents.find(
      (c: { role: string; parts: Array<{ functionCall?: unknown }> }) =>
        c.role === "model" && c.parts?.[0]?.functionCall
    );
    expect(modelTurn).toBeDefined();
    expect((modelTurn.parts[0].functionCall as { name: string }).name).toBe("search");
  });
});

// ── OllamaAdapter ─────────────────────────────────────────────────────────────

describe("OllamaAdapter", () => {
  const BASE_URL = "http://localhost:11434/api";
  let adapter: OllamaAdapter;

  beforeEach(() => {
    adapter = new OllamaAdapter(BASE_URL, "qwen2.5:7b", "10m");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // listModels ----------------------------------------------------------------

  it("lists pulled models with local: namespaced IDs", async () => {
    mockFetch([ok(OLLAMA_TAGS_FIXTURE)]);
    const models = await adapter.listModels("");
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("local:qwen2.5:7b");
    expect(models[0].provider).toBe("local");
    expect(models[1].id).toBe("local:llama3.2:3b");
  });

  it("marks the configured defaultModel as isDefaultCandidate and isPinned", async () => {
    mockFetch([ok(OLLAMA_TAGS_FIXTURE)]);
    const models = await adapter.listModels("");
    const def = models.find((m) => m.providerModelId === "qwen2.5:7b");
    expect(def?.isDefaultCandidate).toBe(true);
    expect(def?.isPinned).toBe(true);
    const other = models.find((m) => m.providerModelId === "llama3.2:3b");
    expect(other?.isDefaultCandidate).toBe(false);
  });

  it("marks all local models as supportsTools: false", async () => {
    mockFetch([ok(OLLAMA_TAGS_FIXTURE)]);
    const models = await adapter.listModels("");
    expect(models.every((m) => m.supportsTools === false)).toBe(true);
  });

  it("returns empty array when Ollama is not running", async () => {
    mockFetchThrows(new TypeError("fetch failed"));
    const models = await adapter.listModels("");
    expect(models).toEqual([]);
  });

  it("returns empty array on non-OK response from /tags", async () => {
    mockFetch([{ ok: false, status: 503, body: {} }]);
    const models = await adapter.listModels("");
    expect(models).toEqual([]);
  });

  // chat ----------------------------------------------------------------------

  it("posts to /chat with correct body shape", async () => {
    const fetchSpy = mockFetch([ok(OLLAMA_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("", {
      modelId: "qwen2.5:7b",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/chat");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("qwen2.5:7b");
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: "system", content: "Be brief." });
    expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  it("normalizes Ollama chat response correctly", async () => {
    mockFetch([ok(OLLAMA_CHAT_RESPONSE_FIXTURE)]);
    const resp = await adapter.chat("", {
      modelId: "qwen2.5:7b",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(resp.provider).toBe("local");
    expect(resp.message.role).toBe("assistant");
    expect(resp.message.content).toBe("Hello from Ollama!");
    expect(resp.usage.inputTokens).toBe(15);
    expect(resp.usage.outputTokens).toBe(7);
    expect(resp.usage.totalTokens).toBe(22);
    expect(resp.finishReason).toBe("stop");
    expect(resp.error).toBeNull();
  });

  it("strips role:tool messages before sending to Ollama", async () => {
    const fetchSpy = mockFetch([ok(OLLAMA_CHAT_RESPONSE_FIXTURE)]);
    await adapter.chat("", {
      modelId: "qwen2.5:7b",
      messages: [
        { role: "user", content: "Show issues" },
        { role: "tool", content: "{}", toolName: "search", toolCallId: "x" },
        { role: "user", content: "Thanks" },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages.every((m: { role: string }) => m.role !== "tool")).toBe(true);
    expect(body.messages).toHaveLength(2);
  });

  it("throws invalid_model LlmError on 404", async () => {
    mockFetch([{ ok: false, status: 404, body: { error: "model not found" } }]);
    await expect(
      adapter.chat("", { modelId: "missing:model", messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({
      llmCode: "invalid_model",
      provider: "local",
    });
  });

  it("throws provider_unavailable when Ollama server is unreachable", async () => {
    mockFetchThrows(new TypeError("fetch failed"));
    await expect(
      adapter.chat("", { modelId: "qwen2.5:7b", messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({
      llmCode: "provider_unavailable",
      provider: "local",
    });
  });

  // healthCheck ---------------------------------------------------------------

  it("returns healthy status when models are pulled", async () => {
    mockFetch([ok(OLLAMA_TAGS_FIXTURE)]);
    const health = await adapter.healthCheck("");
    expect(health.provider).toBe("local");
    expect(health.status).toBe("healthy");
    expect(health.latencyMs).toBeTypeOf("number");
  });

  it("returns no_models status when Ollama runs but nothing is pulled", async () => {
    mockFetch([ok({ models: [] })]);
    const health = await adapter.healthCheck("");
    expect(health.status).toBe("no_models");
  });

  it("returns unavailable status when Ollama is not running", async () => {
    mockFetchThrows(new TypeError("fetch failed"));
    const health = await adapter.healthCheck("");
    expect(health.status).toBe("unavailable");
    expect(health.error).toMatch(/not reachable/);
  });
});

// ── LlmProviderRegistry ───────────────────────────────────────────────────────

describe("LlmProviderRegistry.parseModelId", () => {
  it("parses a standard cloud model ID", () => {
    const result = LlmProviderRegistry.parseModelId("openai:gpt-4o");
    expect(result).toEqual({ provider: "openai", providerModelId: "gpt-4o" });
  });

  it("parses a local model ID with colon in the model name", () => {
    // "local:qwen2.5:7b" — colon appears in both prefix and model name
    const result = LlmProviderRegistry.parseModelId("local:qwen2.5:7b");
    expect(result).toEqual({ provider: "local", providerModelId: "qwen2.5:7b" });
  });

  it("parses claude provider", () => {
    const result = LlmProviderRegistry.parseModelId("claude:claude-opus-4-6-20250514");
    expect(result).toEqual({ provider: "claude", providerModelId: "claude-opus-4-6-20250514" });
  });

  it("parses gemini provider with models/ path prefix", () => {
    const result = LlmProviderRegistry.parseModelId("gemini:models/gemini-2.0-flash-001");
    expect(result).toEqual({ provider: "gemini", providerModelId: "models/gemini-2.0-flash-001" });
  });

  it("throws invalid_model for a model ID with no colon", () => {
    expect(() => LlmProviderRegistry.parseModelId("gpt-4o")).toThrow(
      expect.objectContaining({ llmCode: "invalid_model" })
    );
  });

  it("throws invalid_model for an empty string", () => {
    expect(() => LlmProviderRegistry.parseModelId("")).toThrow(
      expect.objectContaining({ llmCode: "invalid_model" })
    );
  });

  it("throws invalid_model for an unknown provider", () => {
    expect(() => LlmProviderRegistry.parseModelId("mistral:mistral-7b")).toThrow(
      expect.objectContaining({ llmCode: "invalid_model", statusCode: 400 })
    );
  });
});

// ── LlmError normalization ────────────────────────────────────────────────────

describe("LlmError", () => {
  it("is an instance of Error", () => {
    const err = new LlmError("Test", { llmCode: "authentication_error", provider: "openai" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LlmError);
  });

  it("carries llmCode and provider", () => {
    const err = new LlmError("Bad key", { llmCode: "authentication_error", provider: "claude" });
    expect(err.llmCode).toBe("authentication_error");
    expect(err.provider).toBe("claude");
    expect(err.statusCode).toBe(401);
    expect(err.retryable).toBe(false);
  });

  it("marks rate limit errors as retryable", () => {
    const err = new LlmError("Too many requests", {
      llmCode: "rate_limit_error",
      provider: "gemini",
      retryable: true,
    });
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(429);
  });
});
