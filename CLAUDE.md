# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Team Activity Monitor — a multi-tenant SaaS that tracks team activity across Jira and GitHub, using a local Ollama LLM to generate natural-language summaries. Built with Express 5, SQLite, and TypeScript (strict mode, ES modules).

## Common Commands

```bash
npm run dev              # Hot-reload dev server (tsx watch, port 3000)
npm test                 # Run Vitest once
npm run test:watch       # Vitest in watch mode
npm run build            # Compile TypeScript to dist/
npm run typecheck        # Type-check only (tsc --noEmit) — also aliased as `npm run lint`
npm start                # Run compiled server (dist/server.js)
npm run cli -- "query"   # CLI interface for natural-language queries
npm run llm:check        # Verify Ollama server and model availability
npm run smoke            # Integration tests against live providers
npm run docker:build     # Build Docker image
```

Run a single test file: `npx vitest run tests/query-parser.test.ts`
Run tests matching a name: `npx vitest run -t "parses timeframe"`

Setup: `npm install && cp .env.example .env`, then `ollama pull qwen2.5:7b` for the local model.

## Architecture

### Query Pipeline

Natural-language queries flow through a multi-stage pipeline:

1. **Parse** (`src/query/parser.ts`) — regex-based intent detection (activity_summary, jira_only, github_commits, github_prs) and timeframe extraction
2. **Resolve** (`src/query/identity.ts`) — fuzzy team member matching with scoring (exact > word boundary > substring)
3. **Fetch** (`src/orchestrator/activity.ts`) — parallel Jira + GitHub data fetching via provider adapters, with graceful degradation
4. **Generate** (`src/lib/ollama.ts`) — sends activity summary to local Ollama model for grounded response

### Provider Adapters

- `src/adapters/jira.ts` — Jira REST API (search, changelog, user lookup) via Basic auth
- `src/adapters/github-commits.ts` — GitHub commits API
- `src/adapters/github-prs.ts` — GitHub pull requests API

All adapters support fixture mode (`USE_RECORDED_FIXTURES=true`) for development without credentials.

### Multi-Tenancy

SQLite stores everything: users, organizations, memberships, sessions, connectors, audit events, query history. Organizations have role-based access (owner/admin/member/support) and workspace-scoped settings. Session store is also SQLite-backed (not in-memory).

### App Wiring

`createApp()` in `src/app.ts` takes explicit `(config, logger, database)` arguments — no singletons. `src/server.ts` wires them together for production; tests build their own via `buildTestConfig()` + `initializeDatabase()`.

### Config

`src/config.ts` validates all env vars with Zod. Team members and tracked repos loaded from `config/team-members.json` and `config/repos.json`. Per-organization overrides for team members and repos are stored in SQLite and merged at query time.

## Testing

Tests use Vitest + Supertest. Each test gets a temporary SQLite database (on-disk in tmp, cleaned up via `cleanupTestConfig()`). Test helpers live in `tests/helpers.ts`:

- `buildTestConfig()` / `cleanupTestConfig()` — isolated config with temp DB
- `mockLocalModelResponse()` — mocks `fetch` to stub Ollama responses

**CSRF in tests**: All mutating API calls require a CSRF token. Fetch it from `GET /api/v1/auth/session` and send it as `x-csrf-token` header. See `postWithCsrf` / `patchWithCsrf` / `putWithCsrf` helpers in `tests/app.test.ts`.

## Key Conventions

- ES modules throughout (`"type": "module"` in package.json, NodeNext module resolution). **All local imports must use `.js` extensions** (e.g., `import { foo } from "./bar.js"`) even though source files are `.ts`.
- TypeScript 6 with strict mode; no ESLint or Prettier — the only lint check is `tsc --noEmit`
- Pino for structured logging with automatic redaction of auth headers and tokens (`src/lib/logger.ts`)
- Zod for input validation at system boundaries
- CSRF protection on all mutating endpoints; security headers set globally
- Custom error class `AppError` (in `src/lib/errors.ts`) carries `code` and `statusCode` for structured API error responses
- `src/types/` contains domain types split by concern: `auth.ts`, `activity.ts`, `jira.ts`, `github.ts`, `session.d.ts`
