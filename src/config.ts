export interface TrackJsConfig {
  apiKey: string;
  customerId: string;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const HOW_TO =
  "Both values are shown only to the Account Owner in TrackJS: " +
  "https://my.trackjs.com/account/organization";

/** Reads TRACKJS_API_KEY and TRACKJS_CUSTOMER_ID, throwing a ConfigError that explains what is missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): TrackJsConfig {
  const apiKey = env.TRACKJS_API_KEY?.trim() ?? "";
  const customerId = env.TRACKJS_CUSTOMER_ID?.trim() ?? "";

  const missing: string[] = [];
  if (!apiKey) missing.push("TRACKJS_API_KEY");
  if (!customerId) missing.push("TRACKJS_CUSTOMER_ID");
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ${HOW_TO}`,
    );
  }

  if (!/^[A-Za-z0-9_-]+$/.test(customerId)) {
    throw new ConfigError(
      `TRACKJS_CUSTOMER_ID looks invalid (${JSON.stringify(customerId)}); expected the plain Customer ID, ` +
        `not a URL. ${HOW_TO}`,
    );
  }

  return { apiKey, customerId };
}
