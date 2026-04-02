# Team Activity Monitor

Team Activity Monitor is a multi-tenant Express + TypeScript application that answers natural-language questions about engineering activity by combining Jira, GitHub, and LLM-generated summaries.

The repository is now Vercel-first:
- Vercel deploys the Express app from [`app.ts`](./app.ts)
- the build command is `npm run build`
- Vercel AI Gateway is the default hosted model path when it is configured
- local Ollama remains the default fallback for local development

## Runtime Overview

- Runtime: Node.js 22
- Backend: Express 5 + TypeScript (strict, ES modules)
- Frontend: React + Vite, built into `public/app/`
- Database: SQLite via `better-sqlite3`
- Sessions: SQLite-backed `express-session`
- Hosted AI default: Vercel AI Gateway
- Local AI fallback: Ollama

## Important Deployment Note

The app now deploys cleanly on Vercel, but the persistence layer is still SQLite-on-disk. On Vercel, the default database path becomes `/tmp/team-activity-monitor.db`, which is ephemeral.

That means:
- Preview deployments work well for demos, QA, and low-risk testing
- single-instance hosted usage can work, but it is not durable storage
- true multi-instance production durability still requires a future move to a managed database

The code and docs make this explicit instead of hiding it behind old hosting assumptions.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template:

```bash
cp .env.example .env
```

3. Start the backend and frontend:

```bash
npm run dev:all
```

4. Open:

- backend: [http://localhost:3000](http://localhost:3000)
- frontend dev server: [http://localhost:5173/app/](http://localhost:5173/app/)

For a production-style local build:

```bash
npm run build
npm start
```

## Local Model Setup

If you want to use the local Ollama path:

```bash
ollama pull qwen2.5:7b
npm run llm:check
```

Recommended local model env:

```env
DEFAULT_MODEL_ID=local:qwen2.5:7b
OLLAMA_BASE_URL=http://localhost:11434/api
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_KEEP_ALIVE=10m
```

## Vercel Deployment

### Deployment Shape

- Vercel uses zero-config Express support from [`app.ts`](./app.ts)
- [`vercel.json`](./vercel.json) sets:
  - build command: `npm run build`
  - function timeout: 60 seconds
  - included runtime files: `public/**/*`, `config/**/*`, `fixtures/**/*`
- preview URLs infer `APP_BASE_URL` from `VERCEL_URL` when you do not set it explicitly
- background polling is disabled on Vercel, and connector validation runs inline instead

### Deploy From Git

1. Import the repository into Vercel.
2. Keep the framework preset as `Other`.
3. Confirm the build command is `npm run build`.
4. Set the environment variables listed below.
5. Deploy.

### Deploy With Vercel CLI

```bash
npm install -g vercel
vercel
vercel --prod
```

### Required Vercel Dashboard Setup

Set these in Project Settings -> Environment Variables:

| Variable | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | Yes | Must be a strong random secret |
| `APP_BASE_URL` | Production strongly recommended | Set this to your production domain; previews can infer from `VERCEL_URL` |
| `USE_RECORDED_FIXTURES` | Yes | `true` for demo mode, `false` for live Jira/GitHub traffic |
| `AI_GATEWAY_API_KEY` | Optional | Static Gateway auth for non-Vercel environments |
| `VERCEL_OIDC_TOKEN` | Optional | Local Gateway auth after `vercel env pull` |
| `AI_GATEWAY_DEFAULT_MODEL` | Recommended | Default hosted model slug |
| `DEFAULT_MODEL_ID` | Recommended | Example: `gateway:alibaba/qwen-3-32b` |

If `USE_RECORDED_FIXTURES=false`, also set the live provider credentials you use:

| Variable | Required | Notes |
|---|---|---|
| `JIRA_BASE_URL` | Yes | Example: `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | Yes | Jira service account email |
| `JIRA_API_TOKEN` | Yes | Jira fallback token |
| `GITHUB_TOKEN` | Yes | GitHub fallback token |
| `JIRA_OAUTH_CLIENT_ID` | Optional | Needed for user OAuth |
| `JIRA_OAUTH_CLIENT_SECRET` | Optional | Needed for user OAuth |
| `GITHUB_OAUTH_CLIENT_ID` | Optional | Needed for user OAuth |
| `GITHUB_OAUTH_CLIENT_SECRET` | Optional | Needed for user OAuth |
| `GOOGLE_OAUTH_CLIENT_ID` | Optional | Needed for artifact integrations |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Optional | Needed for artifact integrations |
| `GOOGLE_PICKER_API_KEY` | Optional | Needed for Drive picker UX |
| `RESEND_API_KEY` | Optional | Invitation email sending |
| `EMAIL_FROM` | Optional | Outbound sender |

### Vercel Runtime Notes

- `DATABASE_PATH` defaults to `/tmp/team-activity-monitor.db` on Vercel
- `BACKGROUND_WORKER_ENABLED` defaults to `false` on Vercel
- cookies are marked `secure` automatically when `APP_BASE_URL` is HTTPS
- deployed Vercel functions can authenticate AI Gateway with the platform OIDC request header
- the app works in Preview and Production with the same entrypoint

## Vercel AI Gateway

### What Changed

- the app now supports a first-class `gateway:` provider
- if Gateway auth is configured, the default model path becomes:

```env
gateway:${AI_GATEWAY_DEFAULT_MODEL}
```

- direct OpenAI, Anthropic, and Gemini keys are still supported as BYOK options
- local Ollama is still supported with `local:<model>`

### Recommended Gateway Defaults

These values match the current repo defaults:

```env
AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1
AI_GATEWAY_DEFAULT_MODEL=alibaba/qwen-3-32b
AI_GATEWAY_MODELS=alibaba/qwen-3-32b,openai/gpt-5.4,anthropic/claude-sonnet-4-6
DEFAULT_MODEL_ID=gateway:alibaba/qwen-3-32b
```

### Authentication

Preferred on Vercel:
- enable AI Gateway in the Vercel project
- use Vercel-managed OIDC auth in deployments

Preferred for local development against the same project:

```bash
vercel link
vercel env pull .env.local
```

That gives you `VERCEL_OIDC_TOKEN` locally.

Fallback option:
- set `AI_GATEWAY_API_KEY` manually

### Model Routing Rules

- `gateway:<provider>/<model>` uses Vercel AI Gateway
- `local:<model>` uses Ollama
- `openai:<model>`, `claude:<model>`, and `gemini:<model>` still use direct user-saved provider keys

The app now centralizes its hosted default model selection instead of assuming Ollama everywhere.

## Environment Variables

The repo validates env vars in [`src/config.ts`](./src/config.ts).

### Core

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Local server port |
| `APP_NAME` | `Team Activity Monitor` | Display/app name |
| `APP_BASE_URL` | inferred | Public base URL |
| `APP_ENV` | inferred | `development`, `staging`, or `production` |
| `APP_TIMEZONE` | `America/New_York` | Query and reporting timezone |
| `SESSION_SECRET` | none in production | Session signing secret |
| `DATABASE_PATH` | `data/app.db` locally, `/tmp/team-activity-monitor.db` on Vercel | SQLite path |
| `BACKGROUND_WORKER_ENABLED` | `true` locally, `false` on Vercel | Enables polling worker |

### Data Sources

| Variable | Purpose |
|---|---|
| `USE_RECORDED_FIXTURES` | Switch between fixture mode and live mode |
| `TEAM_MEMBERS_CONFIG` | Team member config JSON path |
| `TRACKED_REPOS_CONFIG` | Tracked repo config JSON path |
| `FIXTURE_DIR` | Fixture directory |
| `JIRA_BASE_URL` | Jira base URL |
| `JIRA_EMAIL` | Jira service account email |
| `JIRA_API_TOKEN` | Jira fallback token |
| `GITHUB_TOKEN` | GitHub fallback token |

### OAuth / Artifacts

| Variable | Purpose |
|---|---|
| `JIRA_OAUTH_CLIENT_ID` / `JIRA_OAUTH_CLIENT_SECRET` | Jira OAuth |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_PICKER_API_KEY` | Google Picker |
| `RESEND_API_KEY` | Invitation email sending |
| `EMAIL_FROM` | Outbound sender |

### AI

| Variable | Purpose |
|---|---|
| `DEFAULT_MODEL_ID` | Explicit default system model |
| `AI_GATEWAY_BASE_URL` | Gateway endpoint |
| `AI_GATEWAY_API_KEY` | Manual Gateway auth |
| `VERCEL_OIDC_TOKEN` | Local Vercel OIDC auth |
| `AI_GATEWAY_DEFAULT_MODEL` | Raw gateway model slug |
| `AI_GATEWAY_MODELS` | Comma-separated gateway models exposed in the UI |
| `OLLAMA_BASE_URL` | Local Ollama base URL |
| `OLLAMA_MODEL` | Local Ollama default model |
| `OLLAMA_KEEP_ALIVE` | Local model keepalive |

## Health Checks and Validation

After deployment, verify:

1. `GET /api/health`
2. `GET /health/ready`
3. Register or log in successfully
4. Open the chat UI and confirm the model selector shows Gateway models
5. Run a sample query
6. Patch a Jira or GitHub integration and confirm the connector status updates immediately

Useful commands:

```bash
npm run typecheck
npm test
npm run build
```

## Source Map

- [`app.ts`](./app.ts): Vercel Express entrypoint
- [`vercel.json`](./vercel.json): Vercel build/runtime config
- [`src/runtime.ts`](./src/runtime.ts): shared app bootstrap
- [`src/server.ts`](./src/server.ts): local listening server
- [`src/config.ts`](./src/config.ts): env validation and runtime inference
- [`src/llm/adapters/gateway.ts`](./src/llm/adapters/gateway.ts): Gateway provider
- [`src/llm/gateway-client.ts`](./src/llm/gateway-client.ts): Gateway auth and fetch helper

## Migration Note

Legacy hosting items removed or replaced:
- deleted the old platform manifest
- removed the old deploy badge and platform-specific deployment instructions from the README
- removed the old hosting references from Terraform notes
- removed the old hosting references from planning diagrams

Vercel-specific replacements:
- zero-config Express entrypoint via `app.ts`
- explicit `vercel.json`
- Vercel AI Gateway as the hosted default model path
- inline connector validation when no background worker is running

Manual Vercel dashboard setup still required:
- set `SESSION_SECRET`
- set `APP_BASE_URL` for production
- enable AI Gateway and provide auth via OIDC or `AI_GATEWAY_API_KEY`
- add live Jira/GitHub/OAuth env vars if you are not using fixture mode

## Commands

```bash
npm run dev
npm run dev:client
npm run dev:all
npm run build
npm run typecheck
npm test
npm start
npm run cli -- "What is John working on this week?"
npm run llm:check
```
