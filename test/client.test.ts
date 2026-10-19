import { describe, expect, it } from "vitest";
import { TrackJsApiError, TrackJsClient } from "../src/client.js";
import { fakeFetch, fixture, path, TEST_CONFIG } from "./helpers.js";

describe("TrackJsClient", () => {
  it("calls https://api.trackjs.com/{customerId}/v1/... with the key in the Authorization header", async () => {
    const fake = fakeFetch({ [path("/errors")]: { body: fixture("errors") } });
    const client = new TrackJsClient(TEST_CONFIG, { fetch: fake.fetch, userAgent: "ua/1" });
    await client.get("/errors", { size: 5, startDate: "2018-11-20", application: undefined, query: "" });

    const [call] = fake.calls;
    expect(call?.url.origin).toBe("https://api.trackjs.com");
    expect(call?.url.pathname).toBe("/abc123/v1/errors");
    expect(Object.fromEntries(call!.url.searchParams)).toEqual({ size: "5", startDate: "2018-11-20" });
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("test-api-key");
    expect(headers["User-Agent"]).toBe("ua/1");
    // The key goes in the header, never the URL.
    expect(call?.url.toString()).not.toContain("test-api-key");
  });

  it("encodes sort strings and search text", () => {
    const client = new TrackJsClient(TEST_CONFIG, { fetch: fakeFetch({}).fetch });
    const url = new URL(client.buildUrl("/errors", { sort: "usercount|desc", query: "Cannot read property" }));
    expect(url.searchParams.get("sort")).toBe("usercount|desc");
    expect(url.searchParams.get("query")).toBe("Cannot read property");
  });

  it("returns parsed JSON", async () => {
    const fake = fakeFetch({ [path("/usage/hourly")]: { body: fixture("usage-hourly") } });
    const rows = await new TrackJsClient(TEST_CONFIG, { fetch: fake.fetch }).get<unknown[]>("/usage/hourly");
    expect(rows).toHaveLength(3);
  });

  const failures: [number, RegExp, Record<string, string>?][] = [
    [400, /invalid \(400\).*ISO 8601/],
    [401, /rejected the API key \(401.*TRACKJS_API_KEY.*Account Owner/],
    [403, /denied access \(403.*TRACKJS_CUSTOMER_ID/],
    [404, /404 Not Found.*TRACKJS_CUSTOMER_ID/],
    [429, /rate limit.*Retry after 30 seconds/, { "retry-after": "30" }],
    [429, /rate limit.*Wait a bit/],
    [503, /server error \(503\).*temporary/],
    [418, /HTTP 418/],
  ];

  it.each(failures)("explains HTTP %i", async (status, pattern, headers) => {
    const fake = fakeFetch({ [path("/errors")]: { status, body: "nope", headers } });
    const client = new TrackJsClient(TEST_CONFIG, { fetch: fake.fetch });
    const err = await client.get("/errors").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrackJsApiError);
    expect((err as TrackJsApiError).status).toBe(status);
    expect((err as Error).message).toMatch(pattern);
    expect((err as Error).message).not.toContain("test-api-key");
  });

  it("reports non-JSON bodies", async () => {
    const fake = fakeFetch({ [path("/errors")]: { body: "<html>maintenance</html>" } });
    const err = await new TrackJsClient(TEST_CONFIG, { fetch: fake.fetch }).get("/errors").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/non-JSON response.*maintenance/);
  });

  it("reports network failures", async () => {
    const fake = fakeFetch({ [path("/errors")]: new TypeError("fetch failed") });
    const err = await new TrackJsClient(TEST_CONFIG, { fetch: fake.fetch }).get("/errors").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Could not reach the TrackJS API.*fetch failed/);
  });

  it("reports timeouts", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const fake = fakeFetch({ [path("/errors")]: timeout });
    const client = new TrackJsClient(TEST_CONFIG, { fetch: fake.fetch, timeoutMs: 5000 });
    await expect(client.get("/errors")).rejects.toThrow(/did not respond within 5s/);
  });
});
