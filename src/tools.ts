import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TrackJsApiError, type QueryValue, type TrackJsClient } from "./client.js";
import {
  DEFAULT_STACK_LINES,
  formatErrorList,
  formatErrorPeriods,
  formatMessageGroups,
  formatPageViews,
  formatUrlGroups,
  formatUsage,
} from "./format.js";
import type {
  ErrorMessageGroup,
  ErrorPeriod,
  ErrorUrlGroup,
  PagedResponse,
  PageViewPeriod,
  TrackJsError,
  UsageHour,
} from "./types.js";

// ---------------------------------------------------------------------------
// Shared input schemas (parameter names match the TrackJS Data API exactly)
// ---------------------------------------------------------------------------

const isoDate = (which: "start" | "end") =>
  z
    .string()
    .trim()
    .refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "Must be an ISO 8601 date or date-time, e.g. 2026-10-01 or 2026-10-01T14:00:00Z",
    })
    .optional()
    .describe(
      which === "start"
        ? "Only include data after this ISO 8601 date/date-time (UTC), e.g. 2026-10-01 or 2026-10-01T14:00:00Z. Precision is 1 second."
        : "Only include data before this ISO 8601 date/date-time (UTC), e.g. 2026-10-08 or 2026-10-08T00:00:00Z. Precision is 1 second.",
    );

const application = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Limit results to one TrackJS application key (as configured in TrackJS). Omit for all applications.");

const page = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe("1-based page number. Defaults to 1. Use paging.nextPage from a previous result to continue.");

const size = (hint: string) =>
  z.number().int().min(1).max(1000).optional().describe(`Items per page, 1-1000. TrackJS defaults to 20. ${hint}`);

const range = { application, startDate: isoDate("start"), endDate: isoDate("end") };
const paged = (sizeHint: string) => ({ ...range, page, size: size(sizeHint) });

const sortDirection = z
  .enum(["desc", "asc"])
  .optional()
  .describe("Sort direction. Defaults to desc.");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Builds the API's `field|direction` sort string, or undefined to use the API default. */
function sortParam(
  by: string | undefined,
  direction: "asc" | "desc" | undefined,
  defaultField: string,
): string | undefined {
  if (!by && !direction) return undefined;
  return `${by ?? defaultField}|${direction ?? "desc"}`;
}

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function checkRange(startDate?: string, endDate?: string): string | undefined {
  if (startDate && endDate && Date.parse(startDate) > Date.parse(endDate)) {
    return `startDate (${startDate}) is after endDate (${endDate}).`;
  }
  return undefined;
}

async function run(
  args: { startDate?: string; endDate?: string },
  fn: () => Promise<unknown>,
): Promise<CallToolResult> {
  const rangeError = checkRange(args.startDate, args.endDate);
  if (rangeError) return fail(rangeError);
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof TrackJsApiError) return fail(err.message);
    return fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function rangeQuery(args: {
  application?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  size?: number;
}): Record<string, QueryValue> {
  return {
    application: args.application,
    startDate: args.startDate,
    endDate: args.endDate,
    page: args.page,
    size: args.size,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const TOOL_NAMES = [
  "list_errors",
  "top_messages",
  "errors_by_url",
  "errors_by_day",
  "errors_by_hour",
  "page_views_by_day",
  "page_views_by_hour",
  "usage_by_hour",
] as const;

export function registerTools(server: McpServer, client: TrackJsClient): void {
  server.registerTool(
    "list_errors",
    {
      title: "List TrackJS errors",
      description:
        "List individual JavaScript error occurrences captured by TrackJS, newest first (GET /errors). " +
        "Use `query` to search like the TrackJS dashboard search (matches error messages, URLs, metadata and user IDs). " +
        "Each error includes message, page URL, file:line:column, browser, user/session IDs, triage status, custom metadata " +
        "and a link to its TrackJS details page. Set includeStack=true to get stack traces (trimmed to maxStackLines). " +
        "For 'what is breaking most' questions, call top_messages first, then use this tool with `query` set to a message to see examples.",
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Search text, same as TrackJS dashboard search, e.g. \"Cannot read properties of undefined\" or a user ID."),
        ...paged("Keep it small (e.g. 5-20) when includeStack is true."),
        includeStack: z
          .boolean()
          .optional()
          .describe("Include each error's stack trace. Off by default because traces are large."),
        maxStackLines: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe(`When includeStack is true, keep at most this many stack lines per error (default ${DEFAULT_STACK_LINES}).`),
      },
      annotations: { title: "List TrackJS errors", ...READ_ONLY },
    },
    async (args) =>
      run(args, async () => {
        const response = await client.get<PagedResponse<TrackJsError>>("/errors", {
          ...rangeQuery(args),
          query: args.query,
          includeStack: args.includeStack ? true : undefined,
        });
        return formatErrorList(response, { maxStackLines: args.maxStackLines ?? DEFAULT_STACK_LINES });
      }),
  );

  server.registerTool(
    "top_messages",
    {
      title: "Top error messages",
      description:
        "Error counts grouped by error message, with affected-user counts, triage status, first/last seen and a TrackJS link " +
        "(GET /errors/messages). Sorted by count descending by default. Best starting point for 'what are our most common / " +
        "most impactful errors?'. Sort by usercount to rank by number of affected users.",
      inputSchema: {
        ...paged("20-50 is usually enough for a top-N overview."),
        sortBy: z.enum(["count", "usercount"]).optional().describe("Sort field: count (occurrences, default) or usercount (affected users)."),
        sortDirection,
      },
      annotations: { title: "Top error messages", ...READ_ONLY },
    },
    async (args) =>
      run(args, async () => {
        const response = await client.get<PagedResponse<ErrorMessageGroup>>("/errors/messages", {
          ...rangeQuery(args),
          sort: sortParam(args.sortBy, args.sortDirection, "count"),
        });
        return formatMessageGroups(response);
      }),
  );

  server.registerTool(
    "errors_by_url",
    {
      title: "Errors by page URL",
      description:
        "Error counts grouped by the page URL where errors happened, with affected-user counts and a TrackJS link " +
        "(GET /errors/urls). Sorted by count descending by default. Use to find which pages are most broken.",
      inputSchema: {
        ...paged("20-50 is usually enough."),
        sortBy: z.enum(["count", "usercount"]).optional().describe("Sort field: count (occurrences, default) or usercount (affected users)."),
        sortDirection,
      },
      annotations: { title: "Errors by page URL", ...READ_ONLY },
    },
    async (args) =>
      run(args, async () => {
        const response = await client.get<PagedResponse<ErrorUrlGroup>>("/errors/urls", {
          ...rangeQuery(args),
          sort: sortParam(args.sortBy, args.sortDirection, "count"),
        });
        return formatUrlGroups(response);
      }),
  );

  const periodSortBy = z
    .enum(["date", "count", "usercount"])
    .optional()
    .describe("Sort field: date (default), count, or usercount.");

  server.registerTool(
    "errors_by_day",
    {
      title: "Errors per day",
      description:
        "Daily error totals with affected-user counts and TrackJS links (GET /errors/daily), newest day first by default. " +
        "Use for trends, spotting spikes and comparing before/after a deploy. Set size to the number of days you need (max 1000).",
      inputSchema: {
        ...paged("Set to the number of days wanted, e.g. 30."),
        sortBy: periodSortBy,
        sortDirection,
      },
      annotations: { title: "Errors per day", ...READ_ONLY },
    },
    async (args) =>
      run(args, async () => {
        const response = await client.get<PagedResponse<ErrorPeriod>>("/errors/daily", {
          ...rangeQuery(args),
          sort: sortParam(args.sortBy, args.sortDirection, "date"),
        });
        return formatErrorPeriods(response);
      }),
  );

  server.registerTool(
    "errors_by_hour",
    {
      title: "Errors per hour",
      description:
        "Hourly error totals with affected-user counts and TrackJS links (GET /errors/hourly), newest hour first by default. " +
        "Use to pinpoint when a spike started. Pass date-times (e.g. 2026-10-18T06:00:00Z) to narrow the window.",
      inputSchema: {
        ...paged("Set to the number of hours wanted, e.g. 48."),
        sortBy: periodSortBy,
        sortDirection,
      },
      annotations: { title: "Errors per hour", ...READ_ONLY },
    },
    async (args) =>
      run(args, async () => {
        const response = await client.get<PagedResponse<ErrorPeriod>>("/errors/hourly", {
          ...rangeQuery(args),
          sort: sortParam(args.sortBy, args.sortDirection, "date"),
        });
        return formatErrorPeriods(response);
      }),
  );

  server.registerTool(
    "page_views_by_day",
    {
      title: "Page views per day",
      description:
        "Daily page view counts (times the TrackJS agent loaded) newest first (GET /hits/daily). Combine with errors_by_day " +
        "to compute an error rate and tell real regressions apart from traffic changes.",
      inputSchema: paged("Set to the number of days wanted, e.g. 30."),
      annotations: { title: "Page views per day", ...READ_ONLY },
    },
    async (args) =>
      run(args, async () => {
        const response = await client.get<PagedResponse<PageViewPeriod>>("/hits/daily", rangeQuery(args));
        return formatPageViews(response);
      }),
  );

  server.registerTool(
    "page_views_by_hour",
    {
      title: "Page views per hour",
      description:
        "Hourly page view counts (times the TrackJS agent loaded) newest first (GET /hits/hourly). Combine with errors_by_hour " +
        "to see whether a spike in errors is just a spike in traffic.",
      inputSchema: paged("Set to the number of hours wanted, e.g. 48."),
      annotations: { title: "Page views per hour", ...READ_ONLY },
    },
    async (args) =>
      run(args, async () => {
        const response = await client.get<PagedResponse<PageViewPeriod>>("/hits/hourly", rangeQuery(args));
        return formatPageViews(response);
      }),
  );

  server.registerTool(
    "usage_by_hour",
    {
      title: "Account usage per hour",
      description:
        "Account-wide usage per hour, oldest first (GET /usage/hourly): page views, total/processed/ignored/dropped errors " +
        "and errors per page view. Not broken down by application. Useful for checking plan usage, ignore-rule effects and " +
        "dropped (over-quota) errors. Set granularity=day to roll hours up into UTC days for long ranges. Always pass a " +
        "startDate/endDate window; long hourly ranges produce many rows.",
      inputSchema: {
        startDate: isoDate("start"),
        endDate: isoDate("end"),
        granularity: z
          .enum(["hour", "day"])
          .optional()
          .describe("hour (default) returns the API's hourly rows; day sums them per UTC day to save space."),
      },
      annotations: { title: "Account usage per hour", ...READ_ONLY },
    },
    async (args) =>
      run(args, async () => {
        const rows = await client.get<UsageHour[]>("/usage/hourly", {
          startDate: args.startDate,
          endDate: args.endDate,
        });
        return formatUsage(rows, args.granularity ?? "hour");
      }),
  );
}
