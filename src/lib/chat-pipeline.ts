/**
 * Tool-first multi-turn chat pipeline.
 *
 * Flow per user message:
 *  1. Build system prompt with org context + tool inventory
 *  2. Send to LLM with tool definitions
 *  3. If LLM returns tool calls → execute all in parallel → append results → repeat
 *  4. If LLM returns final text → return ChatTurnResult
 *  5. Hard stop after MAX_TOOL_ITERATIONS to prevent runaway loops
 *
 * The LLM is responsible for deciding:
 *  - Which sources to query (not every query needs both Jira + GitHub)
 *  - Whether to follow up with a second tool call
 *  - How to synthesize the final answer from tool results
 *
 * Grounding guarantee: the system prompt forbids the LLM from stating facts
 * not present in tool results. Any claim not backed by a tool response must
 * be explicitly caveated.
 */

import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import type { LlmService } from "../llm/service.js";
import type { NormalizedChatMessage, ToolCall } from "../llm/types.js";
import type { TeamMember } from "../types/activity.js";
import type { ActivityCache } from "./cache.js";
import { ALL_TOOLS } from "./tools/definitions.js";
import { executeToolCall } from "./tools/executor.js";
import type { ToolExecutorContext, ToolResult } from "./tools/executor.js";

const MAX_TOOL_ITERATIONS = 6;

export interface ChatTurnOptions {
  userId: string;
  organizationId: string;
  modelId: string;
  timezone: string;
  githubToken?: string;
  jiraToken?: string;
  jiraSiteId?: string;
  teamMembers: TeamMember[];
  config: AppConfig;
  database: AppDatabase;
  logger: Logger;
  cache: ActivityCache;
}

export interface SourceSummary {
  provider: "jira" | "github" | "internal";
  fetchedAt: string;
  itemCount?: number;
  cacheAgeMs?: number;
  source: "live" | "cached";
}

export interface PartialFailure {
  tool: string;
  provider: "jira" | "github" | "internal";
  errorCode: string;
  message: string;
}

/** An artifact the AI suggests the user can create. */
export interface ArtifactSuggestion {
  kind: "google_doc" | "google_sheet" | "google_slides" | "chart" | "xlsx_export" | "pptx_export";
  title: string;
  description: string;
  spec: Record<string, unknown>;
}

export interface ChatTurnResult {
  answer: string;
  toolsUsed: string[];
  sources: SourceSummary[];
  partialFailures: PartialFailure[];
  tokenUsage: { input: number; output: number };
  totalLatencyMs: number;
  iterationCount: number;
  stoppedEarly: boolean;
  /** Artifact suggestions parsed from the AI response. */
  artifactSuggestions: ArtifactSuggestion[];
}

/**
 * Run a single conversational turn.
 *
 * @param userMessage The user's message text.
 * @param history     Prior messages in the conversation (for multi-turn context).
 *                    Mutated in-place with the new user message, tool turns, and assistant reply.
 * @param llmService  LLM service instance (injected — no singletons).
 * @param opts        Request context including org, tokens, config.
 */
export async function runChatTurn(
  userMessage: string,
  history: NormalizedChatMessage[],
  llmService: LlmService,
  opts: ChatTurnOptions
): Promise<ChatTurnResult> {
  const startedAt = Date.now();
  const toolsUsed: string[] = [];
  const sources: SourceSummary[] = [];
  const partialFailures: PartialFailure[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iterationCount = 0;
  let stoppedEarly = false;

  // Build the executor context (passed to each tool call)
  const execCtx: ToolExecutorContext = {
    userId: opts.userId,
    organizationId: opts.organizationId,
    timezone: opts.timezone,
    githubToken: opts.githubToken,
    jiraToken: opts.jiraToken,
    jiraSiteId: opts.jiraSiteId,
    teamMembers: opts.teamMembers,
    config: opts.config,
    database: opts.database,
    logger: opts.logger,
    cache: opts.cache
  };

  // Append the user's message to the history
  history.push({ role: "user", content: userMessage });

  // Build the full message array for the LLM: system prompt + history
  const systemPrompt = buildSystemPrompt(opts);

  while (iterationCount < MAX_TOOL_ITERATIONS) {
    iterationCount++;

    const messages: NormalizedChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history
    ];

    const response = await llmService.chat(opts.userId, {
      modelId: opts.modelId,
      messages,
      tools: ALL_TOOLS,
      maxOutputTokens: 2048,
      temperature: 0.1 // Low temperature for factual grounding
    });

    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;

    // No tool calls → final answer
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const rawAnswer = response.message.content;
      const { cleanAnswer, suggestions } = extractArtifactSuggestions(rawAnswer);

      // Add assistant's final reply to history
      history.push({ role: "assistant", content: cleanAnswer });

      return {
        answer: cleanAnswer,
        toolsUsed,
        sources,
        partialFailures,
        tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
        totalLatencyMs: Date.now() - startedAt,
        iterationCount,
        stoppedEarly: false,
        artifactSuggestions: suggestions
      };
    }

    // LLM wants to call tools — execute all in parallel
    const toolCalls: ToolCall[] = response.toolCalls;
    opts.logger.info(
      { toolCalls: toolCalls.map((tc) => tc.name), iteration: iterationCount },
      "Executing tool calls"
    );

    // Add the assistant's tool-call turn to history (before results)
    history.push({
      role: "assistant",
      content: response.message.content,
      toolCalls
    });

    // Execute all tool calls in parallel
    const results: ToolResult[] = await Promise.all(
      toolCalls.map((tc) =>
        executeToolCall(tc.name, tc.id, tc.arguments, execCtx)
      )
    );

    // Record metadata and append tool results to history
    for (const result of results) {
      toolsUsed.push(result.toolName);

      if (result.error) {
        partialFailures.push({
          tool: result.toolName,
          provider: result.meta.provider,
          errorCode: "TOOL_ERROR",
          message: result.error
        });
      }

      sources.push({
        provider: result.meta.provider,
        fetchedAt: result.meta.fetchedAt,
        itemCount: result.meta.itemCount,
        cacheAgeMs: result.meta.cacheAgeMs,
        source: result.meta.source
      });

      // Append tool result as a "tool" role message (provider format handled by adapter)
      history.push({
        role: "tool",
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        content: result.error
          ? JSON.stringify({ error: result.error, meta: result.meta })
          : JSON.stringify({ result: result.output, meta: result.meta })
      });
    }
  }

  // Exceeded max iterations — synthesize best partial answer
  stoppedEarly = true;
  opts.logger.warn({ iterationCount }, "Chat pipeline hit max tool iterations — forcing final answer");

  const finalMessages: NormalizedChatMessage[] = [
    {
      role: "system",
      content:
        systemPrompt +
        "\n\nIMPORTANT: You have reached the maximum number of tool calls. " +
        "Synthesize the best answer you can from the tool results already collected. " +
        "Be explicit about what you could not confirm."
    },
    ...history
  ];

  const finalResponse = await llmService.chat(opts.userId, {
    modelId: opts.modelId,
    messages: finalMessages,
    maxOutputTokens: 2048,
    temperature: 0.1
  });

  totalInputTokens += finalResponse.usage.inputTokens;
  totalOutputTokens += finalResponse.usage.outputTokens;

  const rawFinal = finalResponse.message.content;
  const { cleanAnswer: answer, suggestions: finalSuggestions } = extractArtifactSuggestions(rawFinal);
  history.push({ role: "assistant", content: answer });

  return {
    answer,
    toolsUsed,
    sources,
    partialFailures,
    tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
    totalLatencyMs: Date.now() - startedAt,
    iterationCount,
    stoppedEarly,
    artifactSuggestions: finalSuggestions
  };
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(opts: ChatTurnOptions): string {
  const now = new Date().toISOString();
  const memberList = opts.teamMembers
    .map((m) => {
      const parts = [m.displayName];
      if (m.aliases.length) parts.push(`aliases: ${m.aliases.join(", ")}`);
      if (m.githubUsername) parts.push(`github: ${m.githubUsername}`);
      if (m.jiraAccountId) parts.push(`jira: ${m.jiraAccountId}`);
      return `  - ${parts.join(" | ")}`;
    })
    .join("\n");

  return `You are a precise engineering team activity assistant. Today is ${now}.

## GROUNDING RULES — non-negotiable
1. Use ONLY facts returned by tool calls. Never use training-data knowledge about what Jira issues or GitHub repos might exist.
2. Quote issue keys (e.g. PROJ-123), PR numbers (#42), repository names, commit SHAs, and dates VERBATIM from tool results.
3. If a tool returned an empty array, state that clearly. Do not guess at missing data.
4. If a tool call failed (error field present in result), say so explicitly in a Caveats section.
5. Never fabricate names, issue titles, commit messages, or PR titles.

## TOOL USAGE RULES
- Always call resolve_person first when a human name is mentioned.
- Use the jiraAccountId from resolve_person when calling search_jira_issues.
- Use the githubUsername from resolve_person when calling get_github_commits or get_github_prs.
- If resolve_person returns found=false, ask the user to clarify — do NOT attempt to guess.
- For "what is X working on?" → call both search_jira_issues AND get_github_commits + get_github_prs.
- For "show X's pull requests" → only call get_github_prs.
- For "what Jira issues..." → only call search_jira_issues.
- For team-wide questions → call summarize_team_activity.
- NEVER ask the user for a date range. If none is specified, omit the `since` parameter and the tool will use a 90-day default. Proceed immediately with the tool call.

## OUTPUT FORMAT
Respond with these sections (omit sections with no data):
### Summary
One paragraph covering the most important activity.
### Jira Issues
Bullet list: key — summary (status) — updated date
### GitHub Commits
Bullet list: repo/short-sha — first line of commit message — date
### GitHub Pull Requests
Bullet list: repo#number — title (state) — updated date
### Caveats
Any partial failures, missing data, or ambiguous results.

## ARTIFACT SUGGESTIONS
When the user asks for a deliverable — a report, document, spreadsheet, chart, presentation, or export — suggest artifacts the user can create. Include a JSON block at the END of your response in this exact format:

\`\`\`artifacts
[
  {
    "kind": "google_doc",
    "title": "Weekly Activity Report",
    "description": "Create a Google Doc with this report",
    "spec": {
      "type": "doc",
      "sections": [
        { "heading": "Summary", "level": 1, "body": "..." },
        { "heading": "Details", "level": 2, "body": "..." }
      ]
    }
  }
]
\`\`\`

Available artifact kinds and their specs:

**google_doc** — Google Docs document
spec: { "type": "doc", "content": "full text" } OR { "type": "doc", "sections": [{ "heading": "...", "level": 1|2|3, "body": "..." }] }

**google_sheet** — Google Sheets spreadsheet
spec: { "type": "sheet", "sheets": [{ "title": "Sheet1", "headers": ["Col1","Col2"], "rows": [["val1",42], ["val2",99]] }] }

**google_slides** — Google Slides presentation
spec: { "type": "slides", "slides": [{ "layout": "title"|"title_body"|"section", "title": "...", "subtitle": "...", "bullets": ["..."] }] }

**chart** — Inline chart (bar, line, pie, doughnut, area, scatter)
spec: { "type": "chart", "chartType": "bar", "title": "...", "labels": ["Jan","Feb"], "datasets": [{ "label": "Commits", "data": [10,20] }], "includeDataSheet": true }

Rules for artifact suggestions:
- Only suggest artifacts when the user is asking for something that can be a deliverable
- Populate the spec with REAL data from tool results — never fabricate
- Use descriptive titles
- For reports/summaries → suggest google_doc AND google_slides
- For data tables/metrics → suggest google_sheet AND chart
- For presentations → suggest google_slides
- Always include complete data in the spec — the frontend will create the file directly from it
- Do NOT suggest artifacts for simple questions like "what is X working on?" unless the user specifically asks for a report/doc/chart

## TEAM MEMBERS (for this organization)
${memberList || "  (none configured — user must connect GitHub/Jira first)"}`;
}

// ── Artifact suggestion extraction ──────────────────────────────────────────

const ARTIFACT_BLOCK_RE = /```artifacts\s*\n([\s\S]*?)\n```/;

function extractArtifactSuggestions(answer: string): {
  cleanAnswer: string;
  suggestions: ArtifactSuggestion[];
} {
  const match = answer.match(ARTIFACT_BLOCK_RE);
  if (!match) {
    return { cleanAnswer: answer, suggestions: [] };
  }

  // Remove the artifact block from the visible answer
  const cleanAnswer = answer.replace(ARTIFACT_BLOCK_RE, "").trimEnd();

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) {
      return { cleanAnswer, suggestions: [] };
    }

    const suggestions: ArtifactSuggestion[] = parsed
      .filter(
        (item: unknown): item is Record<string, unknown> =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).kind === "string" &&
          typeof (item as Record<string, unknown>).title === "string"
      )
      .map((item) => ({
        kind: item.kind as ArtifactSuggestion["kind"],
        title: String(item.title),
        description: String(item.description ?? ""),
        spec: (item.spec as Record<string, unknown>) ?? {}
      }));

    return { cleanAnswer, suggestions };
  } catch {
    // JSON parse failed — return answer without the block but no suggestions
    return { cleanAnswer, suggestions: [] };
  }
}
