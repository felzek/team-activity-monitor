/**
 * Artifact types for AI-generated deliverables.
 *
 * An artifact is a file (Google Doc, Sheet, Slides, chart, or Office export)
 * created by the AI in response to a user request. Artifacts are tracked in
 * SQLite and linked to conversations/messages.
 */

export type ArtifactKind =
  | "google_doc"
  | "google_sheet"
  | "google_slides"
  | "chart"
  | "xlsx_export"
  | "pptx_export"
  | "pdf_export";

export type ArtifactStatus = "creating" | "ready" | "failed";

/** Persisted in the `artifacts` table. */
export interface ArtifactRecord {
  id: string;
  organizationId: string;
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  kind: ArtifactKind;
  status: ArtifactStatus;
  title: string;
  /** Google Drive file ID (null for local-only charts). */
  driveFileId: string | null;
  /** Direct URL to open in Google Docs/Sheets/Slides or download. */
  webViewLink: string | null;
  /** MIME type of the created file. */
  mimeType: string | null;
  /** Drive folder ID where the file was saved. */
  driveFolderId: string | null;
  /** If this is an export derived from another artifact. */
  sourceArtifactId: string | null;
  /** Structured data used to create the artifact (doc content, sheet data, etc.). */
  spec: ArtifactSpec;
  /** Error message if status is "failed". */
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the AI suggests and the frontend sends to create an artifact. */
export interface ArtifactIntent {
  kind: ArtifactKind;
  title: string;
  description: string;
  spec: ArtifactSpec;
}

/** Union of all artifact creation specs. */
export type ArtifactSpec =
  | DocSpec
  | SheetSpec
  | SlidesSpec
  | ChartSpec
  | ExportSpec;

export interface DocSpec {
  type: "doc";
  /** Markdown-ish content to insert. */
  content: string;
  /** Optional heading structure. */
  sections?: DocSection[];
}

export interface DocSection {
  heading: string;
  level: 1 | 2 | 3;
  body: string;
}

export interface SheetSpec {
  type: "sheet";
  sheets: SheetTabSpec[];
}

export interface SheetTabSpec {
  title: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
  /** Optional column widths in pixels. */
  columnWidths?: number[];
}

export interface SlidesSpec {
  type: "slides";
  slides: SlideSpec[];
}

export interface SlideSpec {
  layout: "title" | "title_body" | "section" | "blank";
  title: string;
  subtitle?: string;
  body?: string;
  /** Bullet points (for title_body layout). */
  bullets?: string[];
  /** Optional speaker notes. */
  notes?: string;
}

export interface ChartSpec {
  type: "chart";
  chartType: "bar" | "line" | "pie" | "doughnut" | "area" | "scatter";
  title: string;
  labels: string[];
  datasets: ChartDataset[];
  /** Optional: also create a Sheet with the underlying data. */
  includeDataSheet?: boolean;
}

export interface ChartDataset {
  label: string;
  data: number[];
  color?: string;
}

export interface ExportSpec {
  type: "export";
  /** The artifact ID of the Google file to export. */
  sourceArtifactId: string;
  format: "xlsx" | "pptx" | "pdf" | "docx";
}

/** API request to create an artifact. */
export interface CreateArtifactRequest {
  kind: ArtifactKind;
  title: string;
  spec: ArtifactSpec;
  conversationId?: string;
  messageId?: string;
  /** User-chosen Drive folder ID. Null = root. */
  driveFolderId?: string;
}

/** Normalized metadata returned to the frontend. */
export interface ArtifactMetadata {
  id: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  title: string;
  driveFileId: string | null;
  webViewLink: string | null;
  mimeType: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Share request. */
export interface ShareArtifactRequest {
  email: string;
  role: "reader" | "writer" | "commenter";
}

/** Google Drive MIME types. */
export const GOOGLE_MIME = {
  doc: "application/vnd.google-apps.document",
  sheet: "application/vnd.google-apps.spreadsheet",
  slides: "application/vnd.google-apps.presentation",
  folder: "application/vnd.google-apps.folder",
  // Export formats
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  png: "image/png"
} as const;

/** Map artifact kind to Google MIME type for creation. */
export function mimeForKind(kind: ArtifactKind): string | null {
  switch (kind) {
    case "google_doc": return GOOGLE_MIME.doc;
    case "google_sheet": return GOOGLE_MIME.sheet;
    case "google_slides": return GOOGLE_MIME.slides;
    default: return null;
  }
}

/** Map export format to MIME type. */
export function mimeForExport(format: "xlsx" | "pptx" | "pdf" | "docx"): string {
  return GOOGLE_MIME[format];
}
