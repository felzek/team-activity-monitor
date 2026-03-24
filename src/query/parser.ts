import type { ParsedQuery, ProviderName, QueryIntent } from "../types/activity.js";
import { resolveTimeframeFromQuery } from "./timeframe.js";

const MEMBER_PATTERNS: RegExp[] = [
  /what\s+is\s+(.+?)\s+working\s+on/i,
  /what\s+has\s+(.+?)\s+been\s+working\s+on/i,
  /what\s+has\s+(.+?)\s+committed/i,
  /show\s+me\s+recent\s+activity\s+for\s+(.+)/i,
  /show\s+me\s+(.+?)'s\s+current\s+issues/i,
  /show\s+me\s+(.+?)'s\s+recent\s+pull\s+requests/i,
  /what\s+jira\s+tickets\s+is\s+(.+?)\s+working\s+on/i
];

function cleanMemberText(value: string): string {
  return value.replace(/[?.,]+$/g, "").trim();
}

function detectIntent(rawQuery: string): QueryIntent {
  const lower = rawQuery.toLowerCase();

  if (lower.includes("pull request") || /\bprs?\b/.test(lower)) {
    return "github_prs";
  }

  if (lower.includes("commit")) {
    return "github_commits";
  }

  if (lower.includes("jira") || lower.includes("ticket") || lower.includes("issue")) {
    return "jira_only";
  }

  return "activity_summary";
}

function requestedSourcesForIntent(intent: QueryIntent): ProviderName[] {
  switch (intent) {
    case "jira_only":
      return ["jira"];
    case "github_commits":
    case "github_prs":
      return ["github"];
    default:
      return ["jira", "github"];
  }
}

export function extractMemberText(rawQuery: string): string | null {
  for (const pattern of MEMBER_PATTERNS) {
    const match = rawQuery.match(pattern);

    if (match?.[1]) {
      return cleanMemberText(match[1]);
    }
  }

  return null;
}

export function parseQuery(rawQuery: string, timezone: string): ParsedQuery {
  const normalizedQuery = rawQuery.trim();
  const intent = detectIntent(normalizedQuery);
  const requestedSources = requestedSourcesForIntent(intent);
  const memberText = extractMemberText(normalizedQuery);
  const timeframe = resolveTimeframeFromQuery(normalizedQuery, timezone, intent);

  return {
    rawQuery: normalizedQuery,
    memberText,
    intent,
    requestedSources,
    timeframe,
    needsClarification: false,
    clarificationReason: null
  };
}
