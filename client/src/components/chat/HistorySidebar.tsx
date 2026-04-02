import { useEffect, useState, useCallback, useRef } from "react";
import { useChatStore } from "@/store/chatStore";
import { ConversationItem } from "./ConversationItem";
import { SectionGroup } from "./SectionGroup";
import type { ConversationEntry } from "@/api/types";
import {
  GUEST_PREVIEW_ACTIVE_ID,
  GUEST_PREVIEW_CONVERSATIONS,
  GUEST_PREVIEW_PROJECTS,
} from "./guestPreviewData";

function groupByTime(conversations: ConversationEntry[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = todayStart - 6 * 86400000;

  const today: ConversationEntry[] = [];
  const thisWeek: ConversationEntry[] = [];
  const earlier: ConversationEntry[] = [];

  for (const c of conversations) {
    if (c.pinned || c.projectId) continue;
    const t = new Date(c.updatedAt).getTime();
    if (t >= todayStart) today.push(c);
    else if (t >= weekStart) thisWeek.push(c);
    else earlier.push(c);
  }

  return { today, thisWeek, earlier };
}

interface Props {
  onNewChat: () => void;
  guestMode?: boolean;
  onRequireAuth?: () => void;
}

export function HistorySidebar({ onNewChat, guestMode = false, onRequireAuth }: Props) {
  const {
    conversations,
    projects,
    activeConversationId,
    sidebarOpen,
    searchQuery,
    loading,
    loadConversations,
    loadProjects,
    setActiveConversation,
    updateConversation,
    deleteConversation,
    setSearchQuery,
    toggleSidebar,
  } = useChatStore();

  const [searchResults, setSearchResults] = useState<ConversationEntry[] | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchConversations = useChatStore((s) => s.searchConversations);

  useEffect(() => {
    if (guestMode) {
      return;
    }
    void loadConversations();
    void loadProjects();
  }, [guestMode, loadConversations, loadProjects]);

  const handleLockedInteraction = useCallback(() => {
    onRequireAuth?.();
  }, [onRequireAuth]);

  const handleSearch = useCallback(
    (q: string) => {
      if (guestMode) {
        handleLockedInteraction();
        return;
      }

      setSearchQuery(q);
      clearTimeout(searchTimeout.current);
      if (!q.trim()) {
        setSearchResults(null);
        return;
      }
      searchTimeout.current = setTimeout(async () => {
        const results = await searchConversations(q);
        setSearchResults(results);
      }, 250);
    },
    [guestMode, handleLockedInteraction, searchConversations, setSearchQuery],
  );

  if (!sidebarOpen) {
    return (
      <button
        className="sidebar-expand-btn"
        onClick={guestMode ? handleLockedInteraction : toggleSidebar}
        title="Open sidebar"
        aria-label="Open chat history sidebar"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    );
  }

  const visibleConversations = guestMode ? GUEST_PREVIEW_CONVERSATIONS : conversations;
  const visibleProjects = guestMode ? GUEST_PREVIEW_PROJECTS : projects;
  const resolvedActiveConversationId = guestMode ? GUEST_PREVIEW_ACTIVE_ID : activeConversationId;

  const pinned = visibleConversations.filter((c) => c.pinned && !c.archivedAt);
  const projectMap = new Map<string, ConversationEntry[]>();
  for (const c of visibleConversations) {
    if (c.projectId && !c.pinned && !c.archivedAt) {
      const list = projectMap.get(c.projectId) ?? [];
      list.push(c);
      projectMap.set(c.projectId, list);
    }
  }
  const { today, thisWeek, earlier } = groupByTime(visibleConversations.filter((c) => !c.archivedAt));
  const archivedCount = guestMode ? 3 : conversations.filter((c) => c.archivedAt).length;

  const displayConversations = guestMode ? null : searchResults;
  const lockedLabel = guestMode ? "Sign in to open" : undefined;

  const renderConversation = (
    conversation: ConversationEntry,
    callbacks: {
      onPin: () => void;
      onArchive: () => void;
      onDelete: () => void;
      onRename: (title: string) => void;
    }
  ) => (
    <ConversationItem
      key={conversation.id}
      conversation={conversation}
      active={conversation.id === resolvedActiveConversationId}
      onSelect={() => setActiveConversation(conversation.id)}
      onPin={callbacks.onPin}
      onArchive={callbacks.onArchive}
      onDelete={callbacks.onDelete}
      onRename={callbacks.onRename}
      locked={guestMode}
      onLockedClick={handleLockedInteraction}
      lockedLabel={lockedLabel}
    />
  );

  return (
    <aside className="history-sidebar" role="navigation" aria-label="Chat history">
      <div className="sidebar-action-bar">
        <button className="btn-primary sidebar-new-chat" onClick={guestMode ? handleLockedInteraction : onNewChat}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Chat
        </button>
        <button
          className="btn-ghost"
          onClick={guestMode ? handleLockedInteraction : toggleSidebar}
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
      </div>

      {guestMode && (
        <div className="sidebar-guest-banner">
          Sample workspace preview. Sign in to open threads, search history, and save chats.
        </div>
      )}

      <div
        className={`sidebar-search${guestMode ? " is-locked" : ""}`}
        onClick={guestMode ? handleLockedInteraction : undefined}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search conversations..."
          value={guestMode ? "" : searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={guestMode ? handleLockedInteraction : undefined}
          className="sidebar-search-input"
          aria-label="Search conversations"
          readOnly={guestMode}
        />
        {searchQuery && !guestMode && (
          <button
            className="sidebar-search-clear"
            onClick={() => handleSearch("")}
            aria-label="Clear search"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      <div className="sidebar-list" role="list">
        {loading && !guestMode && conversations.length === 0 ? (
          <div className="sidebar-skeleton">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton-item" />
            ))}
          </div>
        ) : displayConversations ? (
          displayConversations.length === 0 ? (
            <div className="sidebar-empty-search">
              <p>No conversations matching "{searchQuery}"</p>
              <p className="muted">Try a different search term</p>
            </div>
          ) : (
            displayConversations.map((conversation) =>
              renderConversation(conversation, {
                onPin: () => void updateConversation(conversation.id, { pinned: !conversation.pinned }),
                onArchive: () => void updateConversation(conversation.id, { archived: true }),
                onDelete: () => void deleteConversation(conversation.id),
                onRename: (title) => void updateConversation(conversation.id, { title }),
              })
            )
          )
        ) : (
          <>
            {pinned.length > 0 && (
              <SectionGroup
                label="Pinned"
                count={pinned.length}
                defaultOpen
                locked={guestMode}
                onLockedClick={handleLockedInteraction}
              >
                {pinned.map((conversation) =>
                  renderConversation(conversation, {
                    onPin: () => void updateConversation(conversation.id, { pinned: false }),
                    onArchive: () => void updateConversation(conversation.id, { archived: true }),
                    onDelete: () => void deleteConversation(conversation.id),
                    onRename: (title) => void updateConversation(conversation.id, { title }),
                  })
                )}
              </SectionGroup>
            )}

            {visibleProjects.length > 0 && (
              <SectionGroup
                label="Projects"
                count={visibleProjects.length}
                locked={guestMode}
                onLockedClick={handleLockedInteraction}
              >
                {visibleProjects.map((project) => (
                  <SectionGroup
                    key={project.id}
                    label={project.name}
                    icon="folder"
                    nested
                    locked={guestMode}
                    onLockedClick={handleLockedInteraction}
                  >
                    {(projectMap.get(project.id) ?? []).map((conversation) =>
                      renderConversation(conversation, {
                        onPin: () => void updateConversation(conversation.id, { pinned: !conversation.pinned }),
                        onArchive: () => void updateConversation(conversation.id, { archived: true }),
                        onDelete: () => void deleteConversation(conversation.id),
                        onRename: (title) => void updateConversation(conversation.id, { title }),
                      })
                    )}
                  </SectionGroup>
                ))}
              </SectionGroup>
            )}

            {today.length > 0 && (
              <SectionGroup
                label="Today"
                defaultOpen
                locked={guestMode}
                onLockedClick={handleLockedInteraction}
              >
                {today.map((conversation) =>
                  renderConversation(conversation, {
                    onPin: () => void updateConversation(conversation.id, { pinned: true }),
                    onArchive: () => void updateConversation(conversation.id, { archived: true }),
                    onDelete: () => void deleteConversation(conversation.id),
                    onRename: (title) => void updateConversation(conversation.id, { title }),
                  })
                )}
              </SectionGroup>
            )}

            {thisWeek.length > 0 && (
              <SectionGroup
                label="This Week"
                defaultOpen
                locked={guestMode}
                onLockedClick={handleLockedInteraction}
              >
                {thisWeek.map((conversation) =>
                  renderConversation(conversation, {
                    onPin: () => void updateConversation(conversation.id, { pinned: true }),
                    onArchive: () => void updateConversation(conversation.id, { archived: true }),
                    onDelete: () => void deleteConversation(conversation.id),
                    onRename: (title) => void updateConversation(conversation.id, { title }),
                  })
                )}
              </SectionGroup>
            )}

            {earlier.length > 0 && (
              <SectionGroup
                label="Earlier"
                locked={guestMode}
                onLockedClick={handleLockedInteraction}
              >
                {earlier.map((conversation) =>
                  renderConversation(conversation, {
                    onPin: () => void updateConversation(conversation.id, { pinned: true }),
                    onArchive: () => void updateConversation(conversation.id, { archived: true }),
                    onDelete: () => void deleteConversation(conversation.id),
                    onRename: (title) => void updateConversation(conversation.id, { title }),
                  })
                )}
              </SectionGroup>
            )}

            {visibleConversations.length === 0 && !loading && (
              <div className="sidebar-empty">
                <div className="sidebar-empty-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </div>
                <p>No conversations yet</p>
                <p className="muted">Start a chat to ask about your team's activity</p>
              </div>
            )}

            {archivedCount > 0 && (
              <div className="sidebar-archived-link" onClick={guestMode ? handleLockedInteraction : undefined}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                </svg>
                Archived ({archivedCount})
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
