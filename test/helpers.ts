import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TrackJsClient, type FetchLike } from "../src/client.js";
import { createServer } from "../src/server.js";

// Fixtures reproduce the example responses in https://docs.trackjs.com/data-api/.
// Where the docs leave a value out, a plausible one has been filled in.
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

export const TEST_CONFIG = { apiKey: "test-api-key", customerId: "abc123" };

export interface RecordedCall {
  url: URL;
  init: RequestInit | undefined;
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

/** A fetch stand-in that answers by URL pathname and records every request. No network. */
export function fakeFetch(routes: Record<string, Reply>) {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    const reply = routes[url.pathname];
    if (reply instanceof Error) throw reply;
    if (!reply) return new Response(`no fixture for ${url.pathname}`, { status: 404 });
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? null);
    return new Response(body, {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { fetch: fetchImpl, calls };
}

/** Starts the real MCP server in-process with a fake fetch and returns a connected MCP client. */
export async function connect(routes: Record<string, Reply>) {
  const fake = fakeFetch(routes);
  const server = createServer(new TrackJsClient(TEST_CONFIG, { fetch: fake.fetch }), "0.0.0-test");
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const first = result.content[0];
    const text = first && first.type === "text" ? first.text : "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { result, text, json: () => JSON.parse(text) as Record<string, any> };
  }

  return { client, server, calls: fake.calls, call, close: () => client.close() };
}

export const path = (suffix: string) => `/${TEST_CONFIG.customerId}/v1${suffix}`;
