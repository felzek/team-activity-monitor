# Team Activity Monitor

Team Activity Monitor is now a fuller product-shaped application with:

- a public marketing site plus docs, security, and status pages
- multi-organization accounts with roles, invitations, and workspace switching
- org-scoped query history, audit events, and background-job tracking
- Jira and GitHub connector records with status metadata
- a protected dashboard for grounded teammate activity questions
- fixture-mode local runtime plus production-ready repo and hosting scaffolding

## What it is

The app answers questions like:

- `What is John working on these days?`
- `Show me recent activity for Sarah`
- `What has Mike been working on this week?`
- `Show me Lisa's recent pull requests`

It keeps Jira and GitHub data separate, surfaces caveats honestly, and saves each answer inside the active organization.

## Stack

- `Node.js`
- `TypeScript`
- `Express`
- `SQLite` via `better-sqlite3` for the runnable local/demo path
- `express-session`
- `bcryptjs`
- `Pino`
- `Zod`
- `Luxon`
- optional OpenAI polish via `OPENAI_API_KEY`

## Local run

```bash
npm install
cp .env.example .env
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Current auth and org flow

1. Open `/register`
2. Create an account and optionally name your workspace
3. Land in `/app`
4. Run activity questions, create invitations, update connector references, and edit workspace settings
5. Review query runs, audit events, and background jobs in the same dashboard

## Default local mode

The default `.env.example` runs in fixture mode:

```bash
USE_RECORDED_FIXTURES=true
```

That means:

- no Jira or GitHub tokens are required for local exploration
- the app uses recorded demo fixtures
- registration, organizations, invites, audit logs, and query history still work locally

## Live mode

To switch the activity engine to live Jira and GitHub calls:

1. Set `USE_RECORDED_FIXTURES=false`
2. Fill in:
   - `JIRA_BASE_URL`
   - `JIRA_EMAIL`
   - `JIRA_API_TOKEN`
   - `GITHUB_TOKEN`
3. Keep these configured:
   - [config/team-members.json](/Users/admin/autonomize/config/team-members.json)
   - [config/repos.json](/Users/admin/autonomize/config/repos.json)
4. Run:

```bash
npm run smoke
```

## Free web-hosting path

The repo now includes [render.yaml](/Users/admin/autonomize/render.yaml) for a free Render web service.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/felzek/team-activity-monitor)

What that gives you:

- a GitHub-connected deployment target from a private repo
- `npm ci && npm run build` for build
- `npm start` for runtime
- `/health/ready` as the health check
- fixture mode by default, so it can publish without Jira/GitHub credentials
- an `onrender.com` URL once the service is created in Render

Important note:

- the free-hosting path is intended for demos and product review
- because the runnable app currently uses SQLite for local/demo persistence, free-host deployments should be treated as non-durable unless you add managed persistence later

## Repo and CI/CD scaffolding

The repository includes:

- [Dockerfile](/Users/admin/autonomize/Dockerfile)
- [.github/workflows/ci.yml](/Users/admin/autonomize/.github/workflows/ci.yml)
- [.github/workflows/security.yml](/Users/admin/autonomize/.github/workflows/security.yml)
- [.github/workflows/build.yml](/Users/admin/autonomize/.github/workflows/build.yml)
- [.github/workflows/deploy-staging.yml](/Users/admin/autonomize/.github/workflows/deploy-staging.yml)
- [.github/workflows/deploy-prod.yml](/Users/admin/autonomize/.github/workflows/deploy-prod.yml)
- [.github/workflows/infra.yml](/Users/admin/autonomize/.github/workflows/infra.yml)
- [.github/workflows/nightly.yml](/Users/admin/autonomize/.github/workflows/nightly.yml)
- [.github/CODEOWNERS](/Users/admin/autonomize/.github/CODEOWNERS)
- [terraform/versions.tf](/Users/admin/autonomize/terraform/versions.tf)
- [terraform/variables.tf](/Users/admin/autonomize/terraform/variables.tf)

## Environment variables

- `PORT`
- `APP_NAME`
- `APP_BASE_URL`
- `APP_TIMEZONE`
- `APP_ENV`
- `AWS_REGION`
- `USE_RECORDED_FIXTURES`
- `TEAM_MEMBERS_CONFIG`
- `TRACKED_REPOS_CONFIG`
- `FIXTURE_DIR`
- `DATABASE_PATH`
- `SESSION_SECRET`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`
- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `GITHUB_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `COGNITO_USER_POOL_ID`
- `COGNITO_APP_CLIENT_ID`
- `COGNITO_DOMAIN`

## Database tables

The current runnable app creates and uses:

- `users`
- `organizations`
- `organization_memberships`
- `organization_settings`
- `organization_invitations`
- `jira_connections`
- `github_connections`
- `query_runs`
- `audit_events`
- `background_jobs`
- `sessions`

## Routes

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

Auth and org APIs:

- `GET /api/v1/auth/session`
- `GET /api/v1/auth/invitations/:token`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/switch-organization`
- `GET /api/v1/orgs`
- `GET /api/v1/orgs/:orgId/members`
- `GET /api/v1/orgs/:orgId/invitations`
- `POST /api/v1/orgs/:orgId/invitations`
- `GET /api/v1/orgs/:orgId/integrations`
- `PATCH /api/v1/orgs/:orgId/integrations/jira`
- `PATCH /api/v1/orgs/:orgId/integrations/github`
- `GET /api/v1/orgs/:orgId/settings`
- `PUT /api/v1/orgs/:orgId/settings`
- `POST /api/v1/orgs/:orgId/query`
- `GET /api/v1/orgs/:orgId/query-runs`
- `GET /api/v1/orgs/:orgId/audit-events`
- `GET /api/v1/orgs/:orgId/background-jobs`

Compatibility aliases retained:

- `GET /api/auth/session`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/history`
- `POST /api/query`

## Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
npm run smoke
npm run cli -- "What is John working on these days?"
npm run docker:build
```

## Verification

Current local verification:

- `npm run build`
- `npm test`

## Planning artifacts

- [planning/demo-script.md](/Users/admin/autonomize/planning/demo-script.md)
- [planning/backlog.csv](/Users/admin/autonomize/planning/backlog.csv)
- [planning/backlog.json](/Users/admin/autonomize/planning/backlog.json)
- [planning/tracker-mapping.md](/Users/admin/autonomize/planning/tracker-mapping.md)
