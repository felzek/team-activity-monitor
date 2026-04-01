---
name: add-tool
description: Checklist for adding a new tool to the chat pipeline. Covers definitions, executor, system prompt update, and tests.
user-invocable: true
allowed-tools: Read, Edit, Bash
---

Add a new tool to the tool-first chat pipeline.

## Steps

### 1. Define the tool schema in `src/lib/tools/definitions.ts`

Add a new entry to the `ALL_TOOLS` array:

```typescript
{
  name: "your_tool_name",
  description: "One sentence: what data does this return and when should the LLM call it?",
  parameters: {
    type: "object",
    properties: {
      param1: { type: "string", description: "..." },
    },
    required: ["param1"],
  },
}
```

Also add the name to `TOOL_NAMES`:
```typescript
export const TOOL_NAMES = {
  // existing...
  YOUR_TOOL: "your_tool_name",
} as const;
```

### 2. Implement execution in `src/lib/tools/executor.ts`

Add a `case "your_tool_name":` block in `executeSingleTool()`. Follow the cache-through pattern:

```typescript
case TOOL_NAMES.YOUR_TOOL: {
  const { param1 } = args as { param1: string };
  const cacheKey = `provider:resource:${param1}`;
  const cached = ctx.cache.get<YourReturnType>(cacheKey);
  if (cached) {
    return { toolCallId, toolName, output: cached.data, meta: { ...cached, provider: "yourprovider", itemCount: cached.data.length } };
  }
  const data = await fetchFromProvider(param1, ctx);
  ctx.cache.set(cacheKey, data, CACHE_TTL.YOUR_TTL, [`provider:resource:${param1}`]);
  return { toolCallId, toolName, output: data, meta: { fetchedAt: new Date().toISOString(), source: "live" as const, provider: "yourprovider", itemCount: data.length } };
}
```

Add a TTL constant if needed in `CACHE_TTL` in `src/lib/cache.ts`.

### 3. Update the system prompt in `src/lib/chat-pipeline.ts`

If the new tool needs a hint in the system prompt (e.g., which identifiers to use), update `buildSystemPrompt()`.

### 4. Add webhook invalidation (if applicable)

If this tool's data changes via webhook, add `cache.invalidateByTag(...)` in `src/webhooks/github.ts` or `src/webhooks/jira.ts`.

### 5. Write a test

```typescript
// In tests/llm-service.test.ts or a new file
it("your_tool_name returns expected shape", async () => {
  // build ctx with mock tokens/database
  const result = await executeSingleTool({ toolCallId: "1", toolName: "your_tool_name", arguments: { param1: "value" } }, ctx);
  expect(result.error).toBeUndefined();
  expect(result.output).toMatchObject({ /* expected shape */ });
});
```

### 6. Typecheck + test

```bash
npm run typecheck && npm test
```

## Key facts

- Tool names must be `snake_case` strings — LLM uses them verbatim
- `executeSingleTool()` returns `ToolResult`; never throws — catch errors and return `{ ..., error: "message" }`
- `ToolExecutorContext` carries `ctx.cache`, `ctx.database`, `ctx.logger`, `ctx.config`, `ctx.userId`, `ctx.orgId`
- Cache keys convention: `"provider:resourcetype:identifier"` (e.g., `"github:commits:owner/repo"`)
- Cache tags convention: `"provider:resourcetype:identifier"` — used for webhook invalidation
