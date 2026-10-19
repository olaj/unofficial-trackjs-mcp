import type {
  ErrorMessageGroup,
  ErrorPeriod,
  ErrorUrlGroup,
  PageMetadata,
  PageViewPeriod,
  TrackJsError,
  UsageHour,
} from "./types.js";

// Limits that keep tool output small enough not to flood an agent's context.
export const MAX_MESSAGE_CHARS = 500;
export const MAX_URL_CHARS = 300;
export const MAX_STACK_LINE_CHARS = 300;
export const MAX_METADATA_ENTRIES = 20;
export const MAX_METADATA_VALUE_CHARS = 200;
export const DEFAULT_STACK_LINES = 20;

export function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [+${text.length - max} chars]`;
}

/** Recursively drops undefined, null, empty strings and empty arrays/objects so output stays compact. */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => compact(v)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || v === null || v === "") continue;
      const c = compact(v);
      if (Array.isArray(c) && c.length === 0) continue;
      if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out as T;
  }
  return value;
}

/**
 * Trims a stack trace to its first `maxLines` non-blank lines (the frames nearest the throw site,
 * which matter most) and caps each line's length. Returns undefined when there is no stack.
 */
export function trimStack(stack: string[] | undefined, maxLines: number): string[] | undefined {
  if (!stack || stack.length === 0) return undefined;
  const lines = stack
    .flatMap((l) => String(l).split(/\r?\n/))
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return undefined;
  const kept = lines.slice(0, maxLines).map((l) => truncate(l, MAX_STACK_LINE_CHARS) as string);
  if (lines.length > maxLines) kept.push(`… ${lines.length - maxLines} more lines`);
  return kept;
}

export interface Paging {
  page?: number;
  size?: number;
  returned: number;
  hasMore?: boolean;
  nextPage?: number;
  totalCount?: number;
  startDate?: string;
  endDate?: string;
}

export function paging(meta: PageMetadata | undefined, returned: number): Paging {
  const m = meta ?? {};
  return {
    page: m.page,
    size: m.size,
    returned,
    hasMore: m.hasMore,
    nextPage: m.hasMore && typeof m.page === "number" ? m.page + 1 : undefined,
    totalCount: m.totalCount,
    startDate: m.startDate,
    endDate: m.endDate,
  };
}

function location(e: TrackJsError): string | undefined {
  if (!e.file) return undefined;
  const parts = [e.file];
  if (e.line) parts.push(String(e.line));
  if (e.line && e.column) parts.push(String(e.column));
  return truncate(parts.join(":"), MAX_URL_CHARS);
}

function metadataObject(entries: TrackJsError["metadata"]): Record<string, string> | undefined {
  if (!entries || entries.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const entry of entries.slice(0, MAX_METADATA_ENTRIES)) {
    if (!entry || entry.key === undefined) continue;
    out[String(entry.key)] = truncate(String(entry.value ?? ""), MAX_METADATA_VALUE_CHARS) ?? "";
  }
  if (entries.length > MAX_METADATA_ENTRIES) {
    out["…"] = `${entries.length - MAX_METADATA_ENTRIES} more metadata entries omitted`;
  }
  return out;
}

export interface ErrorFormatOptions {
  maxStackLines: number;
}

export function formatError(e: TrackJsError, options: ErrorFormatOptions) {
  const browser = [e.browserName, e.browserVersion].filter(Boolean).join(" ");
  return compact({
    id: e.id,
    timestamp: e.timestamp,
    message: truncate(e.message, MAX_MESSAGE_CHARS),
    status: e.status,
    pageUrl: truncate(e.url, MAX_URL_CHARS),
    location: location(e),
    entry: e.entry,
    browser: browser || undefined,
    userId: e.userId,
    sessionId: e.sessionId,
    metadata: metadataObject(e.metadata),
    stackTrace: trimStack(e.stackTrace, options.maxStackLines),
    link: e.trackJsUrl,
  });
}

export function formatErrorList(
  response: { data?: TrackJsError[]; metadata?: PageMetadata },
  options: ErrorFormatOptions,
) {
  const data = response.data ?? [];
  return compact({
    paging: paging(response.metadata, data.length),
    link: response.metadata?.trackJsUrl,
    errors: data.map((e) => formatError(e, options)),
  });
}

export function formatErrorPeriods(response: { data?: ErrorPeriod[]; metadata?: PageMetadata }) {
  const data = response.data ?? [];
  return compact({
    paging: paging(response.metadata, data.length),
    link: response.metadata?.trackJsUrl,
    totals: {
      errors: sum(data.map((d) => d.count)),
      // Users can repeat across periods, so this is an upper bound on unique users.
      userCountSum: sum(data.map((d) => d.userCount)),
    },
    periods: data.map((d) =>
      compact({ period: d.key, count: d.count, userCount: d.userCount, link: d.trackJsUrl }),
    ),
  });
}

export function formatMessageGroups(response: { data?: ErrorMessageGroup[]; metadata?: PageMetadata }) {
  const data = response.data ?? [];
  return compact({
    paging: paging(response.metadata, data.length),
    link: response.metadata?.trackJsUrl,
    messages: data.map((d) =>
      compact({
        message: truncate(d.key, MAX_MESSAGE_CHARS),
        count: d.count,
        userCount: d.userCount,
        status: d.status,
        firstSeen: d.firstSeen,
        lastSeen: d.lastSeen,
        link: d.trackJsUrl,
      }),
    ),
  });
}

export function formatUrlGroups(response: { data?: ErrorUrlGroup[]; metadata?: PageMetadata }) {
  const data = response.data ?? [];
  return compact({
    paging: paging(response.metadata, data.length),
    link: response.metadata?.trackJsUrl,
    urls: data.map((d) =>
      compact({
        url: truncate(d.key, MAX_URL_CHARS),
        count: d.count,
        userCount: d.userCount,
        link: d.trackJsUrl,
      }),
    ),
  });
}

export function formatPageViews(response: { data?: PageViewPeriod[]; metadata?: PageMetadata }) {
  const data = response.data ?? [];
  return compact({
    paging: paging(response.metadata, data.length),
    totals: { pageViews: sum(data.map((d) => d.count)) },
    periods: data.map((d) => ({ period: d.key, pageViews: d.count })),
  });
}

export type UsageGranularity = "hour" | "day";

/**
 * Usage comes back as one row per hour for the whole account. Rows are emitted as compact
 * arrays (with a `columns` header) and can optionally be rolled up to days client-side.
 */
export function formatUsage(rows: UsageHour[] | undefined, granularity: UsageGranularity) {
  const hours = Array.isArray(rows) ? rows : [];
  const buckets = granularity === "day" ? rollUpByDay(hours) : hours;
  const totals = totalsOf(hours);
  return {
    granularity,
    hoursReturned: hours.length,
    range: hours.length > 0 ? { from: hours[0]?.timestamp, to: hours[hours.length - 1]?.timestamp } : undefined,
    totals,
    columns: ["timestamp", "pageViews", "totalErrors", "processedErrors", "ignoredErrors", "droppedErrors", "errorsPerPageView"],
    rows: buckets.map((r) => [
      r.timestamp,
      r.pageViews,
      r.totalErrors,
      r.processedErrors,
      r.ignoredErrors,
      r.droppedErrors,
      round(r.errorsPerPageView),
    ]),
  };
}

function totalsOf(rows: UsageHour[]) {
  const pageViews = sum(rows.map((r) => r.pageViews));
  const totalErrors = sum(rows.map((r) => r.totalErrors));
  return {
    pageViews,
    totalErrors,
    processedErrors: sum(rows.map((r) => r.processedErrors)),
    ignoredErrors: sum(rows.map((r) => r.ignoredErrors)),
    droppedErrors: sum(rows.map((r) => r.droppedErrors)),
    errorsPerPageView: pageViews > 0 ? round(totalErrors / pageViews) : null,
  };
}

function rollUpByDay(rows: UsageHour[]): UsageHour[] {
  const byDay = new Map<string, UsageHour[]>();
  for (const row of rows) {
    const day = dayKey(row.timestamp);
    const list = byDay.get(day);
    if (list) list.push(row);
    else byDay.set(day, [row]);
  }
  return [...byDay.entries()].map(([day, list]) => {
    const t = totalsOf(list);
    return { ...t, timestamp: day, errorsPerPageView: t.errorsPerPageView ?? 0 };
  });
}

/** UTC calendar day for an ISO timestamp, falling back to the first 10 characters. */
function dayKey(timestamp: string): string {
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? String(timestamp).slice(0, 10) : new Date(ms).toISOString().slice(0, 10);
}

function sum(values: (number | undefined)[]): number {
  let total = 0;
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) total += v;
  return total;
}

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
