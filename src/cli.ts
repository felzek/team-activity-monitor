import { loadAppConfig } from "./config.js";
import { logger } from "./lib/logger.js";
import { maybePolishResponse } from "./lib/openai.js";
import { buildActivitySummary } from "./orchestrator/activity.js";
import { resolveIdentity } from "./query/identity.js";
import { parseQuery } from "./query/parser.js";
import { renderDeterministicResponse } from "./render/response.js";

async function main() {
  const query = process.argv.slice(2).join(" ").trim();

  if (!query) {
    console.error("Usage: npm run cli -- \"What is John working on these days?\"");
    process.exitCode = 1;
    return;
  }

  const config = loadAppConfig();
  const parsedQuery = parseQuery(query, config.appTimezone);
  const identity = resolveIdentity(parsedQuery.memberText, parsedQuery.rawQuery, config.teamMembers);
  const summary = await buildActivitySummary(config, parsedQuery, identity, logger.child({ mode: "cli" }));
  const deterministicResponse = renderDeterministicResponse(summary);
  const responseText = await maybePolishResponse(
    config,
    summary,
    deterministicResponse,
    logger.child({ mode: "cli" })
  );

  console.log(responseText);
}

void main();
