/**
 * Google Sheets API v4 wrapper.
 *
 * Populates an existing Google Spreadsheet (created via the Drive API) with
 * tab definitions, headers, and row data.
 */

import type { Logger } from "pino";

import type { SheetSpec, SheetTabSpec } from "./types.js";
import { googleApi } from "./google-drive.js";

// ---------------------------------------------------------------------------
// Sheets API types (internal)
// ---------------------------------------------------------------------------

interface SheetsBatchUpdateRequest {
  requests: SheetsRequest[];
}

interface SheetsRequest {
  addSheet?: {
    properties: { title: string };
  };
  updateSheetProperties?: {
    properties: { sheetId: number; title: string };
    fields: string;
  };
}

interface SheetsValueRange {
  values: (string | number | boolean | null)[][];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rename the default first sheet (sheetId 0) to the desired title.
 */
async function renameDefaultSheet(
  accessToken: string,
  spreadsheetId: string,
  title: string,
  logger: Logger
): Promise<void> {
  const body: SheetsBatchUpdateRequest = {
    requests: [
      {
        updateSheetProperties: {
          properties: { sheetId: 0, title },
          fields: "title",
        },
      },
    ],
  };

  await googleApi<Record<string, unknown>>(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    { method: "POST", body: JSON.stringify(body) },
    logger
  );
}

/**
 * Add additional sheets (tabs) beyond the first one.
 */
async function addExtraTabs(
  accessToken: string,
  spreadsheetId: string,
  titles: string[],
  logger: Logger
): Promise<void> {
  if (titles.length === 0) return;

  const body: SheetsBatchUpdateRequest = {
    requests: titles.map((title) => ({
      addSheet: { properties: { title } },
    })),
  };

  logger.debug(
    { spreadsheetId, tabs: titles },
    "Adding extra sheet tabs"
  );

  await googleApi<Record<string, unknown>>(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    { method: "POST", body: JSON.stringify(body) },
    logger
  );
}

/**
 * Write header + row values into a specific sheet tab.
 */
async function writeTabValues(
  accessToken: string,
  spreadsheetId: string,
  tab: SheetTabSpec,
  logger: Logger
): Promise<void> {
  const values: (string | number | boolean | null)[][] = [
    tab.headers,
    ...tab.rows,
  ];

  // Encode tab title for the A1 range notation (single-quote escaping).
  const safeTitle = tab.title.replace(/'/g, "''");
  const range = encodeURIComponent(`'${safeTitle}'!A1`);

  logger.debug(
    { spreadsheetId, tab: tab.title, rows: values.length },
    "Writing values to sheet tab"
  );

  const body: SheetsValueRange = { values };

  await googleApi<Record<string, unknown>>(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify(body) },
    logger
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Populate a Google Sheet with data.
 *
 * The spreadsheet must already exist (created via Drive API with the
 * `application/vnd.google-apps.spreadsheet` MIME type). A new spreadsheet
 * comes with one blank sheet (sheetId 0).
 */
export async function populateGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  spec: SheetSpec,
  logger: Logger
): Promise<void> {
  const tabs = spec.sheets;

  if (tabs.length === 0) {
    logger.info({ spreadsheetId }, "No tabs to populate in Google Sheet");
    return;
  }

  logger.info(
    { spreadsheetId, tabCount: tabs.length },
    "Populating Google Sheet"
  );

  // 1. Rename the default first sheet to the first tab's title.
  await renameDefaultSheet(accessToken, spreadsheetId, tabs[0].title, logger);

  // 2. Add any additional tabs beyond the first.
  if (tabs.length > 1) {
    const extraTitles = tabs.slice(1).map((t) => t.title);
    await addExtraTabs(accessToken, spreadsheetId, extraTitles, logger);
  }

  // 3. Write values into each tab.
  for (const tab of tabs) {
    await writeTabValues(accessToken, spreadsheetId, tab, logger);
  }

  logger.info({ spreadsheetId }, "Google Sheet populated");
}
