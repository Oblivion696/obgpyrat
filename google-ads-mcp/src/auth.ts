/**
 * Environment configuration and OAuth2 access-token management.
 *
 * Google Ads API auth (three-legged OAuth2, "installed app" style):
 *   1. A one-time browser consent flow produces a refresh token (see README.md).
 *   2. Every API call needs a short-lived ACCESS token, obtained by exchanging
 *      the refresh token at https://oauth2.googleapis.com/token. Refresh
 *      tokens for this flow do not expire on their own (they can be revoked
 *      by the user or by inactivity, but normally last indefinitely), so this
 *      exchange can be repeated forever.
 *   3. Access tokens last about 1 hour. We cache the current one and its
 *      expiry in module scope and only refresh when it is missing or close
 *      to expiring, so a busy server does not hit the token endpoint on
 *      every tool call.
 *
 * IMPORTANT: as of the September 2026 "developer token sunset", Google Ads
 * API access level (Test / Explorer / Basic / Standard) is determined by the
 * Google Cloud project that issued the OAuth client ID/secret used here, NOT
 * by the developer token string. The developer token is still accepted as an
 * HTTP header (and some tooling still expects it to be present and
 * well-formed), but Google says it is "optional and ignored" for access
 * decisions, and a future major API version may stop accepting it at all.
 * We still require and send it for maximum backward compatibility today -
 * see README.md "Novita 2026" for what this means for Alessio in practice.
 */

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Manager (MCC) customer ID, digits only, no hyphens. Optional. */
  loginCustomerId?: string;
}

const REQUIRED_VARS = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN"
] as const;

function normalizeCustomerIdDigits(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

/**
 * Reads and validates the Google Ads environment configuration.
 * Throws a precise error naming exactly which variable(s) are missing, so a
 * tool call fails with an actionable message instead of a cryptic 401.
 */
export function loadConfig(): GoogleAdsConfig {
  const missing = REQUIRED_VARS.filter(name => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Variabili d'ambiente mancanti: ${missing.join(", ")}. ` +
        "Imposta queste variabili prima di usare qualsiasi strumento google_ads_*. " +
        "Vedi il README.md (sezione configurazione) per come ottenerle."
    );
  }

  const loginCustomerIdRaw = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim();

  return {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!.trim(),
    clientId: process.env.GOOGLE_ADS_CLIENT_ID!.trim(),
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET!.trim(),
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN!.trim(),
    loginCustomerId: loginCustomerIdRaw ? normalizeCustomerIdDigits(loginCustomerIdRaw) : undefined
  };
}

interface CachedToken {
  accessToken: string;
  /** Epoch ms when this token should be considered expired. */
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
// Serializes concurrent refreshes so parallel tool calls don't each fire their
// own token request.
let refreshInFlight: Promise<string> | null = null;

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
// Refresh a little before actual expiry to absorb clock skew and in-flight latency.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

async function requestNewAccessToken(config: GoogleAdsConfig, signal: AbortSignal): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken
  });

  let response: Response;
  try {
    response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(
        "Timeout nel contattare il server OAuth2 di Google (oauth2.googleapis.com) per rinnovare il token di accesso. Riprova."
      );
    }
    throw error;
  }

  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; error_description?: string };
      detail = [parsed.error, parsed.error_description].filter(Boolean).join(": ") || text;
    } catch {
      // keep raw text
    }
    throw new Error(
      `Rinnovo del token OAuth2 fallito (HTTP ${response.status}): ${detail}. ` +
        "Controlla che GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET e GOOGLE_ADS_REFRESH_TOKEN siano corretti e che il refresh token non sia stato revocato (in tal caso va generato di nuovo seguendo il flusso OAuth2 nel README)."
    );
  }

  const parsed = JSON.parse(text) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS
  };
  return parsed.access_token;
}

/** Returns a valid OAuth2 access token, refreshing it if needed. */
export async function getAccessToken(config: GoogleAdsConfig, signal: AbortSignal): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  if (!refreshInFlight) {
    refreshInFlight = requestNewAccessToken(config, signal).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}
