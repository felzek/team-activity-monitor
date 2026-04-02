import { describe, expect, it } from "vitest";

import { loadAppConfig } from "../src/config.js";

const baseEnv = {
  TEAM_MEMBERS_CONFIG: "config/team-members.json",
  TRACKED_REPOS_CONFIG: "config/repos.json",
  SESSION_SECRET: "test-session-secret-0123456789",
};

describe("loadAppConfig", () => {
  it("infers Vercel-safe defaults for preview deployments", () => {
    const config = loadAppConfig({
      ...baseEnv,
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_URL: "team-activity-monitor-preview.vercel.app",
    });

    expect(config.isVercel).toBe(true);
    expect(config.vercelEnv).toBe("preview");
    expect(config.appEnv).toBe("staging");
    expect(config.appBaseUrl).toBe("https://team-activity-monitor-preview.vercel.app");
    expect(config.databasePath).toBe("/tmp/team-activity-monitor.db");
    expect(config.databasePersistence).toBe("ephemeral");
    expect(config.backgroundWorkerEnabled).toBe(false);
    expect(config.defaultModelId).toBe("local:qwen2.5:7b");
  });

  it("defaults to Vercel AI Gateway when gateway credentials are configured", () => {
    const config = loadAppConfig({
      ...baseEnv,
      AI_GATEWAY_API_KEY: "agw_test_123",
      AI_GATEWAY_MODELS: "alibaba/qwen-3-32b,openai/gpt-5.4",
    });

    expect(config.aiGatewayModels).toEqual([
      "alibaba/qwen-3-32b",
      "openai/gpt-5.4",
    ]);
    expect(config.defaultModelId).toBe("gateway:alibaba/qwen-3-32b");
  });
});
