import { useState } from "react";

interface Props {
  tools: string[];
  latencyMs?: number;
  locked?: boolean;
  onLockedInteraction?: () => void;
}

export function ToolCallPanel({ tools, latencyMs, locked = false, onLockedInteraction }: Props) {
  const [open, setOpen] = useState(false);
  const unique = [...new Set(tools)];

  const handleToggle = () => {
    if (locked) {
      onLockedInteraction?.();
      return;
    }
    setOpen((value) => !value);
  };

  return (
    <div className={`tool-calls-panel${locked ? " is-locked" : ""}`}>
      <div
        className="tool-calls-toggle"
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleToggle()}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        Used {unique.length} tool{unique.length !== 1 ? "s" : ""}
        {latencyMs != null && <span style={{ marginLeft: "auto", fontSize: "0.7rem" }}>{latencyMs}ms</span>}
        <span style={{ marginLeft: latencyMs != null ? 8 : "auto" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div className="tool-calls-body">
          {unique.map((t) => (
            <span key={t} className="tool-tag">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
