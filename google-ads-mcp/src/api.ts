/**
 * Core REST client for the Google Ads API.
 *
 * Every tool goes through `googleAdsRequest` (generic HTTP call),
 * `gaqlSearch` (one page of a GAQL query) or `mutate` (resource mutate
 * endpoint). This keeps authentication, headers, timeouts and error
 * formatting in one place.
 */
import { GOOGLE_ADS_API_BASE_URL, REQUEST_TIMEOUT_MS } from "./constants.js";
import { getAccessToken, loadConfig, type GoogleAdsConfig } from "./auth.js";

export interface GoogleAdsErrorDetail {
  /** e.g. { requestError: "RESOURCE_NOT_FOUND" } or { rangeError: "TOO_LOW" } */
  errorCode: Record<string, string>;
  message: string;
  trigger?: unknown;
  location?: {
    fieldPathElements?: Array<{ fieldName: string; index?: number }>;
  };
}

/**
 * Thrown for any non-2xx response from googleads.googleapis.com. Carries the
 * parsed GoogleAdsFailure details (when present) so callers can build a
 * precise, actionable error message instead of a generic "request failed".
 */
export class GoogleAdsApiError extends Error {
  readonly httpStatus: number;
  readonly grpcCode?: number;
  readonly requestId?: string;
  readonly googleAdsErrors: GoogleAdsErrorDetail[];
  readonly rawBody: string;

  constructor(httpStatus: number, rawBody: string) {
    const parsed = GoogleAdsApiError.parseBody(rawBody);
    super(GoogleAdsApiError.buildMessage(httpStatus, parsed));
    this.name = "GoogleAdsApiError";
    this.httpStatus = httpStatus;
    this.grpcCode = parsed.grpcCode;
    this.requestId = parsed.requestId;
    this.googleAdsErrors = parsed.errors;
    this.rawBody = rawBody;
  }

  private static parseBody(rawBody: string): {
    grpcCode?: number;
    requestId?: string;
    errors: GoogleAdsErrorDetail[];
  } {
    try {
      const json = JSON.parse(rawBody) as {
        error?: {
          code?: number;
          message?: string;
          details?: Array<{
            "@type"?: string;
            errors?: GoogleAdsErrorDetail[];
            requestId?: string;
          }>;
        };
      };
      const errorEnvelope = json.error;
      if (!errorEnvelope) return { errors: [] };
      const failureDetail = errorEnvelope.details?.find(d =>
        d["@type"]?.includes("GoogleAdsFailure")
      );
      return {
        grpcCode: errorEnvelope.code,
        requestId: failureDetail?.requestId,
        errors: failureDetail?.errors ?? []
      };
    } catch {
      return { errors: [] };
    }
  }

  private static buildMessage(
    httpStatus: number,
    parsed: { grpcCode?: number; requestId?: string; errors: GoogleAdsErrorDetail[] }
  ): string {
    if (parsed.errors.length === 0) {
      return `La Google Ads API ha risposto con HTTP ${httpStatus}${
        parsed.grpcCode !== undefined ? ` (grpc code ${parsed.grpcCode})` : ""
      }.`;
    }
    const lines = parsed.errors.map((e, i) => {
      const codeEntries = Object.entries(e.errorCode ?? {});
      const codeStr = codeEntries.map(([cat, reason]) => `${cat}=${reason}`).join(", ") || "unknown";
      const path = e.location?.fieldPathElements
        ?.map(p => (p.index !== undefined ? `${p.fieldName}[${p.index}]` : p.fieldName))
        .join(".");
      const parts = [`#${i + 1} [${codeStr}] ${e.message}`];
      if (path) parts.push(`campo: ${path}`);
      if (e.trigger !== undefined) parts.push(`valore scatenante: ${JSON.stringify(e.trigger)}`);
      return parts.join(" | ");
    });
    const header = `La Google Ads API ha rifiutato la richiesta (HTTP ${httpStatus}${
      parsed.requestId ? `, requestId=${parsed.requestId}` : ""
    }):`;
    return [header, ...lines].join("\n");
  }
}

function buildHeaders(config: GoogleAdsConfig, accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": config.developerToken,
    "Content-Type": "application/json"
  };
  if (config.loginCustomerId) {
    headers["login-customer-id"] = config.loginCustomerId;
  }
  return headers;
}

/**
 * Low-level request to the Google Ads REST API. `path` is relative to the
 * version base, e.g. "customers/1234567890/googleAds:search".
 */
export async function googleAdsRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  signal: AbortSignal
): Promise<T> {
  const config = loadConfig();
  const accessToken = await getAccessToken(config, signal);
  const url = `${GOOGLE_ADS_API_BASE_URL}/${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: buildHeaders(config, accessToken),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(
        `La Google Ads API non ha risposto entro ${REQUEST_TIMEOUT_MS / 1000} secondi (${method} ${path}). Riprova; se persiste, la query/operazione potrebbe essere troppo pesante.`
      );
    }
    throw error;
  }

  const text = await response.text();
  if (!response.ok) {
    throw new GoogleAdsApiError(response.status, text);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export interface GaqlSearchResult {
  results: Array<Record<string, unknown>>;
  nextPageToken?: string;
  fieldMask?: string;
}

/**
 * Runs one page of a GAQL query against customers/{customerId}/googleAds:search.
 */
export async function gaqlSearch(
  customerId: string,
  query: string,
  pageSize: number,
  pageToken: string | undefined,
  signal: AbortSignal
): Promise<GaqlSearchResult> {
  const normalizedCustomerId = customerId.replace(/[^0-9]/g, "");
  const body: Record<string, unknown> = { query, pageSize };
  if (pageToken) body.pageToken = pageToken;

  const raw = await googleAdsRequest<{
    results?: Array<Record<string, unknown>>;
    nextPageToken?: string;
    fieldMask?: string;
  }>("POST", `customers/${normalizedCustomerId}/googleAds:search`, body, signal);

  return {
    results: raw.results ?? [],
    nextPageToken: raw.nextPageToken,
    fieldMask: raw.fieldMask
  };
}

export type MutateOperation = Record<string, unknown>;

export interface MutateResult {
  results: Array<{ resourceName?: string } & Record<string, unknown>>;
  partialFailureError?: unknown;
}

/**
 * Runs a mutate call against a single-resource mutate endpoint, e.g.
 * "campaignBudgets:mutate", "campaigns:mutate", "adGroupCriteria:mutate".
 * `resourcePath` must be the plural resource collection name as it appears
 * in the REST URL (camelCase), e.g. "campaignBudgets", "adGroups".
 */
export async function mutate(
  customerId: string,
  resourcePath: string,
  operations: MutateOperation[],
  partialFailure: boolean,
  signal: AbortSignal
): Promise<MutateResult> {
  const normalizedCustomerId = customerId.replace(/[^0-9]/g, "");
  const body = { operations, partialFailure };
  const raw = await googleAdsRequest<{ results?: Array<Record<string, unknown>>; partialFailureError?: unknown }>(
    "POST",
    `customers/${normalizedCustomerId}/${resourcePath}:mutate`,
    body,
    signal
  );
  return { results: raw.results ?? [], partialFailureError: raw.partialFailureError };
}

/**
 * Runs a grouped mutate against googleAds:mutate, where each operation names
 * its own resource-specific operation type (e.g. campaignOperation,
 * campaignBudgetOperation). Used by the generic escape-hatch tool and by
 * workflows that must create several linked resources atomically (e.g. a
 * campaign budget + campaign + ad group in one request, using temporary
 * resource names like "customers/123/campaignBudgets/-1").
 */
export async function mutateGrouped(
  customerId: string,
  mutateOperations: MutateOperation[],
  partialFailure: boolean,
  signal: AbortSignal
): Promise<MutateResult> {
  const normalizedCustomerId = customerId.replace(/[^0-9]/g, "");
  const body = { mutateOperations, partialFailure };
  const raw = await googleAdsRequest<{ mutateOperationResponses?: Array<Record<string, unknown>> }>(
    "POST",
    `customers/${normalizedCustomerId}/googleAds:mutate`,
    body,
    signal
  );
  // Flatten the per-operation responses into a single results array of resource names, best-effort.
  const results = (raw.mutateOperationResponses ?? []).map(resp => {
    const inner = Object.values(resp)[0] as { resourceName?: string } | undefined;
    return { resourceName: inner?.resourceName };
  });
  return { results };
}
