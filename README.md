# Team Activity Monitor

Team Activity Monitor is a demo-ready internal tool that answers questions like:

- `What is John working on these days?`
- `Show me Sarah's current issues`
- `What has Mike committed this week?`

It combines Jira and GitHub activity into one grounded response, keeps the sources separate, and explains when data is missing or partial instead of guessing.

## At a glance

- Web app plus thin CLI
- Workspace accounts with invitations and roles
- Jira and GitHub connector records
- Query history, audit events, and background jobs
- Fixture mode for safe local/demo runs
- Render-ready deployment path for a public URL

## How the AI pipeline works

1. The app parses the question to extract the teammate name, intent, and timeframe.
2. It resolves the person through the workspace alias map and stored integration settings.
3. It fetches Jira and GitHub data in parallel.
4. It normalizes the results into a single activity summary.
5. It renders a grounded answer with four sections:
   - Overview
   - Jira
   - GitHub
   - Caveats

If `OPENAI_API_KEY` is set, the app can optionally polish the wording. If not, it falls back to deterministic templates so the demo still works.

## Visual guide

The quickest way to understand the implementation is the diagram set in [planning/architecture-diagrams.md](planning/architecture-diagrams.md). It shows:

- the product/system overview
- the AI/query pipeline
- the deployment and delivery path

## Local run

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo flow

1. Register or log in
2. Open the dashboard
3. Ask a teammate question
4. Review Jira and GitHub results side by side
5. Check caveats, timestamps, and source labels

Default local mode uses recorded fixtures, so Jira/GitHub tokens are not required for the first run.

## Render deployment

The repo includes [render.yaml](render.yaml) and a one-click deploy path for the private GitHub repo.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/felzek/team-activity-monitor)

Render gives the fastest path to a public demo URL from the private repo. It is intended for review and prototype use.

## Stack

- `Node.js`
- `TypeScript`
- `Express`
- `SQLite` for the local/demo path
- `express-session`
- `bcryptjs`
- `Pino`
- `Zod`
- `Luxon`

Optional AI polish is available through OpenAI when `OPENAI_API_KEY` is present.

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
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
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
- `GITHUB_TOKEN`
- `OPENAI_API_KEY`

The local fixture setup is the safest starting point for a demo:

```bash
USE_RECORDED_FIXTURES=true
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
