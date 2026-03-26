# Team Activity Monitor

A multi-tenant SaaS that answers natural-language questions about your team's engineering activity by pulling real data from Jira and GitHub and generating grounded answers with an LLM.

> "What is John working on this week?"
> "Show me Sarah's open pull requests"
> "What has Mike committed in the last 14 days?"

---

## How it works

### RAG pipeline (end to end)

Every query runs through five stages. The LLM only ever sees real fetched data — it never invents facts.

```
User query
    │
    ▼  1. PARSE  src/query/parser.ts
       Extracts intent (activity_summary / jira_only / github_commits / github_prs),
       team member name, and timeframe from the natural-language question.
    │
    ▼  2. RESOLVE  src/query/identity.ts
       Fuzzy-matches the name against config/team-members.json and per-org overrides
       stored in SQLite. Scoring: exact (100) > word boundary (80+) > substring (70+).
    │
    ▼  3. RETRIEVE  src/orchestrator/activity.ts  (parallel)
       ┌─────────────────────────────────────────────────────────────────┐
       │ Jira  src/adapters/jira.ts                                      │
       │   POST api.atlassian.com/ex/jira/{cloudId}/rest/api/3/search    │
       │   Bearer {user OAuth token}  OR  Basic {service account}        │
       │   JQL: assignee = "{accountId}" AND statusCategory != Done      │
       │   + changelog for each issue (field changes within timeframe)   │
       │                                                                 │
       │ GitHub commits  src/adapters/github-commits.ts                  │
       │   GET api.github.com/repos/{owner}/{repo}/commits               │
       │   ?author={githubUsername}&since={timeframe.start}              │
       │                                                                 │
       │ GitHub PRs  src/adapters/github-prs.ts                          │
       │   GET api.github.com/repos/{owner}/{repo}/pulls?state=all       │
       │   filtered to user.login === githubUsername within timeframe    │
       └─────────────────────────────────────────────────────────────────┘
    │
    ▼  4. STRUCTURE  src/orchestrator/activity.ts
       Compiles all provider results into one ActivitySummary JSON:
       { member, intent, timeframe, jira: { status, data }, github: { status, data }, caveats }
       Source failures are captured as ProviderStatus.ok=false — they never throw.
    │
    ▼  5. GENERATE  src/lib/llm-pipeline.ts
       Builds a grounded prompt containing:
         - pre-computed counts (issues, commits, PRs, source health)
         - step-by-step extraction instructions (chain-of-thought grounding)
         - full ActivitySummary JSON
       Sends to the selected LLM provider. LLM is instructed to quote keys/
       dates/repo names verbatim from the JSON and never invent facts.
       Returns four sections: Overview / Jira / GitHub / Caveats.
```

---

## LLM providers

The app supports four LLM backends. Users pick one per query from the dashboard.

| Provider | Model ID prefix | Auth |
|---|---|---|
| Ollama (local) | `local:` | No key needed — Ollama running on `OLLAMA_BASE_URL` |
| OpenAI | `openai:` | API key stored encrypted in SQLite per user |
| Anthropic Claude | `claude:` | API key stored encrypted in SQLite per user |
| Google Gemini | `gemini:` | API key stored encrypted in SQLite per user |

**Routing** (`src/llm/`): `LlmProviderRegistry.parseModelId()` splits `"openai:gpt-4o"` into `{ provider, providerModelId }`. `LlmService.chat()` routes to the correct adapter. Cloud model errors propagate as typed `LlmError` — there is no silent fallback to a different model.

---

## OAuth & data credentials

### OAuth token lifecycle

When a user connects GitHub or Jira via OAuth:

1. The app exchanges the code for an access token + refresh token.
2. Both tokens are encrypted with AES-256-GCM (same key as LLM API keys) and stored in `user_provider_connections`.
3. The user's Jira cloud site ID is stored in `metadata.siteId`.

At query time the app automatically uses the user's own token instead of the shared service-account credentials:

- **GitHub**: standard Bearer token — same API surface as a PAT, no expiry on classic OAuth tokens.
- **Jira**: Bearer token + Atlassian Cloud API (`api.atlassian.com/ex/jira/{siteId}/rest/api/3/...`). Jira tokens expire in ~1 hour.

### Auto-refresh (Jira)

Before every query the app checks whether the Jira token expires within 5 minutes. If so:

```
getActiveProviderToken()
    ├── token still valid → use as-is
    ├── expires within 5 min + refresh token present
    │       → POST auth.atlassian.com/oauth/token { grant_type: refresh_token }
    │       → save new access + refresh tokens encrypted to DB
    │       → return new access token transparently
    └── refresh fails / no refresh token
            → warn in server log, fall back to JIRA_API_TOKEN service account
```

Atlassian may rotate the refresh token itself — the app always stores whichever refresh token the response returns.

GitHub tokens don't expire, so no refresh is needed.

### Fallback chain

| User has connected? | Token expired? | Refresh available? | Adapter uses |
|---|---|---|---|
| Yes | No | — | User OAuth token |
| Yes | Yes | Yes | Refreshed user OAuth token |
| Yes | Yes | No | Service account (`JIRA_API_TOKEN` / `GITHUB_TOKEN`) |
| No | — | — | Service account |

---

## Fixture mode vs live mode

`USE_RECORDED_FIXTURES=true` (the default in `render.yaml`) loads pre-recorded JSON from `fixtures/demo/` — no real API calls, no credentials needed. Useful for demos and local exploration.

`USE_RECORDED_FIXTURES=false` enables live API calls. Requires:

```env
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=service-account@your-org.com
JIRA_API_TOKEN=...
GITHUB_TOKEN=ghp_...
```

Then update `config/team-members.json` with real display names and GitHub usernames (Jira account IDs auto-resolve via `/rest/api/3/user/search`), and `config/repos.json` with your real org/repo pairs.

---

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional: local model via Ollama

```bash
brew install ollama          # or download from ollama.com
ollama pull qwen2.5:7b
npm run llm:check            # verifies OLLAMA_BASE_URL + model
```

Set in `.env`:
```env
OLLAMA_BASE_URL=http://localhost:11434/api
OLLAMA_MODEL=qwen2.5:7b
```

If you prefer a cloud model (OpenAI, Claude, Gemini), add your API key through the dashboard — no Ollama required.

### OAuth setup (optional for live data)

To enable real GitHub and Jira OAuth sign-in:

**GitHub**: Create an OAuth App at github.com → Settings → Developer settings → OAuth Apps.
Callback URL: `http://localhost:3000/api/v1/auth/providers/github/callback`

**Jira**: Create an OAuth 2.0 app at developer.atlassian.com.
Scopes: `read:jira-work read:jira-user offline_access`
Callback URL: `http://localhost:3000/api/v1/auth/providers/jira/callback`

Add to `.env`:
```env
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
JIRA_OAUTH_CLIENT_ID=...
JIRA_OAUTH_CLIENT_SECRET=...
```

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js, TypeScript (strict, ES modules) |
| Web framework | Express 5 |
| Database | SQLite via `better-sqlite3` |
| Session store | SQLite-backed (not in-memory) |
| Auth | bcrypt passwords + OAuth (GitHub, Jira, Google) |
| Token encryption | AES-256-GCM (scrypt key derivation) |
| LLM — local | Ollama (`qwen2.5:7b` default) |
| LLM — cloud | OpenAI, Anthropic Claude, Google Gemini |
| Logging | Pino (structured JSON, auth header redaction) |
| Validation | Zod (all env vars + API boundaries) |
| Testing | Vitest + Supertest |

---

## Key source files

```
src/
  query/
    parser.ts          — intent + timeframe extraction
    identity.ts        — fuzzy member matching
  adapters/
    jira.ts            — Jira REST API (OAuth Bearer or Basic auth)
    github-commits.ts  — GitHub commits API
    github-prs.ts      — GitHub pull requests API
  orchestrator/
    activity.ts        — parallel fetch → ActivitySummary
  lib/
    llm-pipeline.ts    — prompt building + Ollama local model call
    provider-auth.ts   — OAuth flows (GitHub, Jira, Google) + Jira token refresh
    encryption.ts      — AES-256-GCM encrypt/decrypt
    errors.ts          — AppError, LlmError, ProviderError
  llm/
    registry.ts        — parseModelId() — routes "openai:gpt-4o" to OpenAI adapter
    service.ts         — LlmService.chat() — dispatch to adapter
    adapters/
      openai.ts
      anthropic.ts
      gemini.ts
  app.ts               — Express wiring, OAuth callbacks, query endpoint
  db.ts                — SQLite schema, migrations, all DB methods
  config.ts            — Zod env validation
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | Signs session cookies |
| `APP_BASE_URL` | Yes | Public URL (used for OAuth callbacks) |
| `DATABASE_PATH` | Yes | SQLite file path |
| `USE_RECORDED_FIXTURES` | — | `true` = demo fixtures, `false` = live APIs |
| `JIRA_BASE_URL` | Live mode | `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | Live mode | Service account email |
| `JIRA_API_TOKEN` | Live mode | Atlassian API token (fallback when no OAuth) |
| `JIRA_OAUTH_CLIENT_ID` | OAuth | Atlassian OAuth app client ID |
| `JIRA_OAUTH_CLIENT_SECRET` | OAuth | Atlassian OAuth app client secret |
| `GITHUB_TOKEN` | Live mode | PAT with `repo:read` (fallback when no OAuth) |
| `GITHUB_OAUTH_CLIENT_ID` | OAuth | GitHub OAuth app client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth | GitHub OAuth app client secret |
| `OLLAMA_BASE_URL` | Local LLM | e.g. `http://localhost:11434/api` |
| `OLLAMA_MODEL` | Local LLM | e.g. `qwen2.5:7b` |

---

## Commands

```bash
npm run dev                          # Hot-reload dev server (port 3000)
npm test                             # Run Vitest once (78 tests)
npm run typecheck                    # tsc --noEmit
npm run build                        # Compile to dist/
npm start                            # Run compiled server
npm run cli -- "What is John doing?" # CLI query
npm run llm:check                    # Verify Ollama connection
npm run smoke                        # Integration tests against live providers
```

---

## Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/felzek/team-activity-monitor)

The included `render.yaml` runs in fixture mode by default. To switch to live data:
1. Set `USE_RECORDED_FIXTURES=false` in Render env vars
2. Add `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `GITHUB_TOKEN`
3. Optionally add OAuth client credentials for per-user token auth
