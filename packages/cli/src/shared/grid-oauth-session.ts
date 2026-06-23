import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isString } from "@agentsea/sdk";
import { resolveGridExchangeApiOrigin } from "./grid-api.js";
import {
  refreshGridOAuthToken,
  type GridOAuthRefreshTokenResponse,
  type GridOAuthTokenResponse,
} from "./grid-oauth-client.js";
import { parseJsonObj } from "./parse.js";
import { getGridOAuthSessionPath } from "./paths.js";
import { tryCatch, unwrapOr } from "./result.js";
import { logDebug, logWarn } from "./ui.js";

export const DEFAULT_GRID_OAUTH_CLIENT_ID = "grid-cli-public";

export type GridOAuthKeyCache = {
  id?: string;
  key_prefix?: string;
  created_at?: string;
};

export type GridOAuthSession = {
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  oauth_base_url: string;
  oauth_scopes: string[];
  client_id: string;
  key_cache?: GridOAuthKeyCache;
};

function parseScopes(scopeInput: unknown): string[] {
  if (Array.isArray(scopeInput)) {
    const scopes = scopeInput
      .map((s) => (isString(s) ? s.trim() : ""))
      .filter(Boolean);
    return [...new Set(scopes)];
  }
  if (isString(scopeInput)) {
    const scopes = scopeInput
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set(scopes)];
  }
  return [];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function resolveGridOAuthClientId(): string {
  const override = process.env.AGENTSEA_GRID_OAUTH_CLIENT_ID?.trim();
  if (override) {
    return override;
  }
  return DEFAULT_GRID_OAUTH_CLIENT_ID;
}

export function buildGridOAuthSession(
  tokens: GridOAuthTokenResponse,
  baseUrl: string,
  clientId = resolveGridOAuthClientId(),
): GridOAuthSession {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    oauth_base_url: normalizeBaseUrl(baseUrl),
    oauth_scopes: parseScopes(tokens.scope),
    client_id: clientId,
  };
}

export function applyGridOAuthTokens(
  session: GridOAuthSession,
  tokens: GridOAuthRefreshTokenResponse,
): GridOAuthSession {
  const nextScopes = parseScopes(tokens.scope);
  return {
    ...session,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? session.refresh_token,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    oauth_scopes: nextScopes.length > 0 ? nextScopes : session.oauth_scopes,
  };
}

export function loadGridOAuthSession(): GridOAuthSession | null {
  return unwrapOr(
    tryCatch(() => {
      const raw = parseJsonObj(readFileSync(getGridOAuthSessionPath(), "utf-8"));
      if (!raw) {
        return null;
      }
      if (!isString(raw.access_token) || !isString(raw.refresh_token)) {
        return null;
      }
      const tokenExpiresAt = isString(raw.token_expires_at) ? raw.token_expires_at : "";
      if (!tokenExpiresAt) {
        return null;
      }
      const oauthBaseUrl = isString(raw.oauth_base_url) && raw.oauth_base_url.trim().length > 0
        ? normalizeBaseUrl(raw.oauth_base_url)
        : resolveGridExchangeApiOrigin();
      const clientId = isString(raw.client_id) && raw.client_id.trim().length > 0
        ? raw.client_id.trim()
        : resolveGridOAuthClientId();
      const keyCache =
        raw.key_cache && typeof raw.key_cache === "object"
          ? {
              ...(isString((raw.key_cache as Record<string, unknown>).id)
                ? {
                    id: (raw.key_cache as Record<string, unknown>).id as string,
                  }
                : {}),
              ...(isString((raw.key_cache as Record<string, unknown>).key_prefix)
                ? {
                    key_prefix: (raw.key_cache as Record<string, unknown>).key_prefix as string,
                  }
                : {}),
              ...(isString((raw.key_cache as Record<string, unknown>).created_at)
                ? {
                    created_at: (raw.key_cache as Record<string, unknown>).created_at as string,
                  }
                : {}),
            }
          : undefined;
      return {
        access_token: raw.access_token,
        refresh_token: raw.refresh_token,
        token_expires_at: tokenExpiresAt,
        oauth_base_url: oauthBaseUrl,
        oauth_scopes: parseScopes(raw.oauth_scopes),
        client_id: clientId,
        ...(keyCache
          ? {
              key_cache: keyCache,
            }
          : {}),
      };
    }),
    null,
  );
}

export function saveGridOAuthSession(session: GridOAuthSession): boolean {
  const result = tryCatch(() => {
    const path = getGridOAuthSessionPath();
    mkdirSync(dirname(path), {
      recursive: true,
      mode: 0o700,
    });
    writeFileSync(path, JSON.stringify(session, null, 2) + "\n", {
      mode: 0o600,
    });
  });
  if (!result.ok) {
    logWarn("Could not save Grid OAuth session; you may need to log in again next run.");
    logDebug(String(result.error));
    return false;
  }
  return true;
}

export function clearGridOAuthSession(): void {
  const result = tryCatch(() => rmSync(getGridOAuthSessionPath(), { force: true }));
  if (!result.ok) {
    logDebug(`Failed clearing Grid OAuth session: ${String(result.error)}`);
  }
}

export function hasGridOAuthScope(session: GridOAuthSession, scope: string): boolean {
  return session.oauth_scopes.includes(scope);
}

export function isGridOAuthSessionExpired(session: GridOAuthSession, skewSeconds = 60): boolean {
  const expiresMs = new Date(session.token_expires_at).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs <= 0) {
    return true;
  }
  return expiresMs <= Date.now() + skewSeconds * 1000;
}

export async function ensureFreshGridOAuthSession(
  session: GridOAuthSession,
  forceRefresh = false,
): Promise<GridOAuthSession> {
  if (!forceRefresh && !isGridOAuthSessionExpired(session)) {
    return session;
  }
  const refreshed = await refreshGridOAuthToken(session.oauth_base_url, session.client_id, session.refresh_token);
  const updated = applyGridOAuthTokens(session, refreshed);
  saveGridOAuthSession(updated);
  return updated;
}
