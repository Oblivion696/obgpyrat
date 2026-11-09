/**
 * Global constants for the Google Ads MCP server.
 *
 * API version: Google releases a new Google Ads API version roughly every
 * quarter and sunsets old ones about a year after release. v26 is the
 * current stable version as of November 2026. It is kept in one place and
 * overridable via GOOGLE_ADS_API_VERSION so the server can be bumped to a
 * newer version without touching any tool code (every tool builds its URL
 * from API_VERSION).
 */
export const API_VERSION = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v26";

export const GOOGLE_ADS_API_BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

export const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords";

/** Soft cap on the size of any single tool response, in characters. */
export const CHARACTER_LIMIT = 25_000;

/** Default page size for GAQL searches and list wrappers. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Request timeout for calls to Google's servers (ms). */
export const REQUEST_TIMEOUT_MS = 30_000;
