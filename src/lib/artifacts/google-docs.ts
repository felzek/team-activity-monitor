/**
 * Google Docs API v1 wrapper.
 *
 * Populates an existing Google Doc (created via the Drive API) with structured
 * content using the batchUpdate endpoint.
 */

import type { Logger } from "pino";

import type { DocSpec, DocSection } from "./types.js";
import { googleApi } from "./google-drive.js";

// ---------------------------------------------------------------------------
// Docs API types (internal)
// ---------------------------------------------------------------------------

/** A single Docs batchUpdate request object. */
interface DocsRequest {
  insertText?: {
    location: { index: number };
    text: string;
  };
  updateParagraphStyle?: {
    range: { startIndex: number; endIndex: number };
    paragraphStyle: { namedStyleType: string };
    fields: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a heading level (1–3) to a Google Docs named style type.
 */
function headingStyle(level: 1 | 2 | 3): string {
  switch (level) {
    case 1:
      return "HEADING_1";
    case 2:
      return "HEADING_2";
    case 3:
      return "HEADING_3";
  }
}

/**
 * Build the batchUpdate requests array from a DocSpec.
 *
 * We insert text sequentially starting at index 1 (the beginning of the
 * document body), tracking the running insert position so every insertion
 * lands in the correct place.
 */
function buildRequests(spec: DocSpec): DocsRequest[] {
  const requests: DocsRequest[] = [];
  let cursor = 1; // Docs body starts at index 1

  if (spec.sections && spec.sections.length > 0) {
    for (const section of spec.sections) {
      // --- Heading ---
      const headingText = section.heading + "\n";
      requests.push({
        insertText: {
          location: { index: cursor },
          text: headingText,
        },
      });

      const headingStart = cursor;
      const headingEnd = cursor + headingText.length;

      requests.push({
        updateParagraphStyle: {
          range: { startIndex: headingStart, endIndex: headingEnd },
          paragraphStyle: { namedStyleType: headingStyle(section.level) },
          fields: "namedStyleType",
        },
      });

      cursor = headingEnd;

      // --- Body ---
      if (section.body) {
        const bodyText = section.body + "\n";
        requests.push({
          insertText: {
            location: { index: cursor },
            text: bodyText,
          },
        });
        cursor += bodyText.length;
      }
    }
  } else if (spec.content) {
    // Plain-text insertion when there are no sections.
    const text = spec.content.endsWith("\n") ? spec.content : spec.content + "\n";
    requests.push({
      insertText: {
        location: { index: cursor },
        text,
      },
    });
  }

  return requests;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Populate a Google Doc with content.
 *
 * The document must already exist (created via Drive API with the
 * `application/vnd.google-apps.document` MIME type).
 */
export async function populateGoogleDoc(
  accessToken: string,
  documentId: string,
  spec: DocSpec,
  logger: Logger
): Promise<void> {
  const requests = buildRequests(spec);

  if (requests.length === 0) {
    logger.info({ documentId }, "No content to insert into Google Doc");
    return;
  }

  logger.info(
    { documentId, requestCount: requests.length },
    "Populating Google Doc via batchUpdate"
  );

  await googleApi<Record<string, unknown>>(
    accessToken,
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({ requests }),
    },
    logger
  );

  logger.info({ documentId }, "Google Doc populated");
}
