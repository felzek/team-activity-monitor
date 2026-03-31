import { loadAppConfig } from "./config.js";
import { initializeDatabase } from "./db.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { startJobWorker } from "./lib/job-worker.js";

const config = loadAppConfig();
const database = initializeDatabase(config);
const app = createApp(config, logger, database);

const worker = startJobWorker(config, database, logger);

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      mode: config.useRecordedFixtures ? "fixture" : "live",
      databasePath: config.databasePath
    },
    "Team activity monitor server started"
  );
});

function shutdown() {
  logger.info("Shutting down…");
  worker.stop();
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
