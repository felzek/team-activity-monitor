/**
 * Artifact orchestration service.
 *
 * Validates artifact specs, creates native Google files via the appropriate
 * API, handles retries/errors, and returns normalized metadata. This is the
 * single entry point for all artifact creation.
 *
 * Flow per artifact:
 *   1. Insert DB row with status="creating"
 *   2. Get user's Google OAuth token
 *   3. Create empty Google file via Drive API
 *   4. Populate content via Docs/Sheets/Slides API
 *   5. Update DB row to status="ready" with Drive metadata
 *   6. On error → update DB row to status="failed"
 */

import type { Logger } from "pino";

import type { AppConfig } from "../../config.js";
import type { AppDatabase } from "../../db.js";
import { AppError } from "../errors.js";
import { driveCreateFile, driveExportFile, driveShareFile, driveUploadFile } from "./google-drive.js";
import { populateGoogleDoc } from "./google-docs.js";
import { populateGoogleSheet } from "./google-sheets.js";
import { populateGoogleSlides } from "./google-slides.js";
import type {
  ArtifactKind,
  ArtifactMetadata,
  ArtifactRecord,
  ArtifactSpec,
  ChartSpec,
  CreateArtifactRequest,
  DocSpec,
  ExportSpec,
  ShareArtifactRequest,
  SheetSpec,
  SlidesSpec
} from "./types.js";
import { GOOGLE_MIME, mimeForExport, mimeForKind } from "./types.js";

export class ArtifactService {
  constructor(
    private readonly database: AppDatabase,
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  /** Create an artifact. Returns immediately with status="creating", then processes async. */
  async createArtifact(
    userId: string,
    organizationId: string,
    request: CreateArtifactRequest
  ): Promise<ArtifactMetadata> {
    this.validateSpec(request.kind, request.spec);

    // Insert the artifact row in "creating" state
    const artifact = this.database.createArtifact({
      organizationId,
      userId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      kind: request.kind,
      title: request.title,
      spec: request.spec,
      driveFolderId: request.driveFolderId,
      sourceArtifactId: request.spec.type === "export" ? (request.spec as ExportSpec).sourceArtifactId : undefined
    });

    // Process async — don't await, return creating state immediately
    this.processArtifact(artifact, userId).catch((err) => {
      this.logger.error({ artifactId: artifact.id, err }, "Artifact processing failed unexpectedly");
    });

    return this.toMetadata(artifact);
  }

  /** Process the artifact creation end-to-end. */
  private async processArtifact(artifact: ArtifactRecord, userId: string): Promise<void> {
    try {
      const tokenData = this.database.getUserProviderToken(userId, "google");
      if (!tokenData) {
        throw new AppError("Google account not connected. Please connect Google in Settings.", {
          code: "GOOGLE_NOT_CONNECTED",
          statusCode: 400
        });
      }

      const accessToken = tokenData.accessToken;

      switch (artifact.kind) {
        case "google_doc":
          await this.createGoogleDoc(artifact, accessToken);
          break;
        case "google_sheet":
          await this.createGoogleSheet(artifact, accessToken);
          break;
        case "google_slides":
          await this.createGoogleSlides(artifact, accessToken);
          break;
        case "chart":
          await this.createChart(artifact, accessToken);
          break;
        case "xlsx_export":
        case "pptx_export":
        case "pdf_export":
          await this.createExport(artifact, accessToken);
          break;
        default:
          throw new AppError(`Unsupported artifact kind: ${artifact.kind}`, {
            code: "ARTIFACT_KIND_UNSUPPORTED",
            statusCode: 400
          });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ artifactId: artifact.id, err: message }, "Artifact creation failed");
      this.database.updateArtifactStatus(artifact.id, "failed", {
        errorMessage: message
      });
    }
  }

  private async createGoogleDoc(artifact: ArtifactRecord, accessToken: string): Promise<void> {
    const spec = artifact.spec as DocSpec;

    // 1. Create empty doc via Drive
    const { fileId, webViewLink } = await driveCreateFile(accessToken, {
      name: artifact.title,
      mimeType: GOOGLE_MIME.doc,
      parentFolderId: artifact.driveFolderId ?? undefined
    }, this.logger);

    // 2. Populate content via Docs API
    await populateGoogleDoc(accessToken, fileId, spec, this.logger);

    // 3. Update DB
    this.database.updateArtifactStatus(artifact.id, "ready", {
      driveFileId: fileId,
      webViewLink,
      mimeType: GOOGLE_MIME.doc
    });

    this.logger.info({ artifactId: artifact.id, fileId }, "Google Doc created");
  }

  private async createGoogleSheet(artifact: ArtifactRecord, accessToken: string): Promise<void> {
    const spec = artifact.spec as SheetSpec;

    const { fileId, webViewLink } = await driveCreateFile(accessToken, {
      name: artifact.title,
      mimeType: GOOGLE_MIME.sheet,
      parentFolderId: artifact.driveFolderId ?? undefined
    }, this.logger);

    await populateGoogleSheet(accessToken, fileId, spec, this.logger);

    this.database.updateArtifactStatus(artifact.id, "ready", {
      driveFileId: fileId,
      webViewLink,
      mimeType: GOOGLE_MIME.sheet
    });

    this.logger.info({ artifactId: artifact.id, fileId }, "Google Sheet created");
  }

  private async createGoogleSlides(artifact: ArtifactRecord, accessToken: string): Promise<void> {
    const spec = artifact.spec as SlidesSpec;

    const { fileId, webViewLink } = await driveCreateFile(accessToken, {
      name: artifact.title,
      mimeType: GOOGLE_MIME.slides,
      parentFolderId: artifact.driveFolderId ?? undefined
    }, this.logger);

    await populateGoogleSlides(accessToken, fileId, spec, this.logger);

    this.database.updateArtifactStatus(artifact.id, "ready", {
      driveFileId: fileId,
      webViewLink,
      mimeType: GOOGLE_MIME.slides
    });

    this.logger.info({ artifactId: artifact.id, fileId }, "Google Slides created");
  }

  private async createChart(artifact: ArtifactRecord, accessToken: string): Promise<void> {
    const spec = artifact.spec as ChartSpec;

    // Charts are rendered client-side. For Drive saving, we accept
    // an image upload or create a Sheet with the data.
    if (spec.includeDataSheet) {
      // Create a Sheet with the chart data
      const sheetSpec: SheetSpec = {
        type: "sheet",
        sheets: [{
          title: spec.title,
          headers: ["Label", ...spec.datasets.map((d) => d.label)],
          rows: spec.labels.map((label, i) => [
            label,
            ...spec.datasets.map((d) => d.data[i] ?? 0)
          ])
        }]
      };

      const { fileId, webViewLink } = await driveCreateFile(accessToken, {
        name: `${artifact.title} - Data`,
        mimeType: GOOGLE_MIME.sheet,
        parentFolderId: artifact.driveFolderId ?? undefined
      }, this.logger);

      await populateGoogleSheet(accessToken, fileId, sheetSpec, this.logger);

      this.database.updateArtifactStatus(artifact.id, "ready", {
        driveFileId: fileId,
        webViewLink,
        mimeType: GOOGLE_MIME.sheet
      });
    } else {
      // Mark as ready immediately — chart is rendered client-side
      this.database.updateArtifactStatus(artifact.id, "ready");
    }

    this.logger.info({ artifactId: artifact.id }, "Chart artifact processed");
  }

  private async createExport(artifact: ArtifactRecord, accessToken: string): Promise<void> {
    const spec = artifact.spec as ExportSpec;

    // Find the source artifact
    const source = this.database.getArtifactById(spec.sourceArtifactId);
    if (!source || !source.driveFileId) {
      throw new AppError("Source artifact not found or has no Drive file.", {
        code: "ARTIFACT_SOURCE_NOT_FOUND",
        statusCode: 404
      });
    }

    const exportMime = mimeForExport(spec.format);
    const buffer = await driveExportFile(accessToken, source.driveFileId, exportMime, this.logger);

    const ext = spec.format;
    const fileName = `${artifact.title}.${ext}`;

    const { fileId, webViewLink } = await driveUploadFile(accessToken, {
      name: fileName,
      mimeType: exportMime,
      parentFolderId: artifact.driveFolderId ?? undefined,
      content: buffer,
      contentType: exportMime
    }, this.logger);

    this.database.updateArtifactStatus(artifact.id, "ready", {
      driveFileId: fileId,
      webViewLink,
      mimeType: exportMime
    });

    this.logger.info({ artifactId: artifact.id, fileId, format: spec.format }, "Export created");
  }

  /** Upload a chart image to Drive. Called from the frontend after client-side rendering. */
  async uploadChartImage(
    artifactId: string,
    userId: string,
    imageBuffer: Buffer,
    contentType: string
  ): Promise<ArtifactMetadata> {
    const artifact = this.database.getArtifact(artifactId, userId);
    if (!artifact) {
      throw new AppError("Artifact not found.", { code: "ARTIFACT_NOT_FOUND", statusCode: 404 });
    }

    const tokenData = this.database.getUserProviderToken(userId, "google");
    if (!tokenData) {
      throw new AppError("Google not connected.", { code: "GOOGLE_NOT_CONNECTED", statusCode: 400 });
    }

    const ext = contentType === "image/png" ? "png" : "pdf";
    const { fileId, webViewLink } = await driveUploadFile(tokenData.accessToken, {
      name: `${artifact.title}.${ext}`,
      mimeType: contentType,
      parentFolderId: artifact.driveFolderId ?? undefined,
      content: imageBuffer,
      contentType
    }, this.logger);

    const updated = this.database.updateArtifactStatus(artifact.id, "ready", {
      driveFileId: fileId,
      webViewLink,
      mimeType: contentType
    });

    return this.toMetadata(updated!);
  }

  /** Share an artifact's Drive file. */
  async shareArtifact(
    artifactId: string,
    userId: string,
    request: ShareArtifactRequest
  ): Promise<void> {
    const artifact = this.database.getArtifact(artifactId, userId);
    if (!artifact || !artifact.driveFileId) {
      throw new AppError("Artifact not found or has no Drive file.", {
        code: "ARTIFACT_NOT_FOUND",
        statusCode: 404
      });
    }

    const tokenData = this.database.getUserProviderToken(userId, "google");
    if (!tokenData) {
      throw new AppError("Google not connected.", { code: "GOOGLE_NOT_CONNECTED", statusCode: 400 });
    }

    await driveShareFile(
      tokenData.accessToken,
      artifact.driveFileId,
      request.email,
      request.role,
      this.logger
    );

    this.logger.info({ artifactId, email: request.email, role: request.role }, "Artifact shared");
  }

  /** Get artifact status (for polling). */
  getArtifactStatus(artifactId: string, userId: string): ArtifactMetadata | null {
    const artifact = this.database.getArtifact(artifactId, userId);
    return artifact ? this.toMetadata(artifact) : null;
  }

  /** List artifacts for a conversation. */
  listConversationArtifacts(conversationId: string): ArtifactMetadata[] {
    return this.database.listConversationArtifacts(conversationId).map((a) => this.toMetadata(a));
  }

  /** Retry a failed artifact. */
  async retryArtifact(artifactId: string, userId: string): Promise<ArtifactMetadata> {
    const artifact = this.database.getArtifact(artifactId, userId);
    if (!artifact) {
      throw new AppError("Artifact not found.", { code: "ARTIFACT_NOT_FOUND", statusCode: 404 });
    }
    if (artifact.status !== "failed") {
      throw new AppError("Only failed artifacts can be retried.", { code: "ARTIFACT_NOT_FAILED", statusCode: 400 });
    }

    // Reset to creating
    const updated = this.database.updateArtifactStatus(artifactId, "creating", { errorMessage: undefined });

    // Re-process
    this.processArtifact(artifact, userId).catch((err) => {
      this.logger.error({ artifactId, err }, "Artifact retry failed");
    });

    return this.toMetadata(updated!);
  }

  /** Export an existing Google file to Office format. */
  async exportArtifact(
    artifactId: string,
    userId: string,
    organizationId: string,
    format: "xlsx" | "pptx" | "pdf" | "docx"
  ): Promise<ArtifactMetadata> {
    const source = this.database.getArtifact(artifactId, userId);
    if (!source || !source.driveFileId) {
      throw new AppError("Source artifact not found.", { code: "ARTIFACT_NOT_FOUND", statusCode: 404 });
    }

    const kindMap: Record<string, ArtifactKind> = {
      xlsx: "xlsx_export",
      pptx: "pptx_export",
      pdf: "pdf_export",
      docx: "pdf_export"
    };

    return this.createArtifact(userId, organizationId, {
      kind: kindMap[format] ?? "pdf_export",
      title: source.title,
      spec: {
        type: "export",
        sourceArtifactId: artifactId,
        format
      } satisfies ExportSpec,
      conversationId: source.conversationId ?? undefined,
      driveFolderId: source.driveFolderId ?? undefined
    });
  }

  private validateSpec(kind: ArtifactKind, spec: ArtifactSpec): void {
    switch (kind) {
      case "google_doc":
        if (spec.type !== "doc") throw new AppError("Doc artifact requires doc spec.", { code: "INVALID_SPEC", statusCode: 400 });
        break;
      case "google_sheet":
        if (spec.type !== "sheet") throw new AppError("Sheet artifact requires sheet spec.", { code: "INVALID_SPEC", statusCode: 400 });
        break;
      case "google_slides":
        if (spec.type !== "slides") throw new AppError("Slides artifact requires slides spec.", { code: "INVALID_SPEC", statusCode: 400 });
        break;
      case "chart":
        if (spec.type !== "chart") throw new AppError("Chart artifact requires chart spec.", { code: "INVALID_SPEC", statusCode: 400 });
        break;
      case "xlsx_export":
      case "pptx_export":
      case "pdf_export":
        if (spec.type !== "export") throw new AppError("Export artifact requires export spec.", { code: "INVALID_SPEC", statusCode: 400 });
        break;
    }
  }

  private toMetadata(artifact: ArtifactRecord): ArtifactMetadata {
    return {
      id: artifact.id,
      kind: artifact.kind,
      status: artifact.status,
      title: artifact.title,
      driveFileId: artifact.driveFileId,
      webViewLink: artifact.webViewLink,
      mimeType: artifact.mimeType,
      errorMessage: artifact.errorMessage,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt
    };
  }
}
