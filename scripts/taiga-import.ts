import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  buildTicketDescription,
  resolveTaigaItemType,
  toTagList,
  type PlanTicket,
  type TaigaItemType
} from "./plan-utils.js";

const optionalNumber = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return Number(value);
}, z.number().int().positive().optional());

const envSchema = z.object({
  TAIGA_BASE_URL: z.string().optional(),
  TAIGA_TOKEN: z.string().optional(),
  TAIGA_USERNAME: z.string().optional(),
  TAIGA_PASSWORD: z.string().optional(),
  TAIGA_PROJECT_ID: optionalNumber,
  TAIGA_PROJECT_SLUG: z.string().optional(),
  TAIGA_PROJECT_NAME: z.string().optional(),
  TAIGA_PROJECT_DESCRIPTION: z.string().default(
    "Backlog review project for the Team Activity Monitor MVP."
  ),
  TAIGA_PROJECT_PRIVATE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  TAIGA_BACKLOG_PATH: z.string().default("plan/backlog.json"),
  TAIGA_REPORT_PATH: z.string().default("plan/taiga-import-report.json")
});

interface TaigaLoginResponse {
  auth_token: string;
}

interface TaigaResolverResponse {
  project: number;
}

interface TaigaEntityResponse {
  id: number;
  ref?: number;
  subject?: string;
  permalink?: string;
  slug?: string;
}

interface TaigaCreateOperation {
  sourceKey: string;
  sourceType: PlanTicket["issue_type"];
  taigaType: TaigaItemType;
  subject: string;
  parentEpicKey?: string;
  payload: Record<string, unknown>;
  status: "pending" | "created" | "linked" | "failed" | "skipped";
  result?: Record<string, unknown>;
  error?: string;
}

interface TaigaImportReport {
  generatedAt: string;
  mode: "dry-run" | "create";
  backlogPath: string;
  reportPath: string;
  project: {
    baseUrl?: string;
    projectId?: number;
    projectSlug?: string;
  };
  summary: {
    totalTickets: number;
    epics: number;
    stories: number;
    tasks: number;
  };
  operations: TaigaCreateOperation[];
  warnings: string[];
  success: boolean;
  error?: string;
}

function resolveFromCwd(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(resolveFromCwd(filePath)), { recursive: true });
}

function writeReport(filePath: string, report: TaigaImportReport): void {
  ensureParentDir(filePath);
  writeFileSync(resolveFromCwd(filePath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function parseArgs(argv: string[]): { mode: "dry-run" | "create" } {
  if (argv.includes("--create")) {
    return { mode: "create" };
  }

  return { mode: "dry-run" };
}

function loadBacklog(backlogPath: string): PlanTicket[] {
  const absolutePath = resolveFromCwd(backlogPath);

  if (!existsSync(absolutePath)) {
    throw new Error(
      `Backlog file not found at ${absolutePath}. Run "npm run plan:generate" first.`
    );
  }

  return JSON.parse(readFileSync(absolutePath, "utf8")) as PlanTicket[];
}

function normalizeTaigaBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed.slice(0, -"/api/v1".length) : trimmed;
}

function buildApiUrl(baseUrl: string, apiPath: string): string {
  return `${normalizeTaigaBaseUrl(baseUrl)}/api/v1${apiPath}`;
}

async function fetchTaigaJson<T>(
  url: string,
  init: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Taiga request failed (${response.status} ${response.statusText}): ${bodyText}`);
  }

  const text = await response.text();
  return (text ? (JSON.parse(text) as T) : ({} as T));
}

async function resolveAuthToken(env: z.infer<typeof envSchema>): Promise<string> {
  if (env.TAIGA_TOKEN) {
    return env.TAIGA_TOKEN;
  }

  if (!env.TAIGA_BASE_URL || !env.TAIGA_USERNAME || !env.TAIGA_PASSWORD) {
    throw new Error(
      "Missing Taiga auth config. Set TAIGA_TOKEN or provide TAIGA_BASE_URL, TAIGA_USERNAME, and TAIGA_PASSWORD."
    );
  }

  const response = await fetchTaigaJson<TaigaLoginResponse>(
    buildApiUrl(env.TAIGA_BASE_URL, "/auth"),
    {
      method: "POST",
      body: JSON.stringify({
        type: "normal",
        username: env.TAIGA_USERNAME,
        password: env.TAIGA_PASSWORD
      })
    }
  );

  if (!response.auth_token) {
    throw new Error("Taiga login succeeded but no auth_token was returned.");
  }

  return response.auth_token;
}

async function resolveProjectId(
  env: z.infer<typeof envSchema>,
  authToken: string
): Promise<number> {
  if (env.TAIGA_PROJECT_ID) {
    return env.TAIGA_PROJECT_ID;
  }

  if (!env.TAIGA_BASE_URL || !env.TAIGA_PROJECT_SLUG) {
    throw new Error("Missing Taiga project config.");
  }

  const query = new URLSearchParams({ project: env.TAIGA_PROJECT_SLUG }).toString();
  const response = await fetchTaigaJson<TaigaResolverResponse>(
    buildApiUrl(env.TAIGA_BASE_URL, `/resolver?${query}`),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    }
  );

  if (!response.project) {
    throw new Error(
      `Taiga did not resolve a project id for slug "${env.TAIGA_PROJECT_SLUG}".`
    );
  }

  return response.project;
}

async function createProject(
  env: z.infer<typeof envSchema>,
  authToken: string
): Promise<TaigaEntityResponse> {
  if (!env.TAIGA_BASE_URL || !env.TAIGA_PROJECT_NAME) {
    throw new Error(
      "Missing Taiga project creation config. Set TAIGA_BASE_URL and TAIGA_PROJECT_NAME."
    );
  }

  return fetchTaigaJson<TaigaEntityResponse>(buildApiUrl(env.TAIGA_BASE_URL, "/projects"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      name: env.TAIGA_PROJECT_NAME,
      description: env.TAIGA_PROJECT_DESCRIPTION,
      is_private: env.TAIGA_PROJECT_PRIVATE ?? true,
      is_backlog_activated: true,
      is_kanban_activated: true,
      is_issues_activated: true,
      is_wiki_activated: false
    })
  });
}

function buildSubject(ticket: PlanTicket): string {
  return `[${ticket.ticket_key}] ${ticket.title}`;
}

function buildPayload(
  ticket: PlanTicket,
  projectRef: number | string,
  linkedUserStoryRef?: number | string
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    project: projectRef,
    subject: buildSubject(ticket),
    description: buildTicketDescription(ticket),
    tags: toTagList(ticket)
  };

  if (linkedUserStoryRef) {
    payload.user_story = linkedUserStoryRef;
  }

  return payload;
}

function summarize(tickets: PlanTicket[]): TaigaImportReport["summary"] {
  return {
    totalTickets: tickets.length,
    epics: tickets.filter((ticket) => ticket.issue_type === "Epic").length,
    stories: tickets.filter((ticket) => ticket.issue_type === "Story").length,
    tasks: tickets.filter((ticket) => ticket.issue_type === "Task").length
  };
}

function createOperation(
  ticket: PlanTicket,
  projectRef: number | string = "<set TAIGA_PROJECT_ID or TAIGA_PROJECT_SLUG>",
  linkedUserStoryRef?: number | string
): TaigaCreateOperation {
  return {
    sourceKey: ticket.ticket_key,
    sourceType: ticket.issue_type,
    taigaType: resolveTaigaItemType(ticket.issue_type),
    subject: buildSubject(ticket),
    parentEpicKey: ticket.parent_epic_key,
    payload: buildPayload(ticket, projectRef, linkedUserStoryRef),
    status: "pending"
  };
}

function findSingleStoryDependency(
  ticket: PlanTicket,
  createdStories: Map<string, TaigaEntityResponse>
): number | undefined {
  const matchingStoryDependencies = ticket.dependencies.filter((dependency) =>
    createdStories.has(dependency)
  );

  if (matchingStoryDependencies.length !== 1) {
    return undefined;
  }

  return createdStories.get(matchingStoryDependencies[0])?.id;
}

async function createEntity(
  baseUrl: string,
  authToken: string,
  taigaType: TaigaItemType,
  payload: Record<string, unknown>
): Promise<TaigaEntityResponse> {
  const pathByType: Record<TaigaItemType, string> = {
    epic: "/epics",
    userstory: "/userstories",
    task: "/tasks"
  };

  return fetchTaigaJson<TaigaEntityResponse>(buildApiUrl(baseUrl, pathByType[taigaType]), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify(payload)
  });
}

async function linkStoryToEpic(
  baseUrl: string,
  authToken: string,
  epicId: number,
  userStoryId: number
): Promise<Record<string, unknown>> {
  return fetchTaigaJson<Record<string, unknown>>(
    buildApiUrl(baseUrl, `/epics/${epicId}/related_userstories`),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        epic: epicId,
        user_story: userStoryId
      })
    }
  );
}

async function main(): Promise<void> {
  const { mode } = parseArgs(process.argv.slice(2));
  const env = envSchema.parse(process.env);
  const tickets = loadBacklog(env.TAIGA_BACKLOG_PATH);
  const report: TaigaImportReport = {
    generatedAt: new Date().toISOString(),
    mode,
    backlogPath: resolveFromCwd(env.TAIGA_BACKLOG_PATH),
    reportPath: resolveFromCwd(env.TAIGA_REPORT_PATH),
    project: {
      baseUrl: env.TAIGA_BASE_URL ? normalizeTaigaBaseUrl(env.TAIGA_BASE_URL) : undefined,
      projectId: env.TAIGA_PROJECT_ID,
      projectSlug: env.TAIGA_PROJECT_SLUG
    },
    summary: summarize(tickets),
    operations: [],
    warnings: [],
    success: false
  };

  if (mode === "dry-run") {
    for (const ticket of tickets) {
      report.operations.push(createOperation(ticket));
    }

    report.warnings.push(
      "Dry-run mode does not call Taiga. Set the Taiga env vars and run with --create to push the backlog."
    );
    report.success = true;
    writeReport(env.TAIGA_REPORT_PATH, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (!env.TAIGA_BASE_URL) {
    throw new Error("TAIGA_BASE_URL is required for live Taiga creation.");
  }

  const authToken = await resolveAuthToken(env);
  let projectId: number;

  try {
    projectId = await resolveProjectId(env, authToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown project resolution failure";

    if (
      message === "Missing Taiga project config." &&
      env.TAIGA_PROJECT_NAME &&
      env.TAIGA_BASE_URL
    ) {
      const project = await createProject(env, authToken);
      projectId = project.id;
      report.project.projectSlug = project.slug ?? env.TAIGA_PROJECT_SLUG;
      report.warnings.push(
        `Created Taiga project "${env.TAIGA_PROJECT_NAME}" because no existing project id or slug was provided.`
      );
    } else {
      throw error;
    }
  }

  report.project.projectId = projectId;

  const createdEpics = new Map<string, TaigaEntityResponse>();
  const createdStories = new Map<string, TaigaEntityResponse>();

  for (const ticket of tickets.filter((entry) => entry.issue_type === "Epic")) {
    const operation = createOperation(ticket, projectId);
    report.operations.push(operation);

    try {
      const result = await createEntity(env.TAIGA_BASE_URL, authToken, "epic", operation.payload);
      createdEpics.set(ticket.ticket_key, result);
      operation.status = "created";
      operation.result = {
        id: result.id,
        ref: result.ref,
        permalink: result.permalink
      };
    } catch (error) {
      operation.status = "failed";
      operation.error = error instanceof Error ? error.message : "Unknown Taiga error";
      report.warnings.push(`Epic creation failed for ${ticket.ticket_key}.`);
    }
  }

  for (const ticket of tickets.filter((entry) => entry.issue_type === "Story")) {
    const operation = createOperation(ticket, projectId);
    report.operations.push(operation);

    try {
      const result = await createEntity(
        env.TAIGA_BASE_URL,
        authToken,
        "userstory",
        operation.payload
      );
      createdStories.set(ticket.ticket_key, result);
      operation.status = "created";
      operation.result = {
        id: result.id,
        ref: result.ref,
        permalink: result.permalink
      };

      if (ticket.parent_epic_key && createdEpics.has(ticket.parent_epic_key)) {
        const epic = createdEpics.get(ticket.parent_epic_key)!;
        const linkResult = await linkStoryToEpic(
          env.TAIGA_BASE_URL,
          authToken,
          epic.id,
          result.id
        );
        operation.status = "linked";
        operation.result = {
          ...operation.result,
          epicId: epic.id,
          epicRef: epic.ref,
          linkResult
        };
      } else if (ticket.parent_epic_key) {
        report.warnings.push(
          `Story ${ticket.ticket_key} was created without an epic link because ${ticket.parent_epic_key} was unavailable.`
        );
      }
    } catch (error) {
      operation.status = "failed";
      operation.error = error instanceof Error ? error.message : "Unknown Taiga error";
      report.warnings.push(`Story creation failed for ${ticket.ticket_key}.`);
    }
  }

  for (const ticket of tickets.filter((entry) => entry.issue_type === "Task")) {
    const linkedUserStoryId = findSingleStoryDependency(ticket, createdStories);
    const operation = createOperation(ticket, projectId, linkedUserStoryId);
    report.operations.push(operation);

    if (!linkedUserStoryId && ticket.dependencies.some((dependency) => createdStories.has(dependency))) {
      report.warnings.push(
        `Task ${ticket.ticket_key} has multiple story dependencies and was created as a standalone Taiga task.`
      );
    }

    try {
      const result = await createEntity(env.TAIGA_BASE_URL, authToken, "task", operation.payload);
      operation.status = "created";
      operation.result = {
        id: result.id,
        ref: result.ref,
        permalink: result.permalink,
        linkedUserStoryId
      };
    } catch (error) {
      operation.status = "failed";
      operation.error = error instanceof Error ? error.message : "Unknown Taiga error";
      report.warnings.push(`Task creation failed for ${ticket.ticket_key}.`);
    }
  }

  report.success = report.operations.every((operation) => operation.status !== "failed");
  writeReport(env.TAIGA_REPORT_PATH, report);
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error: unknown) => {
  const env = envSchema.parse(process.env);
  const report: TaigaImportReport = {
    generatedAt: new Date().toISOString(),
    mode: parseArgs(process.argv.slice(2)).mode,
    backlogPath: resolveFromCwd(env.TAIGA_BACKLOG_PATH),
    reportPath: resolveFromCwd(env.TAIGA_REPORT_PATH),
    project: {
      baseUrl: env.TAIGA_BASE_URL ? normalizeTaigaBaseUrl(env.TAIGA_BASE_URL) : undefined,
      projectId: env.TAIGA_PROJECT_ID,
      projectSlug: env.TAIGA_PROJECT_SLUG
    },
    summary: {
      totalTickets: 0,
      epics: 0,
      stories: 0,
      tasks: 0
    },
    operations: [],
    warnings: [],
    success: false,
    error: error instanceof Error ? error.message : "Unknown Taiga import failure"
  };

  writeReport(env.TAIGA_REPORT_PATH, report);
  console.error(report.error);
  process.exitCode = 1;
});
