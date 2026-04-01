import { useState } from "react";
import { useArtifactStore } from "@/store/artifactStore";
import type { ArtifactMetadata, ArtifactKind } from "@/api/types";

interface Props {
  artifact: ArtifactMetadata;
}

const KIND_CONFIG: Record<ArtifactKind, { icon: string; label: string; color: string }> = {
  google_doc:    { icon: "doc",    label: "Google Doc",    color: "#4285F4" },
  google_sheet:  { icon: "sheet",  label: "Google Sheet",  color: "#0F9D58" },
  google_slides: { icon: "slides", label: "Google Slides", color: "#F4B400" },
  chart:         { icon: "chart",  label: "Chart",         color: "#DB4437" },
  xlsx_export:   { icon: "xlsx",   label: "Excel",         color: "#217346" },
  pptx_export:   { icon: "pptx",   label: "PowerPoint",   color: "#D24726" },
  pdf_export:    { icon: "pdf",    label: "PDF",           color: "#E44D2E" },
};

function ArtifactIcon({ kind }: { kind: ArtifactKind }) {
  const cfg = KIND_CONFIG[kind];
  return (
    <div className="artifact-icon" style={{ backgroundColor: cfg.color }}>
      <span className="artifact-icon-label">{cfg.icon.slice(0, 3).toUpperCase()}</span>
    </div>
  );
}

export function ArtifactCard({ artifact }: Props) {
  const [showShare, setShowShare] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [copied, setCopied] = useState(false);

  const retryArtifact = useArtifactStore((s) => s.retryArtifact);
  const shareArtifact = useArtifactStore((s) => s.shareArtifact);
  const exportArtifact = useArtifactStore((s) => s.exportArtifact);

  const cfg = KIND_CONFIG[artifact.kind];

  const handleOpen = () => {
    if (artifact.webViewLink) {
      window.open(artifact.webViewLink, "_blank", "noopener");
    }
  };

  const handleCopyLink = () => {
    if (artifact.webViewLink) {
      navigator.clipboard.writeText(artifact.webViewLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (!shareEmail.trim()) return;
    await shareArtifact(artifact.id, shareEmail.trim(), "reader");
    setShareEmail("");
    setShowShare(false);
  };

  const handleExport = async (format: "xlsx" | "pptx" | "pdf" | "docx") => {
    await exportArtifact(artifact.id, format);
    setShowExport(false);
  };

  return (
    <div className={`artifact-card artifact-card--${artifact.status}`}>
      <div className="artifact-card-header">
        <ArtifactIcon kind={artifact.kind} />
        <div className="artifact-card-info">
          <span className="artifact-card-title">{artifact.title}</span>
          <span className="artifact-card-kind">{cfg.label}</span>
        </div>
        <div className="artifact-card-status">
          {artifact.status === "creating" && (
            <span className="artifact-status-badge creating">
              <span className="artifact-spinner" />
              Creating...
            </span>
          )}
          {artifact.status === "ready" && (
            <span className="artifact-status-badge ready">Ready</span>
          )}
          {artifact.status === "failed" && (
            <span className="artifact-status-badge failed">Failed</span>
          )}
        </div>
      </div>

      {artifact.status === "failed" && artifact.errorMessage && (
        <div className="artifact-card-error">
          {artifact.errorMessage}
        </div>
      )}

      <div className="artifact-card-actions">
        {artifact.status === "ready" && artifact.webViewLink && (
          <>
            <button className="artifact-action-btn primary" onClick={handleOpen}>
              <OpenIcon /> Open
            </button>
            <button className="artifact-action-btn" onClick={handleCopyLink}>
              <LinkIcon /> {copied ? "Copied!" : "Copy link"}
            </button>
            <button className="artifact-action-btn" onClick={() => setShowShare((v) => !v)}>
              <ShareIcon /> Share
            </button>
            {(artifact.kind === "google_doc" || artifact.kind === "google_sheet" || artifact.kind === "google_slides") && (
              <button className="artifact-action-btn" onClick={() => setShowExport((v) => !v)}>
                <ExportIcon /> Export
              </button>
            )}
          </>
        )}
        {artifact.status === "failed" && (
          <button className="artifact-action-btn" onClick={() => retryArtifact(artifact.id)}>
            <RetryIcon /> Retry
          </button>
        )}
      </div>

      {showShare && (
        <div className="artifact-card-share">
          <input
            type="email"
            placeholder="Email address"
            value={shareEmail}
            onChange={(e) => setShareEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleShare()}
            className="artifact-share-input"
          />
          <button className="artifact-action-btn primary" onClick={handleShare}>
            Send
          </button>
        </div>
      )}

      {showExport && (
        <div className="artifact-card-export">
          {artifact.kind === "google_doc" && (
            <button className="artifact-export-opt" onClick={() => handleExport("docx")}>
              .docx
            </button>
          )}
          {artifact.kind === "google_sheet" && (
            <button className="artifact-export-opt" onClick={() => handleExport("xlsx")}>
              .xlsx
            </button>
          )}
          {artifact.kind === "google_slides" && (
            <button className="artifact-export-opt" onClick={() => handleExport("pptx")}>
              .pptx
            </button>
          )}
          <button className="artifact-export-opt" onClick={() => handleExport("pdf")}>
            .pdf
          </button>
        </div>
      )}
    </div>
  );
}

// ── Inline SVG icons ──

function OpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
