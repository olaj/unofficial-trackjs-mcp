#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TrackJsClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { createServer, packageVersion, SERVER_NAME } from "./server.js";

async function main(): Promise<void> {
  const version = packageVersion();
  const config = loadConfig();
  const client = new TrackJsClient(config, { userAgent: `${SERVER_NAME}/${version}` });
  const server = createServer(client, version);
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; log to stderr only.
  console.error(`${SERVER_NAME} ${version} running on stdio (customer ${config.customerId})`);
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`${SERVER_NAME}: ${err.message}`);
  } else {
    console.error(`${SERVER_NAME}: fatal error:`, err);
  }
  process.exit(1);
});
