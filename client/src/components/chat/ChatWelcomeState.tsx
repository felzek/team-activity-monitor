import { useState } from "react";
import { ChatInput } from "./ChatInput";

export interface ArtifactQuickAction {
  id: string;
  label: string;
  prompt: string;
  hint: string;
  pendingTitle: string;
  pendingDescription: string;
}

export const PRIMARY_ARTIFACT_ACTIONS: ArtifactQuickAction[] = [
  {
    id: "report",
    label: "Draft report",
    prompt: "Draft a weekly status report summarizing progress, blockers, wins, and follow-ups across the team.",
    hint: "Create a concise report grounded in recent team activity.",
    pendingTitle: "Preparing report draft",
    pendingDescription: "Collecting the latest activity and shaping it into a clean written update.",
  },
  {
    id: "spreadsheet",
    label: "Build sheet",
    prompt: "Build a spreadsheet of open Jira blockers with owner, priority, last update, and linked pull requests.",
    hint: "Organize current blockers into a spreadsheet-ready table.",
    pendingTitle: "Preparing spreadsheet",
    pendingDescription: "Structuring rows, owners, and metrics into a shareable sheet.",
  },
  {
    id: "presentation",
    label: "Create slides",
    prompt: "Create a 6-slide sprint review deck with shipped work, blockers, risks, and next steps from the last 2 weeks.",
    hint: "Turn recent work into a lightweight presentation draft.",
    pendingTitle: "Preparing presentation",
    pendingDescription: "Outlining a focused deck with highlights, blockers, and next steps.",
  },
  {
    id: "chart",
    label: "Make chart",
    prompt: "Make a bar chart showing commits and pull requests by team member for this week.",
    hint: "Visualize team activity in a clean chart.",
    pendingTitle: "Preparing chart",
    pendingDescription: "Gathering activity counts so the chart can render immediately.",
  },
];

const IMAGE_ACTION: ArtifactQuickAction = {
  id: "image",
  label: "Generate image",
  prompt: "Generate a clean cover image for this week's team update using a modern dashboard-style illustration.",
  hint: "Draft a visual concept for a polished team update cover.",
  pendingTitle: "Preparing image concept",
  pendingDescription: "Shaping a prompt and visual direction for a polished generated image.",
};

const MORE_ARTIFACT_ACTIONS: ArtifactQuickAction[] = [
  {
    id: "document",
    label: "Write document",
    prompt: "Summarize this week's activity into a one-page document with key updates, blockers, and decisions.",
    hint: "Create a concise document version of the latest activity.",
    pendingTitle: "Preparing document",
    pendingDescription: "Condensing recent work into a structured one-page brief.",
  },
  {
    id: "summary",
    label: "Team summary",
    prompt: "Summarize the team's last 7 days into a short executive brief with highlights and risks.",
    hint: "Create a short leadership-style summary.",
    pendingTitle: "Preparing summary",
    pendingDescription: "Compressing recent activity into a fast executive overview.",
  },
  IMAGE_ACTION,
];

const IMAGE_PREVIEWS = [
  {
    label: "Editorial cover",
    src: "/preview/generate-image-cover.svg",
    alt: "Preview of a clean editorial-style team update cover.",
    prompt: "Generate an editorial-style cover image for this week's team update with layered dashboard panels, soft lighting, and clean negative space for a title.",
  },
  {
    label: "Dashboard scene",
    src: "/preview/generate-image-dashboard.svg",
    alt: "Preview of a dashboard-inspired illustration with charts and cards.",
    prompt: "Generate a dashboard-inspired illustration with floating charts, cards, and subtle motion for a polished weekly team activity update.",
  },
  {
    label: "Abstract summary",
    src: "/preview/generate-image-abstract.svg",
    alt: "Preview of an abstract visual for a status report cover.",
    prompt: "Generate an abstract status-report cover image with layered shapes, warm gradients, and a premium productivity aesthetic.",
  },
] as const;

const ASK_EXAMPLES = [
  "What did the team ship this week?",
  "Any blocked tickets in Jira right now?",
];

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  modelId: string;
  onModelChange: (id: string) => void;
  selectedAction: ArtifactQuickAction | null;
  onActionSelect: (action: ArtifactQuickAction) => void;
  onSuggestionSelect: (text: string) => void;
  onClearIntent: () => void;
  focusToken: number;
  helperText?: string;
  lockSecondaryActions?: boolean;
  onLockedInteraction?: () => void;
}

export function ChatWelcomeState({
  value,
  onChange,
  onSubmit,
  disabled,
  modelId,
  onModelChange,
  selectedAction,
  onActionSelect,
  onSuggestionSelect,
  onClearIntent,
  focusToken,
  helperText,
  lockSecondaryActions = false,
  onLockedInteraction,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isComposing = value.trim().length > 0;

  const handleActionSelect = (action: ArtifactQuickAction) => {
    if (lockSecondaryActions) {
      onLockedInteraction?.();
      return;
    }
    onActionSelect(action);
    setMoreOpen(false);
  };

  return (
    <div className="chat-welcome-state">
      <div className="chat-welcome-shell">
        <div className="chat-welcome-copy">
          <span className="chat-welcome-eyebrow">Workspace assistant</span>
          <h2 className="chat-welcome-title">Ask about your team's work</h2>
          <p className="chat-welcome-description">
            Ask a question or create a report, sheet, slides, chart, or image without leaving this page.
          </p>
        </div>

        <ChatInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          disabled={disabled}
          modelId={modelId}
          onModelChange={onModelChange}
          variant="hero"
          placeholder="Ask about recent work, or ask me to create a report, sheet, slides, chart, or image."
          helperText={helperText ?? "Grounded in your connected workspace data."}
          intentLabel={selectedAction ? `Creating: ${selectedAction.label}` : null}
          onClearIntent={onClearIntent}
          focusToken={focusToken}
          lockModelSelection={lockSecondaryActions}
          onLockedInteraction={onLockedInteraction}
        />

        <div className={`chat-welcome-actions${isComposing ? " is-muted" : ""}`}>
          <div className="chat-welcome-actions-header">
            <span className="chat-welcome-actions-label">Create</span>
            <span className="chat-welcome-actions-caption">Quick artifact starters</span>
          </div>

          <div className="chat-welcome-action-row">
            {PRIMARY_ARTIFACT_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                className={`chat-welcome-action${selectedAction?.id === action.id ? " is-selected" : ""}${lockSecondaryActions ? " is-locked" : ""}`}
                onClick={() => handleActionSelect(action)}
                title={action.hint}
              >
                <ActionIcon id={action.id} />
                <span>{action.label}</span>
              </button>
            ))}

            <button
              type="button"
              className={`chat-welcome-action chat-welcome-action--more${moreOpen ? " is-selected" : ""}${lockSecondaryActions ? " is-locked" : ""}`}
              onClick={() => {
                if (lockSecondaryActions) {
                  onLockedInteraction?.();
                  return;
                }
                setMoreOpen((open) => !open);
              }}
              aria-expanded={moreOpen}
            >
              <MoreIcon />
              <span>{moreOpen ? "Less" : "More"}</span>
            </button>
          </div>

          {(moreOpen || selectedAction?.id === "image") && (
            <>
              {moreOpen && (
                <div className="chat-welcome-action-row chat-welcome-action-row--secondary">
                {MORE_ARTIFACT_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={`chat-welcome-action${selectedAction?.id === action.id ? " is-selected" : ""}${lockSecondaryActions ? " is-locked" : ""}`}
                    onClick={() => handleActionSelect(action)}
                    title={action.hint}
                  >
                    <ActionIcon id={action.id} />
                    <span>{action.label}</span>
                  </button>
                ))}
                </div>
              )}

              <div className="chat-welcome-preview-strip" aria-label="Image generation previews">
                {IMAGE_PREVIEWS.map((preview) => (
                  <button
                    key={preview.label}
                    type="button"
                    className={`chat-welcome-preview-card${lockSecondaryActions ? " is-locked" : ""}`}
                    onClick={() => handleActionSelect({ ...IMAGE_ACTION, prompt: preview.prompt })}
                    title={preview.alt}
                  >
                    <img src={preview.src} alt={preview.alt} className="chat-welcome-preview-image" />
                    <span className="chat-welcome-preview-label">{preview.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionIcon({ id }: { id: string }) {
  if (id === "report" || id === "document" || id === "summary") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="14" y2="17" />
      </svg>
    );
  }

  if (id === "spreadsheet") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
        <line x1="15" y1="21" x2="15" y2="9" />
      </svg>
    );
  }

  if (id === "presentation") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <line x1="12" y1="16" x2="12" y2="21" />
        <line x1="8" y1="21" x2="16" y2="21" />
      </svg>
    );
  }

  if (id === "chart") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="4" y1="20" x2="20" y2="20" />
        <rect x="6" y="11" width="3" height="9" />
        <rect x="11" y="7" width="3" height="13" />
        <rect x="16" y="4" width="3" height="16" />
      </svg>
    );
  }

  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}
