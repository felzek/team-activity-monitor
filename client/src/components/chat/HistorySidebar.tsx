import { useEffect, useState, useCallback, useRef } from "react";
import { useChatStore } from "@/store/chatStore";
import { ConversationItem } from "./ConversationItem";
import { SectionGroup } from "./SectionGroup";
import type { ConversationEntry } from "@/api/types";

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
}

export function HistorySidebar({ onNewChat }: Props) {
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
    void loadConversations();
    void loadProjects();
  }, [loadConversations, loadProjects]);

  const handleSearch = useCallback(
    (q: string) => {
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
    [setSearchQuery, searchConversations],
  );

  if (!sidebarOpen) {
    return (
      <button
        className="sidebar-expand-btn"
        onClick={toggleSidebar}
        title="Open sidebar"
        aria-label="Open chat history sidebar"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    );
  }

  const pinned = conversations.filter((c) => c.pinned && !c.archivedAt);
  const projectMap = new Map<string, ConversationEntry[]>();
  for (const c of conversations) {
    if (c.projectId && !c.pinned && !c.archivedAt) {
      const list = projectMap.get(c.projectId) ?? [];
      list.push(c);
      projectMap.set(c.projectId, list);
    }
  }
  const { today, thisWeek, earlier } = groupByTime(conversations.filter((c) => !c.archivedAt));
  const archivedCount = conversations.filter((c) => c.archivedAt).length;

  const displayConversations = searchResults ?? undefined;

  return (
    <aside className="history-sidebar" role="navigation" aria-label="Chat history">
      {/* Action bar */}
      <div className="sidebar-action-bar">
        <button className="btn-primary sidebar-new-chat" onClick={onNewChat}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Chat
        </button>
        <button className="btn-ghost" onClick={toggleSidebar} title="Close sidebar" aria-label="Close sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="sidebar-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="sidebar-search-input"
          aria-label="Search conversations"
        />
        {searchQuery && (
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

      {/* Conversation list */}
      <div className="sidebar-list" role="list">
        {loading && conversations.length === 0 ? (
          <div className="sidebar-skeleton">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton-item" />
            ))}
          </div>
        ) : displayConversations ? (
          // Search results
          displayConversations.length === 0 ? (
            <div className="sidebar-empty-search">
              <p>No conversations matching "{searchQuery}"</p>
              <p className="muted">Try a different search term</p>
            </div>
          ) : (
            displayConversations.map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                active={c.id === activeConversationId}
                onSelect={() => { setActiveConversation(c.id); setSearchQuery(""); setSearchResults(null); }}
                onPin={() => void updateConversation(c.id, { pinned: !c.pinned })}
                onArchive={() => void updateConversation(c.id, { archived: true })}
                onDelete={() => void deleteConversation(c.id)}
                onRename={(title) => void updateConversation(c.id, { title })}
              />
            ))
          )
        ) : (
          <>
            {/* Pinned */}
            {pinned.length > 0 && (
              <SectionGroup label="Pinned" count={pinned.length} defaultOpen>
                {pinned.map((c) => (
                  <ConversationItem
                    key={c.id}
                    conversation={c}
                    active={c.id === activeConversationId}
                    onSelect={() => setActiveConversation(c.id)}
                    onPin={() => void updateConversation(c.id, { pinned: false })}
                    onArchive={() => void updateConversation(c.id, { archived: true })}
                    onDelete={() => void deleteConversation(c.id)}
                    onRename={(title) => void updateConversation(c.id, { title })}
                  />
                ))}
              </SectionGroup>
            )}

            {/* Projects */}
            {projects.length > 0 && (
              <SectionGroup label="Projects" count={projects.length}>
                {projects.map((p) => (
                  <SectionGroup key={p.id} label={p.name} icon="folder" nested>
                    {(projectMap.get(p.id) ?? []).map((c) => (
                      <ConversationItem
                        key={c.id}
                        conversation={c}
                        active={c.id === activeConversationId}
                        onSelect={() => setActiveConversation(c.id)}
                        onPin={() => void updateConversation(c.id, { pinned: !c.pinned })}
                        onArchive={() => void updateConversation(c.id, { archived: true })}
                        onDelete={() => void deleteConversation(c.id)}
                        onRename={(title) => void updateConversation(c.id, { title })}
                      />
                    ))}
                  </SectionGroup>
                ))}
              </SectionGroup>
            )}

            {/* Today */}
            {today.length > 0 && (
              <SectionGroup label="Today" defaultOpen>
                {today.map((c) => (
                  <ConversationItem
                    key={c.id}
                    conversation={c}
                    active={c.id === activeConversationId}
                    onSelect={() => setActiveConversation(c.id)}
                    onPin={() => void updateConversation(c.id, { pinned: true })}
                    onArchive={() => void updateConversation(c.id, { archived: true })}
                    onDelete={() => void deleteConversation(c.id)}
                    onRename={(title) => void updateConversation(c.id, { title })}
                  />
                ))}
              </SectionGroup>
            )}

            {/* This Week */}
            {thisWeek.length > 0 && (
              <SectionGroup label="This Week" defaultOpen>
                {thisWeek.map((c) => (
                  <ConversationItem
                    key={c.id}
                    conversation={c}
                    active={c.id === activeConversationId}
                    onSelect={() => setActiveConversation(c.id)}
                    onPin={() => void updateConversation(c.id, { pinned: true })}
                    onArchive={() => void updateConversation(c.id, { archived: true })}
                    onDelete={() => void deleteConversation(c.id)}
                    onRename={(title) => void updateConversation(c.id, { title })}
                  />
                ))}
              </SectionGroup>
            )}

            {/* Earlier */}
            {earlier.length > 0 && (
              <SectionGroup label="Earlier">
                {earlier.map((c) => (
                  <ConversationItem
                    key={c.id}
                    conversation={c}
                    active={c.id === activeConversationId}
                    onSelect={() => setActiveConversation(c.id)}
                    onPin={() => void updateConversation(c.id, { pinned: true })}
                    onArchive={() => void updateConversation(c.id, { archived: true })}
                    onDelete={() => void deleteConversation(c.id)}
                    onRename={(title) => void updateConversation(c.id, { title })}
                  />
                ))}
              </SectionGroup>
            )}

            {/* Empty state */}
            {conversations.length === 0 && !loading && (
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

            {/* Archived link */}
            {archivedCount > 0 && (
              <div className="sidebar-archived-link">
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
