import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ActivitySummary } from "../src/types/activity.js";
import { renderDeterministicResponse } from "../src/render/response.js";

describe("response rendering", () => {
  it("renders the required sections without inventing facts", () => {
    const fixturePath = path.resolve(process.cwd(), "fixtures/render/john-summary.json");
    const summary = JSON.parse(readFileSync(fixturePath, "utf8")) as ActivitySummary;

    const response = renderDeterministicResponse(summary);

    expect(response).toContain("Overview:");
    expect(response).toContain("Jira:");
    expect(response).toContain("GitHub:");
    expect(response).toContain("Caveats:");
    expect(response).toContain("OPS-17");
    expect(response).not.toContain("OPS-99");
  });
});
