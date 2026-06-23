import { isString } from "@agentsea/sdk";
import { parseJsonObj } from "./parse.js";

export const GRID_OAUTH_DEFAULT_SCOPES = [
  "account:read",
  "keys:manage",
] as const;

export type GridOAuthPollResult =
  | { status: "success"; tokens: GridOAuthTokenResponse }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "error"; message: string };

export interface GridOAuthError {
  error: string;
  error_description?: string;
}

export interface GridDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface GridOAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface GridOAuthRefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function parseOAuthError(body: string): GridOAuthError | null {
  const json = parseJsonObj(body);
  if (!json) {
    return null;
  }
  const err = isString(json.error) ? json.error : "";
  if (!err) {
    return null;
  }
  return {
    error: err,
    ...(isString(json.error_description)
      ? {
          error_description: json.error_description,
        }
      : {}),
  };
}

function parseDeviceCodeResponse(body: string): GridDeviceCodeResponse | null {
  const json = parseJsonObj(body);
  if (!json) {
    return null;
  }
  if (
    !isString(json.device_code) ||
    !isString(json.user_code) ||
    !isString(json.verification_uri) ||
    typeof json.expires_in !== "number" ||
    typeof json.interval !== "number"
  ) {
    return null;
  }
  return {
    device_code: json.device_code,
    user_code: json.user_code,
    verification_uri: json.verification_uri,
    ...(isString(json.verification_uri_complete) && json.verification_uri_complete.trim().length > 0
      ? {
          verification_uri_complete: json.verification_uri_complete,
        }
      : {}),
    expires_in: json.expires_in,
    interval: json.interval,
  };
}

function parseTokenResponse(body: string, requireRefreshToken: boolean): GridOAuthRefreshTokenResponse | null {
  const json = parseJsonObj(body);
  if (!json) {
    return null;
  }
  if (
    !isString(json.access_token) ||
    !isString(json.token_type) ||
    typeof json.expires_in !== "number"
  ) {
    return null;
  }
  const refreshToken = isString(json.refresh_token) && json.refresh_token.trim().length > 0 ? json.refresh_token : undefined;
  if (requireRefreshToken && !refreshToken) {
    return null;
  }
  const scope = isString(json.scope) ? json.scope : "";
  return {
    access_token: json.access_token,
    ...(refreshToken
      ? {
          refresh_token: refreshToken,
        }
      : {}),
    token_type: json.token_type,
    expires_in: json.expires_in,
    scope,
  };
}

function oauthErrorMessage(resp: Response, oauthError: GridOAuthError | null, fallback: string): string {
  if (oauthError?.error_description) {
    return oauthError.error_description;
  }
  if (oauthError?.error) {
    return oauthError.error;
  }
  return `${fallback} (HTTP ${resp.status})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestGridDeviceCode(
  baseUrl: string,
  clientId: string,
  scopes: readonly string[] = GRID_OAUTH_DEFAULT_SCOPES,
): Promise<GridDeviceCodeResponse> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/v1/oauth/device/code`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: scopes.join(" "),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await resp.text();
  if (!resp.ok) {
    const oauthError = parseOAuthError(body);
    throw new Error(oauthErrorMessage(resp, oauthError, "Failed to request OAuth device code"));
  }
  const parsed = parseDeviceCodeResponse(body);
  if (!parsed) {
    throw new Error("OAuth device code response was invalid");
  }
  return parsed;
}

export async function pollGridOAuthToken(
  baseUrl: string,
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number,
  onPoll?: () => void,
): Promise<GridOAuthPollResult> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/v1/oauth/token`;
  const deadline = Date.now() + expiresInSeconds * 1000;
  let currentIntervalSeconds = intervalSeconds;

  while (Date.now() < deadline) {
    onPoll?.();
    await sleep(Math.max(0, currentIntervalSeconds) * 1000);

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: deviceCode,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await resp.text();

    if (resp.ok) {
      const parsed = parseTokenResponse(body, true);
      if (!parsed?.refresh_token) {
        return {
          status: "error",
          message: "OAuth token response was invalid",
        };
      }
      return {
        status: "success",
        tokens: {
          access_token: parsed.access_token,
          refresh_token: parsed.refresh_token,
          token_type: parsed.token_type,
          expires_in: parsed.expires_in,
          scope: parsed.scope,
        },
      };
    }

    const oauthError = parseOAuthError(body);
    switch (oauthError?.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        currentIntervalSeconds = currentIntervalSeconds + 5;
        break;
      case "access_denied":
        return { status: "denied" };
      case "expired_token":
        return { status: "expired" };
      default:
        return {
          status: "error",
          message: oauthErrorMessage(resp, oauthError, "OAuth token polling failed"),
        };
    }
  }

  return { status: "expired" };
}

export async function refreshGridOAuthToken(
  baseUrl: string,
  clientId: string,
  refreshToken: string,
): Promise<GridOAuthRefreshTokenResponse> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/v1/oauth/token`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await resp.text();
  if (!resp.ok) {
    const oauthError = parseOAuthError(body);
    throw new Error(oauthErrorMessage(resp, oauthError, "OAuth token refresh failed"));
  }
  const parsed = parseTokenResponse(body, false);
  if (!parsed) {
    throw new Error("OAuth refresh response was invalid");
  }
  return parsed;
}

export async function revokeGridOAuthToken(baseUrl: string, token: string): Promise<void> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/v1/oauth/revoke`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(20_000),
  });
  if (resp.ok) {
    return;
  }
  const body = await resp.text();
  const oauthError = parseOAuthError(body);
  throw new Error(oauthErrorMessage(resp, oauthError, "OAuth token revoke failed"));
}
