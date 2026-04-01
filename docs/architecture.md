# Architecture

This document explains how the current repository is put together, from the React workspace down to the provider integrations.

## System Overview

```mermaid
flowchart LR
  subgraph Browser["Browser"]
    Routes["React routes"]
    ChatUI["Chat and artifact UI"]
    IntelUI["Intelligence dashboard"]
    SettingsUI["Settings UI"]
    Stores["Zustand stores"]
  end

  subgraph Server["Express application"]
    ServerMain["src/server.ts"]
    App["src/app.ts"]
    Conv["Conversation router"]
    ArtifactRoutes["Artifact router"]
    IntelRoutes["Intelligence router"]
    LlmRoutes["LLM utility router"]
    ChatPipe["src/lib/chat-pipeline.ts"]
    QueryPipe["src/orchestrator/activity.ts and src/lib/llm-pipeline.ts"]
    ArtifactSvc["src/lib/artifacts/service.ts"]
    DB["src/db.ts"]
    Worker["src/lib/job-worker.ts"]
  end

  subgraph Providers["External services"]
    Jira["Jira"]
    GitHub["GitHub"]
    Google["Google Drive, Docs, Sheets, and Slides"]
    Models["Ollama, OpenAI, Claude, and Gemini"]
  end

  Routes --> ChatUI
  Routes --> IntelUI
  Routes --> SettingsUI
  Stores --> ChatUI
  Stores --> IntelUI
  Stores --> SettingsUI

  ChatUI --> App
  IntelUI --> App
  SettingsUI --> App

  ServerMain --> App
  ServerMain --> Worker

  App --> Conv
  App --> ArtifactRoutes
  App --> IntelRoutes
  App --> LlmRoutes
  App --> ChatPipe
  App --> QueryPipe
  ArtifactRoutes --> ArtifactSvc

  Conv --> DB
  ArtifactRoutes --> DB
  IntelRoutes --> DB
  LlmRoutes --> DB
  ChatPipe --> DB
  QueryPipe --> DB
  ArtifactSvc --> DB
  Worker --> DB

  ChatPipe --> Jira
  ChatPipe --> GitHub
  ChatPipe --> Models
  QueryPipe --> Jira
  QueryPipe --> GitHub
  QueryPipe --> Models
  ArtifactSvc --> Google
  Worker --> Jira
  Worker --> GitHub
```

## Main Runtime Pieces

### Backend

- `src/server.ts` is the real process entry point. It loads config, initializes SQLite, builds the Express app, and starts the job worker.
- `src/app.ts` is the central composition root. It mounts auth, sessions, security middleware, API routes, webhook handlers, and the SPA fallthrough routes.
- `src/db.ts` is the persistence boundary. It owns schema initialization and typed CRUD access for users, organizations, sessions, provider connections, conversations, artifacts, projects, and audit data.

### Frontend

- `client/src/App.tsx` defines the SPA shell and top-level routes.
- `client/src/pages/WorkspacePage.tsx` is the chat workspace composed from `HistorySidebar` and `ChatPane`.
- `client/src/store/chatStore.ts`, `artifactStore.ts`, `intelStore.ts`, and `sessionStore.ts` coordinate client-side data loading and mutations.

### External integrations

- Jira and GitHub power both the chat tools and the structured activity pipeline.
- Google OAuth plus Drive and Workspace APIs power artifact creation.
- The LLM layer is provider-agnostic through the service and registry in `src/llm/`.

## Chat Request Flow

The chat workspace uses a tool-first loop rather than a single-shot prompt.

```mermaid
sequenceDiagram
  actor User
  participant SPA as "ChatPane"
  participant API as "POST /api/v1/chat"
  participant APP as "src/app.ts"
  participant DB as "SQLite"
  participant PIPE as "runChatTurn"
  participant LLM as "LlmService"
  participant TOOLS as "executeToolCall"
  participant Providers as "Jira and GitHub"

  User->>SPA: Submit message
  SPA->>API: message, modelId, conversationId, history
  API->>APP: requireAuth and requireOrganization
  APP->>DB: Load org settings and provider tokens
  APP->>PIPE: Start chat turn

  loop Up to 6 tool iterations
    PIPE->>LLM: system prompt, history, tool schema
    alt LLM requests tools
      LLM-->>PIPE: tool calls
      PIPE->>TOOLS: execute calls in parallel
      TOOLS->>Providers: fetch live data
      Providers-->>TOOLS: results
      TOOLS-->>PIPE: tool outputs and source metadata
    else LLM returns final answer
      LLM-->>PIPE: answer text and artifact suggestions
    end
  end

  PIPE-->>APP: answer, sources, toolsUsed, artifactSuggestions
  APP->>DB: Persist user and assistant messages
  APP-->>SPA: Chat result payload
  SPA->>SPA: Render answer, charts, and artifact actions
```

### Notes

- Tool turns are internal to the pipeline and are not persisted as first-class conversation messages.
- The LLM is given a bounded tool inventory from `src/lib/tools/definitions.ts`.
- `src/lib/tools/executor.ts` handles live fetches, caching, and partial-failure reporting.

## Structured Query Flow

The repo still contains the earlier grounded reporting pipeline, which is used by `/api/query`, demo endpoints, and the CLI.

```mermaid
flowchart TD
  A["User query"] --> B["parseQuery in src/query/parser.ts"]
  B --> C["resolveIdentity in src/query/identity.ts"]
  C --> D["buildActivitySummary in src/orchestrator/activity.ts"]
  D --> E["fetch Jira and GitHub activity in parallel"]
  E --> F["normalized ActivitySummary"]
  F --> G["generateGroundedResponse in src/lib/llm-pipeline.ts"]
  G --> H["response text with caveats"]
```

This flow is more structured than the chat pipeline. It decides the intent first, then retrieves only the data needed for that fixed intent.

## Artifact Lifecycle

Artifacts are intentionally asynchronous so the UI can show progress immediately.

```mermaid
flowchart TD
  A["Artifact suggestion or quick action"] --> B["artifactStore.createArtifact"]
  B --> C["POST /api/v1/artifacts"]
  C --> D["ArtifactService.createArtifact"]
  D --> E["Insert SQLite artifact row with status creating"]
  E --> F["Return metadata immediately"]
  F --> G["UI shows creation shell or artifact card"]

  D --> H["processArtifact runs async"]
  H --> I["Load Google OAuth token from SQLite"]
  I --> J{"Artifact kind"}

  J --> K["Create and populate Google Doc"]
  J --> L["Create and populate Google Sheet"]
  J --> M["Create and populate Google Slides"]
  J --> N["Render chart inline or back it with a Sheet"]
  J --> O["Export source artifact to xlsx, pptx, or pdf"]

  K --> P["Update artifact row to ready"]
  L --> P
  M --> P
  N --> P
  O --> P

  P --> Q["Client polls artifact status"]
  Q --> R["UI upgrades to ready artifact card"]
```

### Notes

- `src/lib/artifacts/service.ts` is the single orchestration entry point.
- Google Docs, Sheets, and Slides are created via Drive first, then populated by the corresponding API.
- Chart artifacts can stay client-rendered or optionally create a backing Sheet.

## Persistence Domains

The SQLite layer in `src/db.ts` carries several concerns in one file, but the data naturally falls into a few domains:

- `identity and tenancy`: users, organizations, memberships, invitations
- `auth and provider access`: sessions, OAuth connections, encrypted model keys
- `workspace data`: conversations, messages, projects, artifacts
- `ops and audit`: audit events, query runs, background jobs, connector health

That split is useful when navigating the code: UI features usually map cleanly to one of those domains even though the implementation lives behind one database module.

## Where To Start In The Codebase

If you are new to the repo, this order gives the fastest orientation:

1. Read `src/server.ts` to understand process startup.
2. Read `src/app.ts` to see every mounted route and service boundary.
3. Read `client/src/App.tsx` and `client/src/pages/WorkspacePage.tsx` for the SPA shell.
4. Follow `src/lib/chat-pipeline.ts` for the main AI path.
5. Follow `src/lib/artifacts/service.ts` for the artifact path.
6. Read `src/db.ts` last, as the persistence reference rather than the starting point.
