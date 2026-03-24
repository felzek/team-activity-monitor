import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AppConfig } from "../src/config.js";
import { loadAppConfig } from "../src/config.js";

export function buildTestConfig(): AppConfig {
  const databasePath = path.join(os.tmpdir(), `tam-test-${randomUUID()}.db`);

  return loadAppConfig({
    PORT: "3001",
    APP_TIMEZONE: "America/New_York",
    USE_RECORDED_FIXTURES: "true",
    TEAM_MEMBERS_CONFIG: "config/team-members.json",
    TRACKED_REPOS_CONFIG: "config/repos.json",
    FIXTURE_DIR: "fixtures/demo",
    DATABASE_PATH: databasePath,
    SESSION_SECRET: "test-session-secret",
    OPENAI_API_KEY: ""
  });
}

export function cleanupTestConfig(config: AppConfig): void {
  rmSync(config.databasePath, { force: true });
}
