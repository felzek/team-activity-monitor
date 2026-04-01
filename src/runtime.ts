import type express from "express";

import { createApp } from "./app.js";
import { loadAppConfig } from "./config.js";
import type { AppConfig } from "./config.js";
import { initializeDatabase } from "./db.js";
import type { AppDatabase } from "./db.js";
import { logger } from "./lib/logger.js";

export interface AppRuntime {
  app: express.Express;
  config: AppConfig;
  database: AppDatabase;
}

export function bootstrapAppRuntime(): AppRuntime {
  const config = loadAppConfig();
  const database = initializeDatabase(config);

  if (config.isVercel && config.databasePersistence === "ephemeral") {
    logger.warn(
      {
        databasePath: config.databasePath,
        platform: "vercel"
      },
      "Using an ephemeral SQLite database path on Vercel. This is suitable for previews and demos, but not durable multi-instance production data."
    );
  }

  const app = createApp(config, logger, database);
  return { app, config, database };
}
