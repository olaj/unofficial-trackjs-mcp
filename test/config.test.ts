import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("reads and trims both variables", () => {
    expect(loadConfig({ TRACKJS_API_KEY: " key ", TRACKJS_CUSTOMER_ID: " cust1 " })).toEqual({
      apiKey: "key",
      customerId: "cust1",
    });
  });

  it("names every missing variable", () => {
    expect(() => loadConfig({})).toThrowError(/TRACKJS_API_KEY, TRACKJS_CUSTOMER_ID/);
    expect(() => loadConfig({ TRACKJS_API_KEY: "k" })).toThrowError(/variable: TRACKJS_CUSTOMER_ID\./);
    expect(() => loadConfig({ TRACKJS_CUSTOMER_ID: "c", TRACKJS_API_KEY: "  " })).toThrowError(ConfigError);
  });

  it("points at the Account Owner settings page", () => {
    expect(() => loadConfig({})).toThrowError(/Account Owner.*my\.trackjs\.com\/account\/organization/);
  });

  it("rejects a customer ID that is not a plain ID", () => {
    expect(() =>
      loadConfig({ TRACKJS_API_KEY: "k", TRACKJS_CUSTOMER_ID: "https://api.trackjs.com/abc" }),
    ).toThrowError(/looks invalid/);
  });
});
