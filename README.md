# unofficial-trackjs-mcp

[![CI](https://github.com/olaj/unofficial-trackjs-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/olaj/unofficial-trackjs-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/unofficial-trackjs-mcp.svg)](https://www.npmjs.com/package/unofficial-trackjs-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude Code, Claude Desktop, Cursor, and other MCP clients) query your JavaScript error data through the [TrackJS Data API](https://docs.trackjs.com/data-api/).

Ask things like:

- "What are our top 10 JavaScript errors this week, by affected users?"
- "Did errors spike after yesterday's deploy? Compare errors per page view by hour."
- "Show me a few stack traces for `Cannot read properties of undefined (reading 'map')`."
- "Which pages are the most broken?"

> [!IMPORTANT]
> **This is an unofficial, community project.** It is not made, endorsed, or supported by TrackJS. "TrackJS" is a trademark of its owner and is used here only to describe what the server connects to. For issues with this server, open an issue in this repository, not with TrackJS support.

It is **read-only**: it only calls the Data API's `GET` endpoints. It cannot change triage status, ignore rules, or any other settings.

## Requirements

- Node.js 18 or newer
- A TrackJS **API key** and **Customer ID**. Both are only visible to the **Account Owner**, under [Account Settings → Organization](https://my.trackjs.com/account/organization).

## Install

The server runs over stdio with `npx`, so there is nothing to install globally. It reads two environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `TRACKJS_API_KEY` | yes | Data API key. Sent in the `Authorization` header. Treat it as a secret. |
| `TRACKJS_CUSTOMER_ID` | yes | Your Customer ID, used in the API URL (`https://api.trackjs.com/{CUSTOMER_ID}/v1/...`). |

If either is missing, the server exits at startup with a message saying which one.

### Claude Code

```sh
claude mcp add trackjs --transport stdio --env TRACKJS_API_KEY=your-api-key --env TRACKJS_CUSTOMER_ID=your-customer-id -- npx -y unofficial-trackjs-mcp
```

Put the server name (`trackjs`) first and the `--env` options last, right before `--`. `--env` accepts several values in a row, so a name placed after it is read as another variable.

Add `--scope user` to make it available in every project, or `--scope project` to write it to a shared `.mcp.json` (don't commit real keys; `.mcp.json` supports `${TRACKJS_API_KEY}` style environment expansion).

Check it with `claude mcp list`, or `/mcp` inside a session.

### Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "trackjs": {
      "command": "npx",
      "args": ["-y", "unofficial-trackjs-mcp"],
      "env": {
        "TRACKJS_API_KEY": "your-api-key",
        "TRACKJS_CUSTOMER_ID": "your-customer-id"
      }
    }
  }
}
```

Restart Claude Desktop afterwards. On Windows, if the server fails to start, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "unofficial-trackjs-mcp"]`.

### Other MCP clients (Cursor, VS Code, Windsurf, …)

Any client that supports stdio servers works. The generic shape is:

- **command:** `npx`
- **args:** `["-y", "unofficial-trackjs-mcp"]`
- **env:** `TRACKJS_API_KEY`, `TRACKJS_CUSTOMER_ID`

For example, Cursor's `.cursor/mcp.json` uses the same `mcpServers` block as Claude Desktop above. You can also install it globally (`npm install -g unofficial-trackjs-mcp`) and use `unofficial-trackjs-mcp` as the command.

## Tools

Each tool maps to one documented Data API endpoint, and the parameter names match the API (`query`, `size`, `page`, `startDate`, `endDate`, `application`, `includeStack`, `sort`).

| Tool | Endpoint | What it returns |
| --- | --- | --- |
| `list_errors` | `GET /errors` | Individual error occurrences, newest first. Search with `query` (same as dashboard search: messages, URLs, metadata, user IDs). Optional stack traces with `includeStack`. |
| `top_messages` | `GET /errors/messages` | Error counts grouped by message, with affected users, triage status, and last seen. |
| `errors_by_url` | `GET /errors/urls` | Error counts grouped by page URL. |
| `errors_by_day` | `GET /errors/daily` | Error and affected-user counts per day. |
| `errors_by_hour` | `GET /errors/hourly` | Error and affected-user counts per hour. |
| `page_views_by_day` | `GET /hits/daily` | Page views (agent loads) per day. Useful for error rates. |
| `page_views_by_hour` | `GET /hits/hourly` | Page views per hour. |
| `usage_by_hour` | `GET /usage/hourly` | Account-wide hourly usage: page views and total/processed/ignored/dropped errors. Can roll up to days. |

Common parameters:

- `application`: limit to one TrackJS application key.
- `startDate` / `endDate`: ISO 8601 dates or date-times (UTC), e.g. `2026-10-01` or `2026-10-01T14:00:00Z`.
- `page` / `size`: paging. `size` is 1–1000; TrackJS defaults to 20.
- `sortBy` / `sortDirection`: on the grouped and per-period tools. The server sends them as the API's `sort=field|direction` string.

The TrackJS Data API has no endpoints for browsers, applications, or single-error lookup, so this server doesn't offer tools for them. To narrow errors by browser or anything else searchable, use `list_errors` with `query`.

### Output

Results are compact JSON meant to keep the agent's context small:

- Empty fields are dropped. Long messages, URLs, and metadata values are truncated with a `… [+N chars]` marker.
- Stack traces are off unless `includeStack: true`. They are then cut to the first `maxStackLines` lines (default 20), with a `… N more lines` note.
- Every response has a `paging` block (`page`, `size`, `returned`, `hasMore`, `nextPage`, `totalCount` where available). Every item has a `link` to the matching TrackJS dashboard page.
- Time-series tools include `totals`. `usage_by_hour` returns rows as arrays with a `columns` header.

Example `top_messages` result:

```json
{"paging":{"page":1,"size":3,"returned":1,"hasMore":true,"nextPage":2,"startDate":"2014-09-11T00:00:00Z"},"link":"https://my.trackjs.com/messages","messages":[{"message":"Cannot read property on of undefined","count":54,"userCount":12,"status":"Investigating","lastSeen":"2016-09-22T22:42:23.579+00:00","link":"https://my.trackjs.com/messages/filtered?message=Cannot+read+property+%27on%27+of+undefined&"}]}
```

### Errors

API failures come back as tool errors written for the agent:

- **401**: the API key was rejected. Check `TRACKJS_API_KEY`.
- **403**: the key and Customer ID don't match, or the account has no Data API access.
- **404**: usually a wrong `TRACKJS_CUSTOMER_ID`.
- **429**: rate limited. Includes `Retry-After` when TrackJS sends it.
- Timeouts (30s), network failures, 5xx, and invalid input (bad dates, `size` out of range, `startDate` after `endDate`) are reported the same way.

The API key is only sent in the `Authorization` header. It never appears in URLs, logs, or error messages.

## Development

```sh
git clone https://github.com/olaj/unofficial-trackjs-mcp.git
cd unofficial-trackjs-mcp
npm install
npm run check    # typecheck + lint + tests
npm run build    # compiles to dist/
```

The dev toolchain (vitest) needs Node 22+. The built package runs on Node 18+.

Tests use fixtures in `test/fixtures/` shaped from the examples in the [Data API docs](https://docs.trackjs.com/data-api/), plus an in-memory MCP client. They make no network calls.

To try a local build in Claude Code:

```sh
npm run build
claude mcp add trackjs-dev --env TRACKJS_API_KEY=... --env TRACKJS_CUSTOMER_ID=... -- node /absolute/path/to/dist/index.js
```

You can also inspect it with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```sh
npx @modelcontextprotocol/inspector -e TRACKJS_API_KEY=... -e TRACKJS_CUSTOMER_ID=... node dist/index.js
```

Project layout:

```
src/index.ts    entry point: env config + stdio transport
src/server.ts   McpServer setup
src/tools.ts    tool definitions (zod input schemas)
src/client.ts   Data API client (built-in fetch) and error messages
src/format.ts   output compaction (truncation, stack trimming, paging)
src/types.ts    response types from the docs
```

## License

[MIT](LICENSE) © Ola. Not affiliated with TrackJS.
