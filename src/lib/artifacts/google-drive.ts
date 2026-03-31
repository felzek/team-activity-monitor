/**
 * Google Drive API v3 wrapper.
 *
 * Raw fetch calls — no Google SDK. Follows the same pattern as
 * `src/lib/provider-auth.ts` for OAuth-based API access.
 */

import type { Logger } from "pino";

import { AppError } from "../errors.js";

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

/**
 * Perform an authenticated Google API request and return the parsed JSON body.
 * Exported so that sibling modules (google-docs, google-sheets, google-slides)
 * can reuse the same error-handling logic.
 */
export async function googleApi<T>(
  accessToken: string,
  url: string,
  options: RequestInit,
  logger: Logger
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.warn(
      { url, status: res.status, body: body.slice(0, 500) },
      "Google API error"
    );
    throw new AppError(
      `Google API error: ${res.status} ${body.slice(0, 200)}`,
      { code: "GOOGLE_API_ERROR", statusCode: 502 }
    );
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ---------------------------------------------------------------------------
// Drive file metadata types (internal)
// ---------------------------------------------------------------------------

interface DriveFileResource {
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  iconLink?: string;
}

interface DrivePermissionResource {
  id?: string;
  type?: string;
  role?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create a file in Google Drive. Returns `{ fileId, webViewLink }`. */
export async function driveCreateFile(
  accessToken: string,
  opts: {
    name: string;
    mimeType: string;
    parentFolderId?: string;
    description?: string;
  },
  logger: Logger
): Promise<{ fileId: string; webViewLink: string }> {
  const metadata: Record<string, unknown> = {
    name: opts.name,
    mimeType: opts.mimeType,
  };

  if (opts.parentFolderId) {
    metadata.parents = [opts.parentFolderId];
  }
  if (opts.description) {
    metadata.description = opts.description;
  }

  logger.info(
    { name: opts.name, mimeType: opts.mimeType, parentFolderId: opts.parentFolderId },
    "Creating Google Drive file"
  );

  const file = await googleApi<DriveFileResource>(
    accessToken,
    "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink",
    { method: "POST", body: JSON.stringify(metadata) },
    logger
  );

  logger.info({ fileId: file.id }, "Google Drive file created");

  return { fileId: file.id, webViewLink: file.webViewLink ?? "" };
}

/** Export a Google Workspace file to a different format. Returns the binary Buffer. */
export async function driveExportFile(
  accessToken: string,
  fileId: string,
  exportMimeType: string,
  logger: Logger
): Promise<Buffer> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`;

  logger.info({ fileId, exportMimeType }, "Exporting Google Drive file");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.warn(
      { url, status: res.status, body: body.slice(0, 500) },
      "Google Drive export error"
    );
    throw new AppError(
      `Google API error: ${res.status} ${body.slice(0, 200)}`,
      { code: "GOOGLE_API_ERROR", statusCode: 502 }
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Upload binary content (like a chart image) to Drive. */
export async function driveUploadFile(
  accessToken: string,
  opts: {
    name: string;
    mimeType: string;
    parentFolderId?: string;
    content: Buffer;
    contentType: string;
  },
  logger: Logger
): Promise<{ fileId: string; webViewLink: string }> {
  const metadata: Record<string, unknown> = {
    name: opts.name,
    mimeType: opts.mimeType,
  };
  if (opts.parentFolderId) {
    metadata.parents = [opts.parentFolderId];
  }

  // Build a multipart/related request body per Google's upload protocol.
  const boundary = "artifact_upload_boundary";
  const metadataJson = JSON.stringify(metadata);

  const parts = [
    `--${boundary}\r\n`,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    metadataJson,
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${opts.contentType}\r\n`,
    "Content-Transfer-Encoding: base64\r\n\r\n",
    opts.content.toString("base64"),
    `\r\n--${boundary}--`,
  ].join("");

  logger.info(
    { name: opts.name, contentType: opts.contentType, sizeBytes: opts.content.length },
    "Uploading file to Google Drive"
  );

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: parts,
    }
  );

  if (!res.ok) {
    const body = await res.text();
    logger.warn(
      { status: res.status, body: body.slice(0, 500) },
      "Google Drive upload error"
    );
    throw new AppError(
      `Google API error: ${res.status} ${body.slice(0, 200)}`,
      { code: "GOOGLE_API_ERROR", statusCode: 502 }
    );
  }

  const file = (await res.json()) as DriveFileResource;
  logger.info({ fileId: file.id }, "Google Drive file uploaded");

  return { fileId: file.id, webViewLink: file.webViewLink ?? "" };
}

/** Share a file with an email address. */
export async function driveShareFile(
  accessToken: string,
  fileId: string,
  email: string,
  role: "reader" | "writer" | "commenter",
  logger: Logger
): Promise<void> {
  logger.info({ fileId, email, role }, "Sharing Google Drive file");

  await googleApi<DrivePermissionResource>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
    {
      method: "POST",
      body: JSON.stringify({
        type: "user",
        role,
        emailAddress: email,
      }),
    },
    logger
  );

  logger.info({ fileId, email, role }, "Google Drive file shared");
}

/** Get file metadata. */
export async function driveGetFile(
  accessToken: string,
  fileId: string,
  logger: Logger
): Promise<{
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  iconLink: string | null;
}> {
  logger.debug({ fileId }, "Getting Google Drive file metadata");

  const file = await googleApi<DriveFileResource>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,iconLink`,
    { method: "GET" },
    logger
  );

  return {
    id: file.id,
    name: file.name ?? "",
    mimeType: file.mimeType ?? "",
    webViewLink: file.webViewLink ?? "",
    iconLink: file.iconLink ?? null,
  };
}

/** List files in a folder. */
export async function driveListFiles(
  accessToken: string,
  folderId: string,
  logger: Logger
): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  logger.debug({ folderId }, "Listing Google Drive folder contents");

  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const result = await googleApi<{ files?: DriveFileResource[] }>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)`,
    { method: "GET" },
    logger
  );

  return (result.files ?? []).map((f) => ({
    id: f.id,
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
  }));
}
