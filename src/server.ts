import { startJobWorker } from "./lib/job-worker.js";
import { logger } from "./lib/logger.js";
import { bootstrapAppRuntime } from "./runtime.js";

const { app, config, database } = bootstrapAppRuntime();

const worker = config.backgroundWorkerEnabled
  ? startJobWorker(config, database, logger)
  : {
      stop() {
        logger.info("Background worker is disabled for this runtime.");
      }
    };

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
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
