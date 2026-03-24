import { describe, expect, it } from "vitest";

import { resolveIdentity } from "../src/query/identity.js";
import { parseQuery } from "../src/query/parser.js";

describe("query parsing", () => {
  it("parses the core assignment query", () => {
    const parsed = parseQuery(
      "What is John working on these days?",
      "America/New_York"
    );

    expect(parsed.intent).toBe("activity_summary");
    expect(parsed.memberText).toBe("John");
    expect(parsed.requestedSources).toEqual(["jira", "github"]);
    expect(parsed.timeframe.kind).toBe("trailing_days");
    expect(parsed.timeframe.label).toBe("the last 14 days");
  });

  it("flags ambiguous identity matches when two people match the same alias", () => {
    const resolution = resolveIdentity("John", "What is John working on?", [
      {
        id: "john-doe",
        displayName: "John Doe",
        aliases: ["john"],
        githubUsername: "john-doe"
      },
      {
        id: "john-smith",
        displayName: "John Smith",
        aliases: ["john"],
        githubUsername: "john-smith"
      }
    ]);

    expect(resolution.member).toBeNull();
    expect(resolution.needsClarification).toBe(true);
    expect(resolution.candidates).toHaveLength(2);
  });
});
