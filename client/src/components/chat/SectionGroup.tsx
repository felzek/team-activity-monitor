import { useState, type ReactNode } from "react";

interface Props {
  label: string;
  count?: number;
  icon?: "folder";
  defaultOpen?: boolean;
  nested?: boolean;
  children: ReactNode;
}

export function SectionGroup({ label, count, icon, defaultOpen = false, nested = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`section-group${nested ? " nested" : ""}`} role="group" aria-label={label}>
      <button
        className="section-group-header"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <svg
          className={`section-group-chevron${open ? " open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {icon === "folder" && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        )}
        <span className="section-group-label">{label}</span>
        {count !== undefined && <span className="section-group-count">{count}</span>}
      </button>
      {open && <div className="section-group-content">{children}</div>}
    </div>
  );
}
