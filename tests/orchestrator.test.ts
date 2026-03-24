import { describe, expect, it } from "vitest";

import { logger } from "../src/lib/logger.js";
import { buildActivitySummary } from "../src/orchestrator/activity.js";
import { resolveIdentity } from "../src/query/identity.js";
import { parseQuery } from "../src/query/parser.js";
import { buildTestConfig } from "./helpers.js";

describe("activity orchestration", () => {
  it("returns grounded fixture-backed data for a known teammate", async () => {
    const config = buildTestConfig();
    const parsed = parseQuery(
      "What is John working on these days?",
      config.appTimezone
    );
    const identity = resolveIdentity(parsed.memberText, parsed.rawQuery, config.teamMembers);

    const summary = await buildActivitySummary(
      config,
      parsed,
      identity,
      logger.child({ test: "orchestrator-known-member" })
    );

    expect(summary.needsClarification).toBe(false);
    expect(summary.member.displayName).toBe("John Doe");
    expect(summary.jira.data.issues.length).toBeGreaterThan(0);
    expect(summary.github.data.commits.length).toBeGreaterThan(0);
  });

  it("adds a caveat when GitHub mapping is unavailable", async () => {
    const config = buildTestConfig();
    const john = config.teamMembers.find((member) => member.id === "john-doe");

    if (!john) {
      throw new Error("John fixture is missing.");
    }

    john.githubUsername = undefined;
    const parsed = parseQuery(
      "What is John working on these days?",
      config.appTimezone
    );
    const identity = resolveIdentity(parsed.memberText, parsed.rawQuery, config.teamMembers);

    const summary = await buildActivitySummary(
      config,
      parsed,
      identity,
      logger.child({ test: "orchestrator-missing-github" })
    );

    expect(summary.caveats.some((caveat) => caveat.includes("configured GitHub username"))).toBe(
      true
    );
  });
});
