# World-Class AI Chat History & Settings UX Design

## Product: Team Activity Monitor — AI Chat Experience

---

# 1. Executive UX Direction

**What this product experience should be:**
A focused, work-oriented AI assistant for engineering teams — not a general-purpose chatbot. Every design decision should reinforce that this tool helps you understand what your team is doing, has done, and should be doing. The chat history isn't a personal diary; it's an operational log of questions asked and answers received about team work.

**What should feel structurally similar to the best AI assistants:**
- Left sidebar for conversation history (proven pattern across ChatGPT, Claude, Gemini — users expect it)
- Conversation-centric navigation (each chat is a first-class object with a title, timestamp, and state)
- Inline model selection near the input area
- Settings as a full page with sidebar navigation (already partially implemented)
- Projects as lightweight grouping containers, not heavyweight "workspaces" requiring setup

**What must NOT be copied:**
- ChatGPT's flat chronological grouping ("Today / Yesterday / Previous 7 days") — this doesn't scale and provides no semantic meaning for a work tool
- Claude's sparse sidebar with no search — insufficient for power users
- Gemini's drawer-style history overlay — too ephemeral for a daily-use work tool
- Any product's approach of hiding memory/context controls deep in settings — this product's value proposition depends on users trusting what the AI knows

**Design thesis:** This is a *work tool with conversational AI*, not a *chatbot with work features*. History should feel like a project notebook, not a messaging app. Settings should feel like a control panel, not a compliance form.

---

# 2. Core Information Architecture

## Overall Navigation Model

```
┌─────────────────────────────────────────────────────┐
│  GlobalNav: [Brand] [Chat] [Intelligence] [Settings]│
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ History  │           Main Content                   │
│ Sidebar  │   (Chat / Intelligence / Settings)       │
│          │                                          │
│ 260px    │           flex: 1                        │
│ collaps. │                                          │
└──────────┴──────────────────────────────────────────┘
```

**Key change from current:** The history sidebar is persistent and global to the Chat view, not a page-level concern. It replaces the SplitPane's left panel when viewing chat. Intelligence moves to a collapsible right panel or a separate top-level route (as it already is).

## Relationship Map

```
GlobalNav
├── Chat (default) ─────────── History Sidebar + Chat Area + (optional) Intel Panel
│   ├── History Sidebar
│   │   ├── New Chat button
│   │   ├── Search
│   │   ├── Pinned section
│   │   ├── Projects section (collapsed groups)
│   │   ├── Recent section (auto-grouped by recency)
│   │   └── Archived (link to filtered view)
│   └── Chat Area
│       ├── Messages
│       ├── Tool call transparency
│       └── Input + Model selector
├── Intelligence ────────────── Full-page dashboard (existing)
└── Settings ────────────────── Sidebar + Content (existing pattern, expanded)
```

## Primary Mental Model for the User

**"I have conversations. Some are quick questions, some are ongoing projects. I can find any of them, and the AI remembers what I've asked before."**

The hierarchy is: **Projects > Conversations > Messages**. A conversation can optionally belong to a project. Projects scope context. Users who never create projects just see conversations.

---

# 3. Chat History Redesign

## Purpose
The history sidebar serves as the user's **index into past work**. It answers: "What did I ask before? Where was I working on X? Can I pick up where I left off?"

## Layout

```
┌─────────────────────────┐
│ [+ New Chat]  [⌘K] [≡]  │  ← action bar: new chat, search shortcut, collapse toggle
├─────────────────────────┤
│ 🔍 Search conversations  │  ← always-visible search input
├─────────────────────────┤
│ ▸ PINNED            (3) │  ← collapsible, shows count
│   Sprint 14 standup      │
│   Q1 OKR tracking        │
│   Onboarding checklist    │
├─────────────────────────┤
│ ▸ PROJECTS          (2) │  ← collapsible, each project is a sub-group
│   📁 Backend Migration    │
│       DB schema review    │
│       API performance     │
│   📁 Release 4.2         │
│       Blocker triage      │
├─────────────────────────┤
│   TODAY                  │  ← temporal auto-groups (no user action needed)
│   • What did Alex ship.. │
│   • Jira backlog status  │
│                          │
│   THIS WEEK              │
│   • PR review summary    │
│   • Sprint velocity      │
│                          │
│   EARLIER                │
│   • January retro notes  │
│   ↓ Load more            │
├─────────────────────────┤
│ 🗄 Archived (12)         │  ← link to filtered view
└─────────────────────────┘
```

## Hierarchy (Top to Bottom)

1. **Action bar** — New Chat (primary CTA), search trigger (⌘K), sidebar collapse toggle
2. **Search** — always visible, filters in real-time as user types
3. **Pinned** — user-chosen important conversations, limited to ~10 to prevent list bloat; collapsible
4. **Projects** — grouped conversations under named containers; each project collapses independently
5. **Recent (ungrouped)** — temporal auto-groups: Today, This Week, Earlier; infinite-scroll with "Load more"
6. **Archived** — a link, not an inline list; opens a filtered view in the main content area

## Organization Model

Conversations belong to one of three states:
- **Active** — visible in Recent or inside a Project
- **Pinned** — sticky at top, can also be inside a Project
- **Archived** — hidden from default view, searchable, recoverable

A conversation can optionally belong to exactly one Project. If it does, it appears under that Project in the sidebar instead of in the temporal Recent list. This prevents duplication.

## Search Model

**Inline incremental search** in the sidebar for fast filtering:
- Filters conversation titles as the user types (client-side for recent chats, server-side for older)
- Shows matching conversations grouped the same way (Pinned / Projects / Recent)
- Highlights matching text in titles
- "Search all messages" link at bottom for full-text search across message content (opens full search view in main area)

**Full search view** (triggered by "Search all messages" or ⌘K → Enter):
- Opens in the main content area, replacing the chat
- Shows results as conversation cards with message excerpt, timestamp, project badge
- Supports filters: date range, project, has:tool-call, model:name
- Results ranked by recency by default, relevance when query is specific

## Actions Per Item

On hover / right-click / kebab menu (⋯):

| Action | Destructive? | Confirmation? |
|--------|-------------|---------------|
| Open | No | No |
| Pin / Unpin | No | No |
| Rename | No | No (inline edit) |
| Move to Project | No | No (picker flyout) |
| Archive | Soft-delete | No (with undo toast) |
| Delete permanently | Yes | Yes (modal) |

**Rename** is inline — clicking "Rename" turns the title into an editable text field. Press Enter to save, Escape to cancel.

**Archive** triggers an undo toast ("Chat archived · Undo") visible for 8 seconds. No confirmation modal because the action is reversible.

**Delete permanently** shows a modal: "This will permanently delete 'Sprint 14 standup' and all its messages. This cannot be undone." with [Cancel] and [Delete] buttons. Delete button is red, not the default focus.

## Bulk Actions

Triggered by a "Select" mode toggle in the sidebar action bar (the ≡ button becomes a selection toggle):

- Checkboxes appear next to each conversation
- Floating action bar at bottom: [Archive Selected] [Move to Project] [Delete Selected]
- "Select All Visible" checkbox at the top
- Exit selection mode with Escape or "Done" button

## Mobile Behavior

- Sidebar becomes a **full-screen overlay** triggered by a hamburger icon in the top bar
- Search is prominent at the top of the overlay
- Swipe-right on a conversation to reveal Pin / Archive actions
- Swipe-left to reveal Delete
- Tapping a conversation closes the overlay and opens the chat
- "Back to history" arrow in the chat header

## Empty / Loading / Error States

**No chats yet (first-time user):**
- Friendly illustration with "Start a conversation"
- Suggestion prompts: "What did the team ship this week?" / "Show me open PRs"
- Single CTA: [+ New Chat]

**Loading:** Skeleton lines (3-5) matching conversation item height. Subtle pulse animation. No spinner.

**Error:** "Could not load conversation history. Check your connection and try again. [Retry]" — inline in sidebar.

**Search with no results:** "No conversations matching 'foobar'. Try a different search term or search all message content →"

## Accessibility Behavior

- **Keyboard:** Arrow keys navigate between conversations. Enter opens. Delete key triggers archive (with undo). Tab moves between sidebar sections.
- **Focus management:** When conversation opened, focus moves to message list. When sidebar opens on mobile, focus trapped within.
- **Screen reader:** Sidebar has `role="navigation"` with `aria-label="Chat history"`. Each section is `role="group"`. Conversations are `role="listitem"` inside `role="list"`. Active conversation has `aria-current="page"`.
- **Reduced motion:** Skeleton animations and transitions respect `prefers-reduced-motion`.
- **Non-color cues:** Pinned items have a pin icon. Archived items have a folder icon. Private chats have a shield icon AND a label.

---

# 4. Projects / Workspace Design

## How Projects Work

A **Project** is a lightweight named container for related conversations. NOT a "workspace" — no separate login, no data silo, no configuration overhead. The existing multi-tenant "organization" is the true workspace boundary. Projects live inside an organization.

**Data model:**
```
Project {
  id: string
  name: string
  description?: string
  instructions?: string       // scoped system prompt prepended to chats in this project
  icon?: string               // emoji or preset icon
  orgId: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}
```

A conversation has an optional `projectId` foreign key.

## When Users Should Use Them

Projects are optional and frictionless. Use cases:
- Sprint tracking — group all sprint-related queries
- Incident investigation — collect conversations about a production issue
- Feature development — queries about PRs, tickets, progress for a specific feature
- Team onboarding — questions asked while ramping up

## How Chats Move In/Out

**Adding:**
1. Context menu: "Move to Project" → picker flyout with existing projects + "Create new project"
2. Drag-and-drop from Recent list onto a Project group in sidebar
3. When starting a new chat: if a project is "active" (selected in sidebar), new chats auto-join it

**Removing:**
- Context menu: "Move to General" (moves back to ungrouped Recent list)
- Drag-and-drop out of the Project group

No confirmation needed — non-destructive and reversible.

## Context Boundaries

When a chat belongs to a project with `instructions`:
- A **project badge** below the chat title: `📁 Backend Migration`
- The chat input shows: "Using project instructions from Backend Migration"
- Instructions are editable in project settings

When a chat does NOT belong to a project, no badge shown.

## Scaling

- Projects are collapsible — even with 20 projects, sidebar stays manageable
- Projects can be archived (hidden, accessible via search)
- **No nesting** — flat only. Use descriptive names for sub-grouping.
- Sidebar shows max 5 expanded projects by default

---

# 5. Temporary / Private Chat Design

## Entry Point

1. **New Chat dropdown:** "+" button has a chevron. Chevron reveals: [New Chat] and [New Private Chat].
2. **Keyboard:** ⌘N for new chat, ⌘⇧N for new private chat.

## Visual Treatment

- **Persistent top banner** in warm neutral tone (e.g., `#f5f0e8` or `#ede9fe`) with shield icon: "Private chat · Not saved to history"
- Chat input has a shield badge with "Private" label
- Sidebar shows no entry for this chat
- Background subtly shifts: `var(--surface)` from `#ffffff` to `#fafaf8`

**NOT done:** No dark mode inversion, no giant lock icon, no constant warnings.

## Status Messaging

On entering private mode, inline notice:

> **Private chat**
> This conversation will not be saved to your history. Messages won't be used to personalize future responses. Your connected data sources (Jira, GitHub) still work normally.
> [Got it]

## Exit Behavior

- Close tab / navigate away: private chat is gone. No "are you sure?" modal.
- "End private chat" button in banner: returns to last active normal chat.
- Starting a normal chat: automatically ends the private session.

## Feature Comparison

| Feature | Normal Chat | Private Chat |
|---------|-------------|--------------|
| Appears in history sidebar | Yes | No |
| Searchable later | Yes | No |
| Can be pinned/archived | Yes | No |
| Tool calls work (Jira, GitHub) | Yes | Yes |
| Uses model memory/context | Yes | No |
| Included in activity log | Yes | No |

---

# 6. Settings IA

```
Settings
├── Account             — profile, email, password, sessions
├── Appearance          — theme, density, sidebar position
├── Workspace           — org name, default model, team members, repos (existing)
├── Connectors          — Jira, GitHub connections (from existing Integrations)
├── Models & Providers  — LLM provider keys, model preferences (from existing Integrations)
├── Memory & Context    — what the AI remembers, project instructions, personalization
├── Chat History & Data — export, delete history, retention
├── Team & Access       — members, roles, invitations (existing)
├── Privacy & Security  — data processing, private mode defaults, audit
├── Activity Log        — query history, audit trail (existing)
└── Advanced            — API keys, webhooks, developer tools
```

### Account
**Controls:** Display name, email, password change, active sessions, delete account.
**Advanced-only:** Delete account.

### Appearance
**Controls:** Theme (Light / Dark / System), display density (Comfortable / Compact), sidebar default.
**All on main page** — section is small enough.

### Workspace
**Controls:** Workspace name, default LLM model, team member registry, tracked repos.
**Detail page:** Team members table, tracked repos table.

### Connectors
**Controls:** GitHub/Jira connection (OAuth, API tokens, scoping), health status, webhooks.
**Main page:** Status cards per provider with health indicator.
**Detail page:** Per-connector config, test connection, webhook setup.
**Advanced-only:** Webhook secret rotation.

### Models & Providers
**Controls:** Provider API keys, Ollama URL, model toggles, default model, model parameters.
**Main page:** Available models list with provider badges and default indicator.
**Detail page:** Per-provider key management, model parameter tuning.
**Advanced-only:** Temperature, max tokens, system prompt overrides.

### Memory & Context
**Controls:** Global memory toggle, view/delete memories, project instruction defaults, personalization.
**Main page:** Memory status (on/off), memory count, "View memories" link.
**Detail page:** Memory viewer with delete per item.

### Chat History & Data
**Controls:** Export all (JSON/Markdown), delete all, retention period, auto-archive.
**Main page:** Stats, export button, retention setting.
**Advanced-only:** Retention period, auto-archive threshold.

### Team & Access
**Controls:** Member list, roles, invitations. (Existing.)

### Privacy & Security
**Controls:** Private chat default, data processing info, audit export, security notifications.
**Advanced-only:** Audit CSV export, security notification config.

### Activity Log
**Controls:** Query history table, filters. (Existing.)
**Advanced-only:** CSV export.

### Advanced
**Controls:** API key generation, webhook endpoints, debug mode.

---

# 7. Settings Page UX

## Page Structure
Left sidebar nav (all sections listed), right content area shows active section. Existing pattern preserved and extended.

## Grouping
Within sections, controls grouped into **cards** with eyebrow labels, 24px between cards, 16px between controls within cards.

## Labels
Every control has: **Label** (bold, action-oriented), **Helper text** (one sentence, consequences not mechanics, in muted color).

## Save / Apply / Reset

**Auto-save for toggles/selects:** Immediate save with ✓ animation (1.5s fade).

**Explicit save for text fields/forms:** Sticky footer bar:
```
● Unsaved changes                [Discard] [Save]
```

## Destructive Actions — Three Tiers

**Tier 1 (Reversible):** No modal. Undo toast (8s). Example: archive project.
**Tier 2 (Significant):** Confirmation modal. Red button, non-default. Cancel is focused. Example: remove team member.
**Tier 3 (Irreversible + high impact):** Typed confirmation modal. User types workspace name or "DELETE" to confirm. Example: delete all history.

## States

- **Loading:** Skeleton cards matching layout.
- **Saving:** Spinner in Save button. On success: "Saved ✓" briefly. On error: toast + save bar remains.
- **Error loading:** Inline "Could not load settings. [Retry]".
- **Offline:** Persistent top bar "You're offline. Changes saved when reconnected." Save buttons disabled.

---

# 8. Visual / UI Direction

## Layout Density
Default: Comfortable. Conversation items 44px tall. Settings controls 16px spacing.
Optional: Compact (36px items, 12px spacing).

## Sidebar Behavior
- Width: 260px, resizable (min 200px, max 360px). Stored in localStorage.
- Collapse: 0px with 200ms ease-out. Floating expand button.
- Keyboard: ⌘B toggles.
- Mobile (<768px): Full-screen overlay from hamburger icon.

## Typography Hierarchy

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Page title | 1.25rem | 600 | var(--text) |
| Section label | 0.7rem uppercase | 600 | var(--text-muted) |
| Conversation title | 0.875rem | 500 | var(--text) |
| Conversation date | 0.75rem | 400 | var(--text-muted) |
| Setting label | 0.875rem | 500 | var(--text) |
| Helper text | 0.8125rem | 400 | var(--text-muted) |
| Badge/tag | 0.6875rem | 500 | Contextual |

## Active/Hover/Focus States

- **Active sidebar item:** `border-left: 3px solid var(--accent)` + background tint
- **Hover:** `background: var(--hover-bg)` (rgba black 4%)
- **Focus (keyboard):** `outline: 2px solid var(--accent)` with 2px offset, `:focus-visible` only

## Spacing (4px grid)

- 4px: icon-to-label
- 8px: related inline elements
- 12px: list items (compact)
- 16px: controls in group, standard padding
- 20px: card padding
- 24px: between cards/groups
- 32px: between major sections

## Motion

- Sidebar expand/collapse: 200ms ease-out
- Page transitions: None (instant)
- Skeleton pulse: 1.5s ease-in-out infinite
- Toast appear: 150ms slide-up + fade-in
- Toast dismiss: 300ms slide-down + fade-out
- All: respects `prefers-reduced-motion: reduce`

---

# 9. Component Architecture

| Component | Purpose |
|-----------|---------|
| `<HistorySidebar>` | Chat history sidebar with collapse, search, sections |
| `<ConversationItem>` | Single conversation row with title, subtitle, context menu |
| `<ConversationContextMenu>` | Popover: Pin/Rename/Move/Archive/Delete |
| `<SectionGroup>` | Collapsible labeled group with count badge |
| `<ProjectGroup>` | Extends SectionGroup with project actions |
| `<SearchInput>` | Debounced search with clear and result count |
| `<CommandPalette>` | Full-text search overlay (⌘K) |
| `<PrivateBanner>` | Top banner for private mode |
| `<SettingsNav>` | Settings sidebar nav, adapts to mobile drill-down |
| `<SettingsSection>` | Container with title, description, child cards |
| `<SettingsCard>` | Grouped card with eyebrow label |
| `<SettingsToggle>` | Toggle with label, helper text, auto-save |
| `<SettingsSelect>` | Dropdown with label and helper |
| `<SettingsTextInput>` | Text input with label, helper, validation |
| `<SecretField>` | Masked text with reveal toggle |
| `<UnsavedChangesBar>` | Sticky footer for pending saves |
| `<ConfirmationModal>` | Destructive action modal (supports typed confirmation) |
| `<UndoToast>` | Toast with undo action and countdown |
| `<StatusDot>` | Health indicator (green/yellow/red) |
| `<EmptyState>` | Illustration + message + CTA for empty views |
| `<SkeletonList>` | N skeleton rows matching item height |
| `<BulkActionBar>` | Floating bar for selection mode actions |
| `<ProjectBadge>` | Small badge showing project icon + name |
| `<MemoryViewer>` | Memory list with delete per item |

---

# 10. Implementation Phases

## Phase 1: Chat History Foundation (Priority 1)

**Goal:** Add persistent chat history with sidebar navigation.

1. **Database:** Add `conversations` and `messages` tables to SQLite.
2. **API:** Create conversation CRUD endpoints + modify chat endpoint to persist messages.
3. **Zustand store:** `chatStore` with conversations, activeConversationId, sidebar state.
4. **Components:** `<HistorySidebar>`, `<ConversationItem>`, `<SectionGroup>`, `<SearchInput>`.
5. **Refactor `WorkspacePage`:** Replace SplitPane left panel with HistorySidebar.

## Phase 2: Projects (Priority 2)

1. **Database:** Add `projects` table.
2. **API:** Project CRUD endpoints.
3. **Zustand store:** `projectStore`.
4. **Components:** `<ProjectGroup>`, `<ProjectBadge>`, project view in main area.

## Phase 3: Private Chat Mode (Priority 2)

1. **Client-side only:** `isPrivate` flag, never persisted.
2. **Components:** `<PrivateBanner>`, modified `<ChatPane>` with private prop.

## Phase 4: Settings Expansion (Priority 3)

1. **Expand nav** from 4 to 11 sections.
2. **New components:** Account, Appearance, Memory, ChatHistory, Privacy, Advanced settings.
3. **Shared components:** `<SettingsCard>`, `<SettingsToggle>`, `<UnsavedChangesBar>`, etc.
4. **Mobile:** Drill-down pattern at <768px.

## Phase 5: Search & Power Features (Priority 3)

1. `<CommandPalette>` with ⌘K.
2. Bulk actions with selection mode.
3. Drag-and-drop for project organization.

---

# 11. Database Schema

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL DEFAULT 'New chat',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  icon TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_settings (
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  source_conversation_id TEXT REFERENCES conversations(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_conversations_user ON conversations(user_id, org_id, archived_at);
CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_projects_org ON projects(org_id, archived_at);
```

---

# 12. API Contracts

```typescript
// GET /api/v1/conversations?page=1&limit=30&archived=false&projectId=X&search=query
{
  conversations: Array<{
    id: string;
    title: string;
    projectId: string | null;
    pinned: boolean;
    archivedAt: string | null;
    messageCount: number;
    lastMessagePreview: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
  page: number;
  hasMore: boolean;
}

// POST /api/v1/conversations
// Body: { title?: string; projectId?: string }

// PATCH /api/v1/conversations/:id
// Body: { title?: string; pinned?: boolean; archived?: boolean; projectId?: string | null }

// DELETE /api/v1/conversations/:id → 204

// GET /api/v1/conversations/:id/messages?limit=50&before=cursor
{ messages: Array<{ id, role, content, metadata, createdAt }>; hasMore: boolean }

// GET /api/v1/conversations/search?q=query&projectId=X&from=date&to=date
{ results: Array<{ conversationId, title, matchedMessage, excerpt, timestamp }> }

// CRUD /api/v1/projects — standard REST
// GET /api/v1/projects
// POST /api/v1/projects { name, description?, instructions?, icon? }
// PATCH /api/v1/projects/:id { ... }
// DELETE /api/v1/projects/:id

// GET /api/v1/memories
{ memories: Array<{ id, content, sourceConversationId, createdAt }> }
// DELETE /api/v1/memories/:id
// DELETE /api/v1/memories (clear all)
```

---

# 13. Route Structure

```typescript
<Routes>
  <Route path="/app" element={<WorkspacePage />} />
  <Route path="/app/chat/:conversationId" element={<WorkspacePage />} />
  <Route path="/app/project/:projectId" element={<WorkspacePage />} />
  <Route path="/app/search" element={<WorkspacePage />} />
  <Route path="/app/private" element={<WorkspacePage />} />
  <Route path="/intelligence" element={<IntelligencePage />} />
  <Route path="/settings" element={<SettingsPage />} />
  <Route path="/settings/:section" element={<SettingsPage />} />
  <Route path="*" element={<Navigate to="/app" replace />} />
</Routes>
```

## Component Tree

```
<App>
  <BrowserRouter>
    <SessionGate>
      <AppLayout>
        <GlobalNav />
        <Routes>
          <WorkspacePage>
            <HistorySidebar>
              <SidebarActionBar />
              <SearchInput />
              <SectionGroup label="Pinned" />
              <SectionGroup label="Projects">
                <ProjectGroup />...
              </SectionGroup>
              <SectionGroup label="Today" />
              ...
            </HistorySidebar>
            <ChatArea>
              <ChatHeader />
              <MessageList />
              <ChatInput />
            </ChatArea>
          </WorkspacePage>

          <SettingsPage>
            <SettingsNav />
            <SettingsContent>
              <SettingsSection>
                <SettingsCard />...
              </SettingsSection>
            </SettingsContent>
          </SettingsPage>
        </Routes>

        <CommandPalette />
        <UndoToast />
        <ConfirmationModal />
      </AppLayout>
    </SessionGate>
  </BrowserRouter>
</App>
```

## State Stores (Zustand)

```typescript
// store/chatStore.ts
interface ChatStore {
  conversations: Conversation[];
  activeConversationId: string | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  searchQuery: string;
  selectionMode: boolean;
  selectedIds: Set<string>;
  privateMode: boolean;
  privateMessages: DisplayMessage[];

  setActiveConversation: (id: string | null) => void;
  createConversation: (opts?: { projectId?: string; private?: boolean }) => void;
  updateConversation: (id: string, patch: Partial<Conversation>) => void;
  deleteConversation: (id: string) => void;
  archiveConversation: (id: string) => void;
  pinConversation: (id: string) => void;
  moveToProject: (conversationId: string, projectId: string | null) => void;
  toggleSidebar: () => void;
  setSearchQuery: (q: string) => void;
  enterPrivateMode: () => void;
  exitPrivateMode: () => void;
}

// store/projectStore.ts
interface ProjectStore {
  projects: Project[];
  createProject: (name: string, opts?) => Promise<void>;
  updateProject: (id: string, patch) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
}

// store/settingsStore.ts
interface SettingsStore {
  settings: Record<string, unknown>;
  dirty: Record<string, unknown>;
  loading: boolean;
  saving: boolean;
  loadSettings: () => Promise<void>;
  updateSetting: (key: string, value: unknown) => void;
  saveSettings: () => Promise<void>;
  discardChanges: () => void;
}
```

## Client-Side Persistence

- Sidebar width/collapse: `localStorage`
- Appearance (theme, density): `localStorage` (instant before API load)
- Search history for ⌘K: `localStorage` (last 10)
- Active conversation: URL params (`:conversationId`)
- Private mode: in-memory only (Zustand, no persistence by design)
