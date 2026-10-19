import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrackJsClient } from "./client.js";
import { registerTools } from "./tools.js";

export const SERVER_NAME = "unofficial-trackjs-mcp";

export function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function createServer(client: TrackJsClient, version = packageVersion()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version },
    {
      instructions:
        "Read-only access to TrackJS JavaScript error monitoring data via the TrackJS Data API (unofficial server). " +
        "Start broad with top_messages, errors_by_url or errors_by_day, then drill into examples with list_errors " +
        "(query=<message>, includeStack=true, small size). Dates are ISO 8601 in UTC. Results are paged: check " +
        "paging.hasMore and pass paging.nextPage as `page` to continue. Every item includes a TrackJS `link` to share with the user.",
    },
  );
  registerTools(server, client);
  return server;
}
