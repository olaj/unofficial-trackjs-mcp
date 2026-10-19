import { describe, expect, it } from "vitest";
import {
  compact,
  formatError,
  formatUsage,
  MAX_MESSAGE_CHARS,
  MAX_METADATA_ENTRIES,
  trimStack,
  truncate,
} from "../src/format.js";
import type { UsageHour } from "../src/types.js";
import { fixture } from "./helpers.js";

describe("truncate", () => {
  it("leaves short strings alone and marks cut ones", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdefgh", 5)).toBe("abcde… [+3 chars]");
    expect(truncate(undefined, 5)).toBeUndefined();
  });
});

describe("compact", () => {
  it("drops empty values recursively but keeps zero and false", () => {
    expect(compact({ a: "", b: null, c: undefined, d: [], e: {}, f: 0, g: false, h: { i: "" }, j: [1] })).toEqual({
      f: 0,
      g: false,
      j: [1],
    });
  });
});

describe("trimStack", () => {
  it("keeps the first N non-blank lines and counts the rest", () => {
    const stack = ["Error: boom", "", ...Array.from({ length: 30 }, (_, i) => `  at f${i} (app.js:${i}:1)`)];
    const trimmed = trimStack(stack, 5)!;
    expect(trimmed).toHaveLength(6);
    expect(trimmed[0]).toBe("Error: boom");
    expect(trimmed[1]).toBe("at f0 (app.js:0:1)");
    expect(trimmed[5]).toBe("… 26 more lines");
  });

  it("splits embedded newlines and caps line length", () => {
    const trimmed = trimStack([`Error: x\n  at ${"a".repeat(1000)}`], 10)!;
    expect(trimmed).toHaveLength(2);
    expect(trimmed[1]!.length).toBeLessThan(350);
  });

  it("returns undefined for empty stacks", () => {
    expect(trimStack(undefined, 5)).toBeUndefined();
    expect(trimStack([" ", ""], 5)).toBeUndefined();
  });
});

describe("formatError", () => {
  const [first, second] = (fixture("errors") as { data: Parameters<typeof formatError>[0][] }).data;

  it("produces a compact record with location, browser, metadata and link", () => {
    expect(formatError(first!, { maxStackLines: 3 })).toEqual({
      id: "5d893bd8c50346fe9b97af36af530f2d",
      timestamp: "2016-07-23T19:24:43.394+00:00",
      message: "ReferenceError: data is not defined",
      status: "Investigating",
      pageUrl: "https://my.trackjs.com/daily?date=2016-07-23",
      location: "https://my.trackjs.com/daily?date=2016-07-23:387:41",
      entry: "window",
      browser: "Chrome 51.0.2704",
      userId: "todd@trackjs.com",
      metadata: { subscription: "Professional" },
      stackTrace: [
        "ReferenceError: data is not defined",
        "at HTMLDocument (https://my.trackjs.com/daily?date=2016-07-23:387:41)",
        "at c (https://my.trackjs.com/js/lib/jquery/jquery-1.10.2.min.js:4:26036)",
        "… 3 more lines",
      ],
      link: "https://my.trackjs.com/details/5d893bd8c50346fe9b97af36af530f2d",
    });
  });

  it("omits empty fields", () => {
    const out = formatError(second!, { maxStackLines: 3 });
    expect(Object.keys(out).sort()).toEqual(["browser", "entry", "id", "link", "message", "pageUrl", "timestamp"]);
  });

  it("truncates huge messages and caps metadata entries", () => {
    const out = formatError(
      {
        id: "x",
        message: "m".repeat(5000),
        metadata: Array.from({ length: 50 }, (_, i) => ({ key: `k${i}`, value: "v".repeat(1000) })),
      },
      { maxStackLines: 3 },
    );
    expect(out.message!.length).toBeLessThan(MAX_MESSAGE_CHARS + 30);
    expect(Object.keys(out.metadata!)).toHaveLength(MAX_METADATA_ENTRIES + 1);
    expect(out.metadata!["…"]).toBe("30 more metadata entries omitted");
    expect(out.metadata!.k0!.length).toBeLessThan(250);
  });
});

describe("formatUsage", () => {
  const rows = fixture("usage-hourly") as UsageHour[];

  it("returns hourly rows as arrays with totals", () => {
    const out = formatUsage(rows, "hour");
    expect(out.hoursReturned).toBe(3);
    expect(out.range).toEqual({ from: "2023-01-18T07:00:00+00:00", to: "2023-01-19T00:00:00+00:00" });
    expect(out.totals).toEqual({
      pageViews: 1301,
      totalErrors: 6436,
      processedErrors: 5661,
      ignoredErrors: 702,
      droppedErrors: 5,
      errorsPerPageView: 4.947,
    });
    expect(out.rows[0]).toEqual(["2023-01-18T07:00:00+00:00", 556, 3126, 2762, 352, 0, 5.622]);
  });

  it("rolls hours up into UTC days", () => {
    const out = formatUsage(rows, "day");
    expect(out.rows).toEqual([
      ["2023-01-18", 1201, 6386, 5621, 697, 0, 5.317],
      ["2023-01-19", 100, 50, 40, 5, 5, 0.5],
    ]);
  });

  it("copes with an empty or missing response", () => {
    expect(formatUsage([], "hour")).toMatchObject({ hoursReturned: 0, rows: [], totals: { errorsPerPageView: null } });
    expect(formatUsage(undefined, "day").rows).toEqual([]);
  });
});
