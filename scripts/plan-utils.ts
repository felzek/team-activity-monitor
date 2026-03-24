import { readFileSync } from "node:fs";
import path from "node:path";

export type PlanIssueType = "Epic" | "Story" | "Task";
export type TaigaItemType = "epic" | "userstory" | "task";

export interface PlanTicket {
  ticket_key: string;
  issue_type: PlanIssueType;
  title: string;
  summary: string;
  background_rationale: string;
  scope: string;
  out_of_scope: string;
  acceptance_criteria: string;
  dependencies: string[];
  priority: string;
  estimate: string;
  owner_role: string;
  labels: string[];
  risk_level: string;
  demo_relevance: string;
  artifacts_or_files_expected: string;
  test_notes: string;
  rollback_or_fallback: string;
  suggested_status: string;
  parent_epic_key?: string;
}

const BACKLOG_HEADER = [
  "ticket_key",
  "issue_type",
  "title",
  "summary",
  "background_rationale",
  "scope",
  "out_of_scope",
  "acceptance_criteria",
  "dependencies",
  "priority",
  "estimate",
  "owner_role",
  "labels",
  "risk_level",
  "demo_relevance",
  "artifacts_or_files_expected",
  "test_notes",
  "rollback_or_fallback",
  "suggested_status"
] as const;

const PARENT_EPIC_BY_TICKET: Record<string, string> = {
  "MVP-01": "MVP-E1",
  "MVP-03": "MVP-E1",
  "MVP-04": "MVP-E1",
  "MVP-05": "MVP-E1",
  "STR-01": "MVP-E1",
  "MVP-02": "MVP-E2",
  "MVP-06": "MVP-E2",
  "MVP-07": "MVP-E2",
  "MVP-08": "MVP-E2",
  "STR-02": "MVP-E2",
  "MVP-09": "MVP-E3",
  "MVP-10": "MVP-E3"
};

function resolveFromCwd(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function splitPipeValue(value: string): string[] {
  if (!value.trim()) {
    return [];
  }

  return value
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function joinPipeValue(values: string[]): string {
  return values.join("|");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return value;
}

export function parseLegacyBacklogCsv(rawCsv: string): PlanTicket[] {
  const lines = rawCsv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  return lines.slice(1).map((line) => {
    const parts = line.split(",");

    if (parts.length < BACKLOG_HEADER.length) {
      throw new Error(`Unable to parse backlog row with ${parts.length} columns: ${line}`);
    }

    // Legacy source data is mostly comma-safe, but rollback text can contain commas.
    const fixedFields = parts.slice(0, BACKLOG_HEADER.length - 2);
    const rollback = parts
      .slice(BACKLOG_HEADER.length - 2, parts.length - 1)
      .join(",")
      .trim();
    const suggestedStatus = parts[parts.length - 1].trim();
    const row = [...fixedFields, rollback, suggestedStatus];

    const ticket = {
      ticket_key: row[0].trim(),
      issue_type: row[1].trim() as PlanIssueType,
      title: row[2].trim(),
      summary: row[3].trim(),
      background_rationale: row[4].trim(),
      scope: row[5].trim(),
      out_of_scope: row[6].trim(),
      acceptance_criteria: row[7].trim(),
      dependencies: splitPipeValue(row[8]),
      priority: row[9].trim(),
      estimate: row[10].trim(),
      owner_role: row[11].trim(),
      labels: splitPipeValue(row[12]),
      risk_level: row[13].trim(),
      demo_relevance: row[14].trim(),
      artifacts_or_files_expected: row[15].trim(),
      test_notes: row[16].trim(),
      rollback_or_fallback: row[17].trim(),
      suggested_status: row[18].trim()
    } satisfies PlanTicket;

    return {
      ...ticket,
      parent_epic_key: ticket.issue_type === "Epic" ? undefined : PARENT_EPIC_BY_TICKET[ticket.ticket_key]
    };
  });
}

export function loadPlanTickets(backlogPath = "planning/backlog.csv"): PlanTicket[] {
  const absolutePath = resolveFromCwd(backlogPath);
  return parseLegacyBacklogCsv(readFileSync(absolutePath, "utf8"));
}

export function toBacklogJson(tickets: PlanTicket[]): string {
  return `${JSON.stringify(tickets, null, 2)}\n`;
}

export function toBacklogCsv(tickets: PlanTicket[]): string {
  const lines = [
    BACKLOG_HEADER.join(","),
    ...tickets.map((ticket) =>
      [
        ticket.ticket_key,
        ticket.issue_type,
        ticket.title,
        ticket.summary,
        ticket.background_rationale,
        ticket.scope,
        ticket.out_of_scope,
        ticket.acceptance_criteria,
        joinPipeValue(ticket.dependencies),
        ticket.priority,
        ticket.estimate,
        ticket.owner_role,
        joinPipeValue(ticket.labels),
        ticket.risk_level,
        ticket.demo_relevance,
        ticket.artifacts_or_files_expected,
        ticket.test_notes,
        ticket.rollback_or_fallback,
        ticket.suggested_status
      ]
        .map(csvEscape)
        .join(",")
    )
  ];

  return `${lines.join("\n")}\n`;
}

function bulletize(value: string): string[] {
  const items = splitPipeValue(value);

  if (items.length === 0) {
    return ["- None noted."];
  }

  return items.map((item) => `- ${item}`);
}

export function buildTicketDescription(ticket: PlanTicket): string {
  const sections = [
    `Source backlog key: ${ticket.ticket_key}`,
    "",
    ticket.summary,
    "",
    "Why",
    ticket.background_rationale,
    "",
    "In scope",
    ...bulletize(ticket.scope),
    "",
    "Out of scope",
    ...bulletize(ticket.out_of_scope),
    "",
    "Acceptance criteria",
    ...bulletize(ticket.acceptance_criteria),
    "",
    `Dependencies: ${ticket.dependencies.length > 0 ? ticket.dependencies.join(", ") : "None"}`,
    `Priority: ${ticket.priority}`,
    `Estimate: ${ticket.estimate}`,
    `Owner role: ${ticket.owner_role}`,
    `Risk level: ${ticket.risk_level}`,
    `Demo relevance: ${ticket.demo_relevance}`,
    `Suggested status: ${ticket.suggested_status}`,
    "",
    "Artifacts / files expected",
    ...bulletize(ticket.artifacts_or_files_expected),
    "",
    "Test notes",
    ticket.test_notes,
    "",
    "Rollback / fallback",
    ticket.rollback_or_fallback
  ];

  return sections.join("\n");
}

export function resolveTaigaItemType(issueType: PlanIssueType): TaigaItemType {
  switch (issueType) {
    case "Epic":
      return "epic";
    case "Story":
      return "userstory";
    case "Task":
      return "task";
  }
}

export function toTagList(ticket: PlanTicket): string[] {
  const values = [
    ...ticket.labels,
    `priority:${ticket.priority.toLowerCase()}`,
    `risk:${ticket.risk_level.toLowerCase()}`,
    `demo:${ticket.demo_relevance.toLowerCase()}`,
    `status:${ticket.suggested_status.toLowerCase()}`,
    `source:${ticket.ticket_key.toLowerCase()}`
  ];

  return [...new Set(values)];
}
