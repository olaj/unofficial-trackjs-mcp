import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

describe("package metadata", () => {
  const pkg = read("package.json");
  const server = read("server.json");

  it("keeps server.json in sync with package.json for the MCP registry", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.packages[0].version).toBe(pkg.version);
  });

  it("documents the version in the changelog", () => {
    expect(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8")).toContain(`## [${pkg.version}]`);
  });
});
