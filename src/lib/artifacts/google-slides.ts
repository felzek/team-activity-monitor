/**
 * Google Slides API v1 wrapper.
 *
 * Populates an existing Google Slides presentation (created via the Drive API)
 * with slides containing titles, subtitles, body text, and bullet points.
 */

import type { Logger } from "pino";

import type { SlidesSpec, SlideSpec } from "./types.js";
import { googleApi } from "./google-drive.js";

// ---------------------------------------------------------------------------
// Constants — EMU (English Metric Units): 1 inch = 914400 EMU
// ---------------------------------------------------------------------------

const EMU_PER_INCH = 914_400;

/** Standard 16:9 slide dimensions. */
const SLIDE_WIDTH = 10 * EMU_PER_INCH; // 10 inches
const SLIDE_HEIGHT = 5.625 * EMU_PER_INCH; // 5.625 inches

/** Pre-defined element positions. */
const POSITION = {
  title: {
    x: 0.5 * EMU_PER_INCH,
    y: 0.3 * EMU_PER_INCH,
    width: 9 * EMU_PER_INCH,
    height: 0.8 * EMU_PER_INCH,
  },
  body: {
    x: 0.5 * EMU_PER_INCH,
    y: 1.3 * EMU_PER_INCH,
    width: 9 * EMU_PER_INCH,
    height: 3.5 * EMU_PER_INCH,
  },
  /** Centered position for section-header slides. */
  sectionTitle: {
    x: 1 * EMU_PER_INCH,
    y: 1.5 * EMU_PER_INCH,
    width: 8 * EMU_PER_INCH,
    height: 2 * EMU_PER_INCH,
  },
} as const;

// ---------------------------------------------------------------------------
// Slides API request types (internal)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- Slides API is deeply nested */
type SlidesRequest = Record<string, any>;

interface PresentationResource {
  presentationId: string;
  slides?: Array<{ objectId: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sizeTransform(
  pageId: string,
  pos: { x: number; y: number; width: number; height: number }
) {
  return {
    pageObjectId: pageId,
    size: {
      width: { magnitude: pos.width, unit: "EMU" },
      height: { magnitude: pos.height, unit: "EMU" },
    },
    transform: {
      scaleX: 1,
      scaleY: 1,
      translateX: pos.x,
      translateY: pos.y,
      unit: "EMU",
    },
  };
}

/**
 * Build batchUpdate requests for a single slide.
 *
 * Strategy: create a BLANK slide, then insert text-box shapes manually. This
 * avoids reliance on layout placeholders that may differ between themes.
 */
function buildSlideRequests(slide: SlideSpec, index: number): SlidesRequest[] {
  const slideId = `slide_${index}`;
  const titleId = `title_${index}`;
  const bodyId = `body_${index}`;

  const requests: SlidesRequest[] = [];

  // 1. Create the blank slide.
  requests.push({
    createSlide: {
      objectId: slideId,
      insertionIndex: index,
      slideLayoutReference: { predefinedLayout: "BLANK" },
    },
  });

  // Layout-specific content insertion.
  switch (slide.layout) {
    case "title": {
      // Title shape (large, centered-ish).
      requests.push(
        ...createTextBox(titleId, slideId, POSITION.title, slide.title, {
          bold: true,
          fontSize: 36,
        })
      );

      // Subtitle below title.
      if (slide.subtitle) {
        requests.push(
          ...createTextBox(bodyId, slideId, POSITION.body, slide.subtitle, {
            bold: false,
            fontSize: 20,
          })
        );
      }
      break;
    }

    case "title_body": {
      requests.push(
        ...createTextBox(titleId, slideId, POSITION.title, slide.title, {
          bold: true,
          fontSize: 28,
        })
      );

      // Body: either explicit bullets or plain body text.
      const bodyText =
        slide.bullets && slide.bullets.length > 0
          ? slide.bullets.map((b) => `\u2022 ${b}`).join("\n")
          : slide.body ?? "";

      if (bodyText) {
        requests.push(
          ...createTextBox(bodyId, slideId, POSITION.body, bodyText, {
            bold: false,
            fontSize: 16,
          })
        );
      }
      break;
    }

    case "section": {
      requests.push(
        ...createTextBox(
          titleId,
          slideId,
          POSITION.sectionTitle,
          slide.title,
          { bold: true, fontSize: 32 }
        )
      );
      break;
    }

    case "blank": {
      // If there's a title on a "blank" slide, insert it anyway.
      if (slide.title) {
        requests.push(
          ...createTextBox(titleId, slideId, POSITION.title, slide.title, {
            bold: true,
            fontSize: 24,
          })
        );
      }
      if (slide.body) {
        requests.push(
          ...createTextBox(bodyId, slideId, POSITION.body, slide.body, {
            bold: false,
            fontSize: 16,
          })
        );
      }
      break;
    }
  }

  // Speaker notes.
  if (slide.notes) {
    requests.push({
      insertText: {
        objectId: slideId,
        text: slide.notes,
        insertionIndex: 0,
      },
    });
  }

  return requests;
}

/**
 * Return the requests needed to create a text-box shape, insert text, and
 * style it.
 */
function createTextBox(
  objectId: string,
  pageId: string,
  pos: { x: number; y: number; width: number; height: number },
  text: string,
  style: { bold: boolean; fontSize: number }
): SlidesRequest[] {
  return [
    {
      createShape: {
        objectId,
        shapeType: "TEXT_BOX",
        elementProperties: sizeTransform(pageId, pos),
      },
    },
    {
      insertText: {
        objectId,
        text,
        insertionIndex: 0,
      },
    },
    {
      updateTextStyle: {
        objectId,
        style: {
          bold: style.bold,
          fontSize: { magnitude: style.fontSize, unit: "PT" },
        },
        textRange: { type: "ALL" },
        fields: "bold,fontSize",
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Populate a Google Slides presentation.
 *
 * The presentation must already exist (created via Drive API with the
 * `application/vnd.google-apps.presentation` MIME type). A new presentation
 * includes one default blank slide which is deleted before inserting content.
 */
export async function populateGoogleSlides(
  accessToken: string,
  presentationId: string,
  spec: SlidesSpec,
  logger: Logger
): Promise<void> {
  if (spec.slides.length === 0) {
    logger.info({ presentationId }, "No slides to populate");
    return;
  }

  logger.info(
    { presentationId, slideCount: spec.slides.length },
    "Populating Google Slides presentation"
  );

  // 1. Get the existing presentation to find the default slide.
  const presentation = await googleApi<PresentationResource>(
    accessToken,
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}`,
    { method: "GET" },
    logger
  );

  // 2. Build all slide-creation requests.
  const requests: SlidesRequest[] = [];

  // Delete existing default slides first — they would otherwise remain.
  const existingSlides = presentation.slides ?? [];
  for (const existing of existingSlides) {
    requests.push({
      deleteObject: { objectId: existing.objectId },
    });
  }

  // Create each slide and its content.
  for (let i = 0; i < spec.slides.length; i++) {
    requests.push(...buildSlideRequests(spec.slides[i], i));
  }

  // 3. Send the batchUpdate.
  await googleApi<Record<string, unknown>>(
    accessToken,
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({ requests }),
    },
    logger
  );

  logger.info({ presentationId }, "Google Slides presentation populated");
}
