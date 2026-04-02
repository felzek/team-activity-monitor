import { useRef, useEffect, type KeyboardEvent } from "react";
import { ModelSelector } from "./ModelSelector";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  modelId: string;
  onModelChange: (id: string) => void;
  variant?: "docked" | "hero";
  placeholder?: string;
  helperText?: string;
  intentLabel?: string | null;
  onClearIntent?: () => void;
  focusToken?: number;
  lockModelSelection?: boolean;
  onLockedInteraction?: () => void;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  modelId,
  onModelChange,
  variant = "docked",
  placeholder = "Ask about your team's activity… (Enter to send, Shift+Enter for newline)",
  helperText,
  intentLabel,
  onClearIntent,
  focusToken,
  lockModelSelection = false,
  onLockedInteraction,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const minHeight = variant === "hero" ? 112 : 0;
    const maxHeight = variant === "hero" ? 220 : 160;
    ta.style.height = Math.max(minHeight, Math.min(ta.scrollHeight, maxHeight)) + "px";
  }, [value, variant]);

  useEffect(() => {
    if (focusToken === undefined) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
  }, [focusToken]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  };

  return (
    <div className={`chat-input-area${variant === "hero" ? " chat-input-area--hero" : ""}`}>
      {intentLabel && (
        <div className="chat-input-intent-row">
          <span className="chat-input-intent">{intentLabel}</span>
          {onClearIntent && (
            <button type="button" className="chat-input-intent-clear" onClick={onClearIntent}>
              Clear
            </button>
          )}
        </div>
      )}

      <div className={`chat-input-shell${variant === "hero" ? " chat-input-shell--hero" : ""}`}>
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className={`chat-textarea${variant === "hero" ? " chat-textarea--hero" : ""}`}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={variant === "hero" ? 3 : 1}
            disabled={disabled}
          />
          <button
            className={`chat-send-btn${variant === "hero" ? " chat-send-btn--hero" : ""}`}
            onClick={() => onSubmit()}
            disabled={!value.trim() || disabled}
            aria-label="Send"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>

        <div className="chat-input-meta">
          <ModelSelector
            value={modelId}
            onChange={onModelChange}
            locked={lockModelSelection}
            onLockedClick={onLockedInteraction}
          />
          <span className="chat-input-hint">Shift+Enter for new line</span>
        </div>
      </div>

      {helperText && <p className="chat-input-helper">{helperText}</p>}
    </div>
  );
}
