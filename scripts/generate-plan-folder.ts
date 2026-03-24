import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  loadPlanTickets,
  toBacklogCsv,
  toBacklogJson
} from "./plan-utils.js";

function resolveFromCwd(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function writeTextFile(filePath: string, contents: string): void {
  writeFileSync(resolveFromCwd(filePath), contents, "utf8");
}

function ensureDir(dirPath: string): void {
  mkdirSync(resolveFromCwd(dirPath), { recursive: true });
}

function buildPlanReadme(): string {
  const tickets = loadPlanTickets();
  const epicCount = tickets.filter((ticket) => ticket.issue_type === "Epic").length;
  const storyCount = tickets.filter((ticket) => ticket.issue_type === "Story").length;
  const taskCount = tickets.filter((ticket) => ticket.issue_type === "Task").length;
  const readyCount = tickets.filter((ticket) => ticket.suggested_status === "Ready").length;

  return `# Plan Review Pack

This folder is the review-ready package for the Team Activity Monitor MVP plan.

## Included files

- \`backlog.json\`: normalized ticket data used by the Taiga import script
- \`backlog.csv\`: spreadsheet-friendly backlog export
- \`demo-script.md\`: demo flow and talking points
- \`tracker-mapping.md\`: normalized-field mapping notes
- \`taiga-import-report.json\`: latest dry-run or live-create report

## Backlog snapshot

- ${tickets.length} total tickets
- ${epicCount} epics
- ${storyCount} stories
- ${taskCount} tasks
- ${readyCount} items marked \`Ready\`
- 2 stretch tickets kept as optional follow-on work

## Critical path

\`MVP-01 -> MVP-02 -> (MVP-03 + MVP-04 + MVP-05) -> MVP-06 -> MVP-07 -> MVP-08 -> MVP-09 -> MVP-10\`

## Taiga mapping

- \`Epic\` -> Taiga \`Epic\`
- \`Story\` -> Taiga \`User Story\`
- \`Task\` -> Taiga \`Task\`
- Stories are linked to their inferred parent epic.
- Tasks stay standalone unless they have exactly one story dependency.

## Commands

\`\`\`bash
npm run plan:generate
npm run plan:taiga:dry
npm run plan:taiga:create
\`\`\`

## Required Taiga env vars

- \`TAIGA_BASE_URL\`
- Either \`TAIGA_TOKEN\` or \`TAIGA_USERNAME\` + \`TAIGA_PASSWORD\`
- Either \`TAIGA_PROJECT_ID\`, \`TAIGA_PROJECT_SLUG\`, or \`TAIGA_PROJECT_NAME\`

## Review flow

1. Run \`npm run plan:generate\` to sync the plan package.
2. Run \`npm run plan:taiga:dry\` to inspect the exact payloads before pushing.
3. Set the Taiga env vars.
4. Run \`npm run plan:taiga:create\` to create the Taiga project if needed and then create the epics, user stories, and tasks.

The import report is written to \`plan/taiga-import-report.json\` in both dry-run and live-create modes so there is one place to review what happened.
`;
}

function main(): void {
  const tickets = loadPlanTickets();
  const normalizedJson = toBacklogJson(tickets);
  const normalizedCsv = toBacklogCsv(tickets);
  const planDir = resolveFromCwd("plan");
  const planningDir = resolveFromCwd("planning");

  ensureDir(planDir);
  ensureDir(planningDir);

  writeTextFile("planning/backlog.json", normalizedJson);
  writeTextFile("planning/backlog.csv", normalizedCsv);
  writeTextFile("plan/backlog.json", normalizedJson);
  writeTextFile("plan/backlog.csv", normalizedCsv);
  writeTextFile("plan/README.md", buildPlanReadme());

  copyFileSync(resolveFromCwd("planning/demo-script.md"), resolveFromCwd("plan/demo-script.md"));
  copyFileSync(
    resolveFromCwd("planning/tracker-mapping.md"),
    resolveFromCwd("plan/tracker-mapping.md")
  );

  console.log(
    JSON.stringify(
      {
        syncedDirectories: ["planning", "plan"],
        ticketCount: tickets.length,
        outputs: [
          "planning/backlog.json",
          "planning/backlog.csv",
          "plan/README.md",
          "plan/backlog.json",
          "plan/backlog.csv",
          "plan/demo-script.md",
          "plan/tracker-mapping.md"
        ]
      },
      null,
      2
    )
  );
}

main();
