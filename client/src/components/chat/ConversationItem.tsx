import { useState, useRef, useEffect, type SyntheticEvent } from "react";
import type { ConversationEntry } from "@/api/types";

interface Props {
  conversation: ConversationEntry;
  active: boolean;
  onSelect: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  locked?: boolean;
  onLockedClick?: () => void;
  lockedLabel?: string;
}

export function ConversationItem({
  conversation,
  active,
  onSelect,
  onPin,
  onArchive,
  onDelete,
  onRename,
  locked = false,
  onLockedClick,
  lockedLabel,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Focus input on rename
  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(trimmed);
    }
    setRenaming(false);
  };

  const subtitle = conversation.lastMessagePreview
    ? conversation.lastMessagePreview.slice(0, 60) + (conversation.lastMessagePreview.length > 60 ? "..." : "")
    : `${conversation.messageCount} messages`;

  const handleLockedClick = (event?: SyntheticEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    onLockedClick?.();
  };

  return (
    <div
      className={`conversation-item${active ? " active" : ""}${locked ? " is-locked" : ""}`}
      role="listitem"
      aria-current={active ? "page" : undefined}
      onClick={locked ? handleLockedClick : renaming ? undefined : onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        if (locked) {
          handleLockedClick(e);
          return;
        }
        setMenuOpen(true);
      }}
    >
      {conversation.pinned && (
        <svg className="conversation-pin-icon" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M16 2l-4 4-4-2-4 4 6 6-6 8h2l6-6 6 6 4-4-2-4 4-4z" />
        </svg>
      )}

      {renaming ? (
        <input
          ref={inputRef}
          className="conversation-rename-input"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameSubmit();
            if (e.key === "Escape") { setRenaming(false); setRenameValue(conversation.title); }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <span className="conversation-title">{conversation.title}</span>
          <span className="conversation-subtitle">{subtitle}</span>
          {lockedLabel && <span className="conversation-lock-badge">{lockedLabel}</span>}
        </>
      )}

      {/* Kebab menu trigger */}
      <button
        className="conversation-menu-trigger"
        onClick={(e) => {
          if (locked) {
            handleLockedClick(e);
            return;
          }
          e.stopPropagation();
          setMenuOpen(!menuOpen);
          setConfirmDelete(false);
        }}
        aria-label="Conversation actions"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {/* Context menu */}
      {menuOpen && (
        <div className="conversation-menu" ref={menuRef} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setMenuOpen(false); onPin(); }}>
            {conversation.pinned ? "Unpin" : "Pin"}
          </button>
          <button onClick={() => { setMenuOpen(false); setRenaming(true); setRenameValue(conversation.title); }}>
            Rename
          </button>
          <button onClick={() => { setMenuOpen(false); onArchive(); }}>
            Archive
          </button>
          <div className="conversation-menu-divider" />
          {confirmDelete ? (
            <button className="conversation-menu-danger" onClick={() => { setMenuOpen(false); setConfirmDelete(false); onDelete(); }}>
              Confirm delete
            </button>
          ) : (
            <button className="conversation-menu-danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
