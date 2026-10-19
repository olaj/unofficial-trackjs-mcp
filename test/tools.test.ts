import { afterEach, describe, expect, it } from "vitest";
import { TOOL_NAMES } from "../src/tools.js";
import { connect, fixture, path } from "./helpers.js";

const routes = {
  [path("/errors")]: { body: fixture("errors") },
  [path("/errors/daily")]: { body: fixture("errors-daily") },
  [path("/errors/hourly")]: { body: fixture("errors-hourly") },
  [path("/errors/messages")]: { body: fixture("errors-messages") },
  [path("/errors/urls")]: { body: fixture("errors-urls") },
  [path("/hits/daily")]: { body: fixture("hits-daily") },
  [path("/hits/hourly")]: { body: fixture("hits-hourly") },
  [path("/usage/hourly")]: { body: fixture("usage-hourly") },
};

let session: Awaited<ReturnType<typeof connect>> | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

async function start(r: Parameters<typeof connect>[0] = routes) {
  session = await connect(r);
  return session;
}

const params = (s: Awaited<ReturnType<typeof connect>>, i = 0) => Object.fromEntries(s.calls[i]!.url.searchParams);

describe("tool registration", () => {
  it("exposes every tool as read-only with a description and input schema", async () => {
    const s = await start();
    const { tools } = await s.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.description!.length).toBeGreaterThan(80);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("uses the API's parameter names (size/query/includeStack, not limit/message)", async () => {
    const s = await start();
    const { tools } = await s.client.listTools();
    const listErrors = tools.find((t) => t.name === "list_errors")!;
    expect(Object.keys(listErrors.inputSchema.properties!).sort()).toEqual(
      ["application", "endDate", "includeStack", "maxStackLines", "page", "query", "size", "startDate"].sort(),
    );
  });
});

describe("list_errors", () => {
  it("passes query, paging and includeStack through and returns compact errors", async () => {
    const s = await start();
    const { result, json } = await s.call("list_errors", {
      query: "Cannot read property",
      application: "web",
      startDate: "2018-11-20",
      endDate: "2018-11-27",
      page: 2,
      size: 3,
      includeStack: true,
      maxStackLines: 2,
    });
    expect(result.isError).toBeFalsy();
    expect(s.calls[0]!.url.pathname).toBe(path("/errors"));
    expect(params(s)).toEqual({
      query: "Cannot read property",
      application: "web",
      startDate: "2018-11-20",
      endDate: "2018-11-27",
      page: "2",
      size: "3",
      includeStack: "true",
    });

    const out = json();
    expect(out.paging).toEqual({
      page: 1,
      size: 3,
      returned: 2,
      hasMore: true,
      nextPage: 2,
      totalCount: 193,
      startDate: "2018-11-20T00:00:00Z",
      endDate: "2018-11-27T00:00:00Z",
    });
    expect(out.link).toBe("https://my.trackjs.com/recent");
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0].stackTrace).toHaveLength(3);
    expect(out.errors[0].link).toBe("https://my.trackjs.com/details/5d893bd8c50346fe9b97af36af530f2d");
  });

  it("does not send includeStack unless asked", async () => {
    const s = await start();
    await s.call("list_errors", {});
    expect(params(s)).toEqual({});
  });

  it("rejects out-of-range size before calling the API", async () => {
    const s = await start();
    const { result, text } = await s.call("list_errors", { size: 5000 });
    expect(result.isError).toBe(true);
    expect(text).toMatch(/size/);
    expect(s.calls).toHaveLength(0);
  });

  it("rejects malformed dates and inverted ranges", async () => {
    const s = await start();
    const bad = await s.call("list_errors", { startDate: "last tuesday" });
    expect(bad.result.isError).toBe(true);
    expect(bad.text).toMatch(/ISO 8601/);
    expect((await s.call("list_errors", { endDate: "1" })).result.isError).toBe(true);

    const inverted = await s.call("list_errors", { startDate: "2026-10-10", endDate: "2026-10-01" });
    expect(inverted.result.isError).toBe(true);
    expect(inverted.text).toMatch(/after endDate/);
    expect(s.calls).toHaveLength(0);
  });

  it("turns API failures into tool errors with guidance", async () => {
    const s = await start({ [path("/errors")]: { status: 401, body: "Unauthorized" } });
    const { result, text } = await s.call("list_errors", {});
    expect(result.isError).toBe(true);
    expect(text).toMatch(/401 Unauthorized.*TRACKJS_API_KEY/);
  });

  it("surfaces Retry-After on 429", async () => {
    const s = await start({ [path("/errors/messages")]: { status: 429, body: "", headers: { "Retry-After": "12" } } });
    const { result, text } = await s.call("top_messages", {});
    expect(result.isError).toBe(true);
    expect(text).toMatch(/Retry after 12 seconds/);
  });
});

describe("grouped and time-series tools", () => {
  it("top_messages builds field|direction sort strings", async () => {
    const s = await start();
    await s.call("top_messages", { sortBy: "usercount" });
    await s.call("top_messages", { sortDirection: "asc" });
    await s.call("top_messages", {});
    expect(params(s, 0).sort).toBe("usercount|desc");
    expect(params(s, 1).sort).toBe("count|asc");
    expect(params(s, 2).sort).toBeUndefined();
  });

  it("top_messages returns messages with counts, status and links", async () => {
    const s = await start();
    const out = (await s.call("top_messages", { size: 3 })).json();
    expect(s.calls[0]!.url.pathname).toBe(path("/errors/messages"));
    expect(out.messages).toEqual([
      {
        message: "Cannot read property on of undefined",
        count: 54,
        userCount: 12,
        status: "Investigating",
        lastSeen: "2016-09-22T22:42:23.579+00:00",
        link: "https://my.trackjs.com/messages/filtered?message=Cannot+read+property+%27on%27+of+undefined&",
      },
    ]);
    expect(out.paging).toMatchObject({ page: 1, hasMore: true, nextPage: 2 });
    expect(out.link).toBe("https://my.trackjs.com/messages");
  });

  it("errors_by_url returns urls", async () => {
    const s = await start();
    const out = (await s.call("errors_by_url", { sortBy: "usercount", sortDirection: "desc" })).json();
    expect(s.calls[0]!.url.pathname).toBe(path("/errors/urls"));
    expect(params(s).sort).toBe("usercount|desc");
    expect(out.urls[0]).toMatchObject({ url: "https://my.trackjs.com/", count: 104, userCount: 50 });
  });

  it("errors_by_day and errors_by_hour default sort field to date", async () => {
    const s = await start();
    const daily = (await s.call("errors_by_day", { sortDirection: "asc", size: 30 })).json();
    const hourly = (await s.call("errors_by_hour", { startDate: "2020-05-20T02:00:00Z", sortBy: "count" })).json();
    expect(s.calls[0]!.url.pathname).toBe(path("/errors/daily"));
    expect(params(s, 0)).toEqual({ sort: "date|asc", size: "30" });
    expect(s.calls[1]!.url.pathname).toBe(path("/errors/hourly"));
    expect(params(s, 1)).toEqual({ sort: "count|desc", startDate: "2020-05-20T02:00:00Z" });
    expect(daily.totals).toEqual({ errors: 50, userCountSum: 14 });
    expect(daily.periods[0]).toEqual({
      period: "2014-09-24T00:00:00Z",
      count: 36,
      userCount: 10,
      link: "https://my.trackjs.com/daily/filtered?date=9%2f24%2f2014&",
    });
    expect(hourly.periods).toHaveLength(2);
    expect(hourly.paging.endDate).toBe("2020-05-28T16:00:00Z");
  });

  it("page_views_by_day and page_views_by_hour hit /hits", async () => {
    const s = await start();
    const daily = (await s.call("page_views_by_day", { application: "web" })).json();
    const hourly = (await s.call("page_views_by_hour", {})).json();
    expect(s.calls.map((c) => c.url.pathname)).toEqual([path("/hits/daily"), path("/hits/hourly")]);
    expect(params(s, 0)).toEqual({ application: "web" });
    expect(daily).toEqual({
      paging: { page: 1, size: 3, returned: 2, hasMore: true, nextPage: 2, totalCount: 11, startDate: "2014-09-01T00:00:00Z" },
      totals: { pageViews: 6725 },
      periods: [
        { period: "2014-09-12T00:00:00Z", pageViews: 2835 },
        { period: "2014-09-11T00:00:00Z", pageViews: 3890 },
      ],
    });
    expect(hourly.totals.pageViews).toBe(2392);
  });

  it("usage_by_hour only sends dates and supports day roll-up", async () => {
    const s = await start();
    const out = (
      await s.call("usage_by_hour", {
        startDate: "2023-01-18T02:00:00Z",
        endDate: "2023-01-20T16:00:00Z",
        granularity: "day",
      })
    ).json();
    expect(s.calls[0]!.url.pathname).toBe(path("/usage/hourly"));
    expect(params(s)).toEqual({ startDate: "2023-01-18T02:00:00Z", endDate: "2023-01-20T16:00:00Z" });
    expect(out.granularity).toBe("day");
    expect(out.rows).toHaveLength(2);
    expect(out.columns[0]).toBe("timestamp");
  });

  it("does not accept a sort on tools whose endpoint has none", async () => {
    const s = await start();
    const { tools } = await s.client.listTools();
    for (const name of ["page_views_by_day", "page_views_by_hour", "usage_by_hour"]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(Object.keys(tool.inputSchema.properties!)).not.toContain("sortBy");
    }
  });
});
