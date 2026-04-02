// Mirror of src/routes/intelligence.ts view-model contracts
export interface FilterState {
  person: string | null;
  timeRange: "1d" | "7d" | "14d" | "30d";
  sources: ("github" | "jira")[];
}

export interface ActivityItem {
  id: string;
  source: "github" | "jira";
  type: "commit" | "pr" | "issue";
  title: string;
  subtitle: string;
  url: string | null;
  author: string;
  timestamp: string;
}

export interface BlockerItem {
  id: string;
  source: "github" | "jira";
  type: "stale_pr" | "overdue_issue";
  title: string;
  ageLabel: string;
  url: string | null;
}

export interface SourceHealthSummary {
  connected: boolean;
  lastSyncedAt: string | null;
  staleness: "fresh" | "stale" | "disconnected";
  error: string | null;
}

export interface IntelligenceOverview {
  filter: FilterState;
  summary: {
    commits: number;
    openPRs: number;
    openIssues: number;
    inProgress: number;
    activeRepos: number;
    recentlyUpdated: number;
  };
  recentActivity: ActivityItem[];
  blockers: BlockerItem[];
  sourceHealth: {
    github: SourceHealthSummary;
    jira: SourceHealthSummary;
  };
  fetchedAt: string;
}

export interface IntelligenceBoard extends IntelligenceOverview {
  github: unknown | null;
  jira: unknown | null;
}

// LLM / Chat
export interface LlmModel {
  id: string;
  provider: "gateway" | "openai" | "gemini" | "claude" | "local";
  providerModelId: string;
  displayName: string;
  supportsChat: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  status: "available" | "deprecated" | "unavailable";
  isDefaultCandidate: boolean;
  isPinned: boolean;
  sortOrder: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GuestAccess {
  isActive: boolean;
}

export interface ChatTurnRequest {
  message: string;
  modelId: string;
  conversationId?: string;
  history: ChatMessage[];
}

// ── Conversations & Projects ──

export interface ConversationEntry {
  id: string;
  organizationId: string;
  userId: string;
  projectId: string | null;
  title: string;
  pinned: boolean;
  archivedAt: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListResponse {
  conversations: ConversationEntry[];
  total: number;
  page: number;
  hasMore: boolean;
}

export interface MessageEntry {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface MessagesResponse {
  messages: MessageEntry[];
  hasMore: boolean;
}

export interface ProjectEntry {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  instructions: string | null;
  icon: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartialFailure {
  provider: string;
  message: string;
}

export interface SourceBadge {
  source: string;
  freshness: "live" | "cached";
  count?: number;
}

export interface ChatTurnResult {
  answer: string;
  toolsUsed: string[];
  tokenUsage: { input: number; output: number } | null;
  totalLatencyMs: number;
  partialFailures: PartialFailure[];
  sources?: SourceBadge[];
  stoppedEarly?: boolean;
  artifactSuggestions?: ArtifactSuggestion[];
  conversationId?: string | null;
  guestAccess?: GuestAccess | null;
}

// ── Artifacts ──

export type ArtifactKind =
  | "google_doc"
  | "google_sheet"
  | "google_slides"
  | "chart"
  | "xlsx_export"
  | "pptx_export"
  | "pdf_export";

export type ArtifactStatus = "creating" | "ready" | "failed";

export interface ArtifactSuggestion {
  kind: ArtifactKind;
  title: string;
  description: string;
  spec: Record<string, unknown>;
}

export interface ArtifactMetadata {
  id: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  title: string;
  driveFileId: string | null;
  webViewLink: string | null;
  mimeType: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateArtifactRequest {
  kind: ArtifactKind;
  title: string;
  spec: Record<string, unknown>;
  conversationId?: string;
  messageId?: string;
  driveFolderId?: string;
}

export interface GooglePickerConfig {
  clientId: string | null;
  apiKey: string | null;
  hasToken: boolean;
  scopes: string;
}
