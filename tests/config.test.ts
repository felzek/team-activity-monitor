import { describe, expect, it } from "vitest";

import { loadAppConfig } from "../src/config.js";

const baseEnv = {
  TEAM_MEMBERS_CONFIG: "config/team-members.json",
  TRACKED_REPOS_CONFIG: "config/repos.json",
  SESSION_SECRET: "test-session-secret-0123456789",
};

describe("loadAppConfig", () => {
  it("requires an explicit gateway-backed default for Vercel preview deployments", () => {
    expect(() =>
      loadAppConfig({
        ...baseEnv,
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_URL: "team-activity-monitor-preview.vercel.app",
      })
    ).toThrow(
      "Vercel preview and production deployments must configure AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN and set a gateway-backed DEFAULT_MODEL_ID."
    );
  });

  it("infers Vercel-safe defaults for preview deployments when gateway credentials are configured", () => {
    const config = loadAppConfig({
      ...baseEnv,
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_URL: "team-activity-monitor-preview.vercel.app",
      AI_GATEWAY_API_KEY: "agw_test_123",
      AI_GATEWAY_MODELS: "alibaba/qwen3.5-flash",
    });

    expect(config.isVercel).toBe(true);
    expect(config.vercelEnv).toBe("preview");
    expect(config.appEnv).toBe("staging");
    expect(config.appBaseUrl).toBe("https://team-activity-monitor-preview.vercel.app");
    expect(config.databasePath).toBe("/tmp/team-activity-monitor.db");
    expect(config.databasePersistence).toBe("ephemeral");
    expect(config.backgroundWorkerEnabled).toBe(false);
    expect(config.defaultModelId).toBe("gateway:alibaba/qwen3.5-flash");
  });

  it("defaults to Vercel AI Gateway when gateway credentials are configured", () => {
    const config = loadAppConfig({
      ...baseEnv,
      AI_GATEWAY_API_KEY: "agw_test_123",
      AI_GATEWAY_MODELS: "alibaba/qwen3.5-flash,openai/gpt-5.4",
    });

    expect(config.aiGatewayModels).toEqual([
      "alibaba/qwen3.5-flash",
      "openai/gpt-5.4",
    ]);
    expect(config.defaultModelId).toBe("gateway:alibaba/qwen3.5-flash");
  });
});
