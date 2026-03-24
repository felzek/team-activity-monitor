import { DateTime } from "luxon";

import type { QueryIntent, ResolvedTimeframe, TimeframeKind } from "../types/activity.js";

function formatDateLabel(dateTime: DateTime): string {
  return dateTime.toFormat("LLL d");
}

function buildTrailingDaysTimeframe(
  days: number,
  timezone: string,
  now: DateTime
): ResolvedTimeframe {
  const start = now.minus({ days }).startOf("day");
  return {
    kind: "trailing_days",
    label: days === 14 ? "the last 14 days" : `the last ${days} days`,
    start: start.toUTC().toISO()!,
    end: now.toUTC().toISO()!,
    timezone
  };
}

function buildExplicitRange(
  label: string,
  timezone: string,
  start: DateTime,
  end: DateTime
): ResolvedTimeframe {
  return {
    kind: "explicit_range",
    label,
    start: start.toUTC().toISO()!,
    end: end.toUTC().toISO()!,
    timezone
  };
}

export function resolveTimeframeFromQuery(
  rawQuery: string,
  timezone: string,
  intent: QueryIntent,
  now = DateTime.now().setZone(timezone)
): ResolvedTimeframe {
  const lower = rawQuery.toLowerCase();

  const explicitRangeMatch = lower.match(
    /(\d{4}-\d{2}-\d{2})\s+(?:to|through|-)\s+(\d{4}-\d{2}-\d{2})/
  );

  if (explicitRangeMatch) {
    const start = DateTime.fromISO(explicitRangeMatch[1], {
      zone: timezone
    }).startOf("day");
    const end = DateTime.fromISO(explicitRangeMatch[2], {
      zone: timezone
    }).endOf("day");

    return buildExplicitRange(
      `${formatDateLabel(start)} to ${formatDateLabel(end)}`,
      timezone,
      start,
      end
    );
  }

  if (lower.includes("today")) {
    return buildExplicitRange("today", timezone, now.startOf("day"), now);
  }

  if (lower.includes("yesterday")) {
    const yesterday = now.minus({ days: 1 });
    return buildExplicitRange(
      "yesterday",
      timezone,
      yesterday.startOf("day"),
      yesterday.endOf("day")
    );
  }

  if (lower.includes("this week")) {
    return {
      kind: "calendar_week",
      label: "this week",
      start: now.startOf("week").toUTC().toISO()!,
      end: now.toUTC().toISO()!,
      timezone
    };
  }

  if (
    lower.includes("recent activity") ||
    lower.includes("recently") ||
    (lower.includes("recent") && !lower.includes("pull request"))
  ) {
    return buildTrailingDaysTimeframe(7, timezone, now);
  }

  if (intent === "jira_only" && lower.includes("current issues")) {
    return buildTrailingDaysTimeframe(14, timezone, now);
  }

  return buildTrailingDaysTimeframe(14, timezone, now);
}

export function isWithinTimeframe(
  isoTimestamp: string,
  timeframe: ResolvedTimeframe
): boolean {
  const candidate = DateTime.fromISO(isoTimestamp);
  const start = DateTime.fromISO(timeframe.start);
  const end = DateTime.fromISO(timeframe.end);
  return candidate >= start && candidate <= end;
}

export function detectTimeframeKind(query: string): TimeframeKind {
  const lower = query.toLowerCase();

  if (lower.includes("this week")) {
    return "calendar_week";
  }

  if (
    lower.includes("today") ||
    lower.includes("yesterday") ||
    /\d{4}-\d{2}-\d{2}\s+(?:to|through|-)\s+\d{4}-\d{2}-\d{2}/.test(lower)
  ) {
    return "explicit_range";
  }

  return "trailing_days";
}
