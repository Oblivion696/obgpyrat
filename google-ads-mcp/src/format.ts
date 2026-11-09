/**
 * Shared helpers for rendering tool output: a markdown/json toggle, and
 * keeping responses under CHARACTER_LIMIT by trimming rows (never by
 * truncating text), per the MCP best-practices guide.
 */
import { CHARACTER_LIMIT } from "./constants.js";

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function errorResult(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function jsonResult(data: Record<string, unknown>): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

export function textResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Converts GAQL search results (flat list of row objects with dotted paths
 * already nested by the API, e.g. { campaign: {...}, metrics: {...} }) into
 * a page object, shrinking the row count (never the JSON) until it fits
 * CHARACTER_LIMIT. Returns both the trimmed page and whether rows were
 * dropped to fit.
 */
export function buildPage<T>(
  rows: T[],
  extra: Record<string, unknown>
): { page: Record<string, unknown>; text: string; truncated: boolean } {
  let slice = rows;
  let page = { ...extra, count: slice.length, rows: slice };
  let text = JSON.stringify(page, null, 2);
  let truncated = false;
  while (slice.length > 1 && text.length > CHARACTER_LIMIT) {
    truncated = true;
    slice = slice.slice(0, Math.ceil(slice.length / 2));
    page = { ...extra, count: slice.length, rows: slice };
    text = JSON.stringify(page, null, 2);
  }
  return { page, text, truncated };
}
