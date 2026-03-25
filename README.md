# Team Activity Monitor

Team Activity Monitor is a web app and CLI for answering questions like:

- `What is John working on these days?`
- `Show me Sarah's current issues`
- `What has Mike committed this week?`

It combines Jira and GitHub activity into one grounded answer, keeps the sources separate, and now uses a local open-source model through Ollama instead of the old deterministic renderer.

## At a glance

- Web app plus thin CLI
- Workspace accounts with invitations and roles
- Per-user GitHub and Jira sign-in requirement before queries run
- Jira and GitHub connector records
- Query history, audit events, and background jobs
- Local open-source response generation with Ollama
- Render-ready app shell with a configurable external Ollama endpoint

## How the AI pipeline works

1. The app parses the question to extract the teammate name, intent, and timeframe.
2. It resolves the person through the workspace alias map and stored workspace settings.
3. It fetches Jira and GitHub data in parallel.
4. It normalizes the provider results into one `ActivitySummary` object.
5. It sends only that normalized JSON to a local Ollama model.
6. The model returns a grounded answer with four sections:
   - Overview
   - Jira
   - GitHub
   - Caveats

There is no longer a deterministic response fallback in the main app flow. If Ollama is unavailable, the app surfaces a clear error instead of silently switching to a different response path.

## Visual guide

The quickest way to understand the implementation is [planning/architecture-diagrams.md](planning/architecture-diagrams.md). It shows:

- the product/system overview
- the AI/query pipeline
- the deployment and delivery path

## Local setup

```bash
npm install
cp .env.example .env
```

### 1. Run a local open-source model with Ollama

Install Ollama from [ollama.com/download](https://ollama.com/download), start the Ollama service, and pull the default model used by this repo:

```bash
ollama serve
ollama pull qwen2.5:7b
```

If your Ollama install already runs as a background service, you only need the `pull` step.

Then verify the model endpoint:

```bash
npm run llm:check
```

Expected result:

- the script reaches `OLLAMA_BASE_URL`
- the configured model exists locally
- a tiny chat check returns a response such as `READY`

### 2. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Required local model settings

The response layer now depends on these variables:

```bash
OLLAMA_BASE_URL=http://localhost:11434/api
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_KEEP_ALIVE=10m
```

If you prefer a different local model, change `OLLAMA_MODEL` and make sure that model exists in Ollama before running the app.

## Demo flow

1. Register or log in
2. Open the dashboard
3. Connect your GitHub and Jira accounts
   - In local fixture/dev mode without OAuth credentials, the app uses demo-connect buttons.
   - When provider OAuth credentials are configured, the same buttons switch to real GitHub and Jira authorization redirects.
4. Ask a teammate question
5. Review the structured Jira and GitHub results
6. Inspect caveats, timestamps, source status, and saved history

Default local mode still uses recorded Jira/GitHub fixtures, so you can explore the product before adding live provider credentials.

## Live provider mode

To switch from recorded fixtures to live Jira and GitHub calls:

1. Set `USE_RECORDED_FIXTURES=false`
2. Fill in:
   - `JIRA_BASE_URL`
   - `JIRA_EMAIL`
   - `JIRA_API_TOKEN`
   - `GITHUB_TOKEN`
3. Keep these config files populated:
   - `config/team-members.json`
   - `config/repos.json`
4. Run:

```bash
npm run smoke
```

## Render deployment

The repo still includes [render.yaml](render.yaml) and a one-click Render path:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/felzek/team-activity-monitor)

Important deployment note:

- Render can host the app shell
- queries now require a reachable Ollama endpoint
- a free Render service cannot use your laptop's `localhost`
- for a hosted deployment, set `OLLAMA_BASE_URL` to an Ollama host that the Render service can actually reach

If you want the full app to stay local, run both the app and Ollama on the same machine.

## Stack

- `Node.js`
- `TypeScript`
- `Express`
- `SQLite` for the local/demo app path
- `express-session`
- `bcryptjs`
- `Pino`
- `Zod`
- `Luxon`
- `Ollama` for local open-source response generation

## Key routes

Pages:

- `/`
- `/login`
- `/register`
- `/app`
- `/docs`
- `/security`
- `/status`

Operational endpoints:

- `GET /api/health`
- `GET /health/live`
- `GET /health/ready`
- `GET /health/startup`

Core APIs:

- `GET /api/v1/auth/session`
- `GET /api/v1/auth/providers`
- `GET /api/v1/auth/providers/:provider/start`
- `GET /api/v1/auth/providers/:provider/callback`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/providers/:provider/login`
- `POST /api/v1/auth/providers/:provider/demo-connect`
- `DELETE /api/v1/auth/providers/:provider`
- `GET /api/v1/orgs`
- `GET /api/v1/orgs/:orgId/query-runs`
- `GET /api/v1/orgs/:orgId/audit-events`
- `POST /api/v1/orgs/:orgId/query`

## Config

The most important environment variables are:

- `USE_RECORDED_FIXTURES`
- `APP_BASE_URL`
- `APP_TIMEZONE`
- `SESSION_SECRET`
- `DATABASE_PATH`
- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_OAUTH_CLIENT_ID`
- `JIRA_OAUTH_CLIENT_SECRET`
- `JIRA_OAUTH_SCOPE`
- `GITHUB_TOKEN`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_SCOPE`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `OLLAMA_KEEP_ALIVE`

## Useful commands

```bash
npm run dev
npm run build
npm test
npm run smoke
npm run llm:check
npm run cli -- "What is John working on these days?"
```

## Planning artifacts

- [planning/architecture-diagrams.md](planning/architecture-diagrams.md)
- [planning/demo-script.md](planning/demo-script.md)
- [planning/backlog.csv](planning/backlog.csv)
- [planning/backlog.json](planning/backlog.json)
- [planning/tracker-mapping.md](planning/tracker-mapping.md)

## Verification

Current local verification:

- `npm run build`
- `npm test`
- `npm run llm:check`
