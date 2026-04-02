import { ToolCallPanel } from "./ToolCallPanel";
import { ArtifactActions } from "@/components/artifacts/ArtifactActions";
import { ChartRenderer } from "@/components/artifacts/ChartRenderer";
import type { ChatMessage, ChatTurnResult, SourceBadge } from "@/api/types";

interface UserMessageProps {
  message: ChatMessage;
}

interface AssistantMessageProps {
  result: ChatTurnResult;
  guestLocked?: boolean;
  onLockedInteraction?: () => void;
}

interface ThinkingStatus {
  kind?: "artifact";
  label?: string;
  detail?: string;
}

function formatMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^#{1,3} (.+)$/gm, "<strong>$1</strong>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br/>")
    .replace(/^(.+)$/, "<p>$1</p>");
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="message user">
      <div className="message-header">
        <div className="message-avatar user">U</div>
        <span className="message-sender">You</span>
      </div>
      <div className="message-body">{message.content}</div>
    </div>
  );
}

export function AssistantMessage({
  result,
  guestLocked = false,
  onLockedInteraction,
}: AssistantMessageProps) {
  // Extract chart suggestions for inline rendering
  const chartSuggestions = result.artifactSuggestions?.filter((s) => s.kind === "chart") ?? [];

  return (
    <div className="message assistant">
      <div className="message-header">
        <div className="message-avatar assistant">AI</div>
        <span className="message-sender">Assistant</span>
      </div>
      <div
        className="message-body"
        dangerouslySetInnerHTML={{ __html: formatMarkdown(result.answer) }}
      />

      {/* Inline chart rendering */}
      {chartSuggestions.map((s, i) => {
        const spec = s.spec as { chartType?: string; title?: string; labels?: string[]; datasets?: Array<{ label: string; data: number[]; color?: string }> };
        if (!spec.chartType || !spec.labels || !spec.datasets) return null;
        return (
          <div key={`chart-${i}`} className="artifact-inline-chart">
            <ChartRenderer
              spec={{
                chartType: spec.chartType as "bar" | "line" | "pie" | "doughnut" | "area" | "scatter",
                title: spec.title ?? s.title,
                labels: spec.labels,
                datasets: spec.datasets,
              }}
            />
          </div>
        );
      })}

      {/* Artifact action buttons */}
      {result.artifactSuggestions && result.artifactSuggestions.length > 0 && (
        <ArtifactActions
          suggestions={result.artifactSuggestions}
          locked={guestLocked}
          onLockedInteraction={onLockedInteraction}
        />
      )}

      {result.toolsUsed.length > 0 && (
        <ToolCallPanel
          tools={result.toolsUsed}
          latencyMs={result.totalLatencyMs}
          locked={guestLocked}
          onLockedInteraction={onLockedInteraction}
        />
      )}
      {result.sources && result.sources.length > 0 && (
        <SourceBadges badges={result.sources} />
      )}
      {result.partialFailures.map((f, i) => (
        <div key={i} className="partial-failure">
          ⚠ {f.provider.toUpperCase()}: {f.message}
        </div>
      ))}
      {result.stoppedEarly && (
        <div className="partial-failure">
          ⚠ Answer may be incomplete — reached maximum tool call limit.
        </div>
      )}
    </div>
  );
}

function SourceBadges({ badges }: { badges: SourceBadge[] }) {
  return (
    <div className="source-badges">
      {badges.map((b, i) => (
        <span key={i} className={`source-badge ${b.source} ${b.freshness}`}>
          {b.source === "github" ? "GitHub" : b.source === "jira" ? "Jira" : b.source}
          {b.count != null && ` (${b.count})`}
        </span>
      ))}
    </div>
  );
}

export function ThinkingMessage({ status }: { status?: ThinkingStatus }) {
  if (status?.kind === "artifact") {
    return (
      <div className="message assistant">
        <div className="message-header">
          <div className="message-avatar thinking" />
          <span className="message-sender">Assistant</span>
        </div>
        <div className="message-thinking message-thinking--artifact">
          <div className="artifact-shell">
            <div className="artifact-shell-icon">
              <ArtifactShellIcon />
            </div>
            <div className="artifact-shell-copy">
              <span className="artifact-shell-title">{status.label}</span>
              {status.detail && <span className="artifact-shell-description">{status.detail}</span>}
            </div>
            <span className="artifact-shell-status">Creating</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message assistant">
      <div className="message-header">
        <div className="message-avatar thinking" />
        <span className="message-sender">Assistant</span>
      </div>
      <div className="message-thinking">
        <div className="thinking-dots">
          <span /><span /><span />
        </div>
        Thinking…
      </div>
    </div>
  );
}

function ArtifactShellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </svg>
  );
}
