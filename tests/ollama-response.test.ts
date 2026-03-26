import { describe, expect, it, vi } from "vitest";

import { loadAppConfig } from "../src/config.js";
import { generateGroundedResponse } from "../src/lib/llm-pipeline.js";
import type { ActivitySummary } from "../src/types/activity.js";
import { logger } from "../src/lib/logger.js";

function buildSummary(): ActivitySummary {
  return {
    member: {
      displayName: "John Doe",
      id: "john-doe",
      githubUsername: "john-doe",
      queryText: "John"
    },
    intent: "activity_summary",
    timeframe: {
      kind: "trailing_days",
      label: "the last 14 days",
      start: "2026-03-10T00:00:00.000Z",
      end: "2026-03-24T00:00:00.000Z",
      timezone: "America/New_York"
    },
    needsClarification: false,
    clarificationReason: null,
    jira: {
      status: {
        provider: "jira",
        ok: true,
        partial: false,
        latencyMs: 125
      },
      data: {
        issues: [
          {
            key: "OPS-17",
            summary: "Harden deploy rollback path",
            status: "In Progress",
            updated: "2026-03-22T12:00:00.000Z",
            recentChanges: []
          }
        ],
        recentUpdateCount: 1
      }
    },
    github: {
      status: {
        provider: "github",
        ok: true,
        partial: false,
        latencyMs: 180
      },
      data: {
        commits: [
          {
            repo: "acme/team-portal",
            sha: "abcdef1",
            message: "Ground the member activity response renderer",
            authoredAt: "2026-03-21T08:30:00.000Z"
          }
        ],
        pullRequests: [],
        recentRepos: ["acme/team-portal"]
      }
    },
    caveats: []
  };
}

describe("local HTTP LLM (Ollama-compatible chat API)", () => {
  it("POSTs /chat and returns the assistant message", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: {
              content: "Overview:\nJohn Doe is active.\n\nJira:\n- OPS-17\n\nGitHub:\n- acme/team-portal\n\nCaveats:\n- None."
            }
          }),
          { status: 200 }
        )
      );

    const config = loadAppConfig({
      PORT: "3001",
      APP_TIMEZONE: "America/New_York",
      USE_RECORDED_FIXTURES: "true",
      TEAM_MEMBERS_CONFIG: "config/team-members.json",
      TRACKED_REPOS_CONFIG: "config/repos.json",
      FIXTURE_DIR: "fixtures/demo",
      DATABASE_PATH: "data/test.db",
      SESSION_SECRET: "test-session-secret",
      OLLAMA_BASE_URL: "http://localhost:11434/api",
      OLLAMA_MODEL: "qwen2.5:7b"
    });

    const response = await generateGroundedResponse(
      config,
      buildSummary(),
      logger.child({ test: "ollama" })
    );

    expect(response).toContain("Overview:");
    expect(response).toContain("OPS-17");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const chatCall = fetchMock.mock.calls[0];
    const chatPayload = JSON.parse(String(chatCall?.[1]?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(chatPayload.model).toBe("qwen2.5:7b");
    expect(chatPayload.messages[0]?.role).toBe("system");
    expect(chatPayload.messages[1]?.content).toContain("\"displayName\": \"John Doe\"");

    fetchMock.mockRestore();
  });
});
