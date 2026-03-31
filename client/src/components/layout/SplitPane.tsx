import { useRef, useState, useCallback, useEffect, type ReactNode } from "react";

interface Props {
  left: ReactNode;
  right: ReactNode;
  defaultLeftWidth?: number;
  storageKey?: string;
}

export function SplitPane({ left, right, defaultLeftWidth = 420, storageKey = "split-pane-width" }: Props) {
  const [leftWidth, setLeftWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? Number(saved) : defaultLeftWidth;
    } catch {
      return defaultLeftWidth;
    }
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const newWidth = Math.max(280, Math.min(e.clientX - rect.left, rect.width * 0.65));
    setLeftWidth(newWidth);
  }, []);

  const onMouseUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setLeftWidth((w) => {
      try { localStorage.setItem(storageKey, String(w)); } catch { /* ignore */ }
      return w;
    });
  }, [storageKey]);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  return (
    <div className="split-pane" ref={containerRef}>
      <div className="split-pane-left" style={{ width: leftWidth, flexShrink: 0 }}>
        {left}
      </div>
      <div className="split-divider" onMouseDown={onMouseDown} role="separator" aria-label="Resize panels" />
      <div className="split-pane-right">
        {right}
      </div>
    </div>
  );
}
