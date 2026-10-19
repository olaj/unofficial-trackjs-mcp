import type { TrackJsConfig } from "./config.js";

export const API_BASE_URL = "https://api.trackjs.com";
const DEFAULT_TIMEOUT_MS = 30_000;

export type QueryValue = string | number | boolean | undefined;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
}

/** An HTTP or network failure, with a message written for the agent reading the tool result. */
export class TrackJsApiError extends Error {
  override name = "TrackJsApiError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Minimal read-only client for the TrackJS Data API (https://docs.trackjs.com/data-api/). */
export class TrackJsClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string | undefined;

  constructor(
    private readonly config: TrackJsConfig,
    options: ClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = (options.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent;
  }

  /** Builds the request URL for a path such as "/errors/daily". Undefined query values are dropped. */
  buildUrl(path: string, query: Record<string, QueryValue> = {}): string {
    const url = new URL(`${this.baseUrl}/${encodeURIComponent(this.config.customerId)}/v1${path}`);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
    }
    return url.toString();
  }

  async get<T>(path: string, query: Record<string, QueryValue> = {}): Promise<T> {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = {
      Authorization: this.config.apiKey,
      Accept: "application/json",
    };
    if (this.userAgent) headers["User-Agent"] = this.userAgent;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new TrackJsApiError(
        timedOut
          ? `TrackJS API did not respond within ${Math.round(this.timeoutMs / 1000)}s (GET ${path}). Try a narrower date range or smaller page size.`
          : `Could not reach the TrackJS API (GET ${path}): ${reason}`,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      throw new TrackJsApiError(describeHttpError(response, path, body), response.status);
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new TrackJsApiError(
        `TrackJS API returned a non-JSON response for GET ${path} (HTTP ${response.status}): ${snippet(body)}`,
        response.status,
      );
    }
  }
}

function describeHttpError(response: Response, path: string, body: string): string {
  const status = response.status;
  const detail = body.trim() ? ` Response: ${snippet(body)}` : "";
  switch (status) {
    case 400:
      return `TrackJS rejected the request as invalid (400) for GET ${path}. Check date formats (ISO 8601), page/size (size 1-1000) and sort values.${detail}`;
    case 401:
      return (
        "TrackJS rejected the API key (401 Unauthorized). Check that TRACKJS_API_KEY is the Data API key from " +
        "https://my.trackjs.com/account/organization (only visible to the Account Owner) and that it has not been regenerated." +
        detail
      );
    case 403:
      return (
        "TrackJS denied access (403 Forbidden). The API key may not belong to TRACKJS_CUSTOMER_ID, the account may not " +
        "have Data API access, or the key may have been revoked. Both values must come from the same account's " +
        "Account Owner settings." +
        detail
      );
    case 404:
      return `TrackJS returned 404 Not Found for GET ${path}. Check that TRACKJS_CUSTOMER_ID is correct.${detail}`;
    case 429: {
      const retryAfter = response.headers.get("retry-after");
      return (
        "TrackJS rate limit hit (429 Too Many Requests). " +
        (retryAfter ? `Retry after ${retryAfter} seconds. ` : "Wait a bit before retrying. ") +
        "Avoid paging through large result sets in a tight loop; prefer aggregate tools (top_messages, errors_by_day) or larger page sizes."
      );
    }
    default:
      if (status >= 500) {
        return `TrackJS API server error (${status}) for GET ${path}. This is usually temporary; try again shortly.${detail}`;
      }
      return `TrackJS API request failed with HTTP ${status} for GET ${path}.${detail}`;
  }
}

function snippet(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
