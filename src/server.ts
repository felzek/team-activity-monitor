import { loadAppConfig } from "./config.js";
import { initializeDatabase } from "./db.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";

const config = loadAppConfig();
const database = initializeDatabase(config);
const app = createApp(config, logger, database);

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      mode: config.useRecordedFixtures ? "fixture" : "live",
      databasePath: config.databasePath
    },
    "Team activity monitor server started"
  );
});
