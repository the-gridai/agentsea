import { isString, toObjectArray } from "@agentsea/sdk";
import type { GridOAuthSession } from "./grid-oauth-session.js";
import { ensureFreshGridOAuthSession } from "./grid-oauth-session.js";
import { parseJsonObj } from "./parse.js";

export interface GridConsumptionApiKey {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  expires_at?: string | null;
  key?: string;
}

function parseErrorDetails(body: string): { message: string; errorCode?: string } {
  const json = parseJsonObj(body);
  if (!json) {
    return { message: "Exchange API request failed" };
  }
  const errorCode = isString(json.error) && json.error.trim().length > 0 ? json.error.trim() : undefined;
  if (isString(json.error_description) && json.error_description.trim().length > 0) {
    return {
      message: json.error_description.trim(),
      ...(errorCode
        ? {
            errorCode,
          }
        : {}),
    };
  }
  if (errorCode) {
    return {
      message: errorCode,
      errorCode,
    };
  }
  if (json.errors && typeof json.errors === "object") {
    const detail = (json.errors as Record<string, unknown>).detail;
    if (isString(detail) && detail.trim().length > 0) {
      return { message: detail.trim() };
    }
  }
  return { message: "Exchange API request failed" };
}

function parseApiKeyRow(row: unknown): GridConsumptionApiKey | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const obj = row as Record<string, unknown>;
  if (!isString(obj.id) || !isString(obj.name) || !isString(obj.key_prefix)) {
    return null;
  }
  return {
    id: obj.id,
    name: obj.name,
    key_prefix: obj.key_prefix,
    is_active: obj.is_active === true,
    ...(isString(obj.expires_at) || obj.expires_at === null
      ? {
          expires_at: obj.expires_at as string | null,
        }
      : {}),
    ...(isString(obj.key) && obj.key.trim().length > 0
      ? {
          key: obj.key.trim(),
        }
      : {}),
  };
}

function parseApiKeyList(body: string): GridConsumptionApiKey[] {
  const json = parseJsonObj(body);
  if (!json) {
    return [];
  }
  const data = toObjectArray(json.data);
  const out: GridConsumptionApiKey[] = [];
  for (const row of data) {
    const parsed = parseApiKeyRow(row);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

function parseApiKeySingle(body: string): GridConsumptionApiKey | null {
  const json = parseJsonObj(body);
  if (!json || !json.data) {
    return null;
  }
  return parseApiKeyRow(json.data);
}

async function exchangeRequest(
  session: GridOAuthSession,
  path: string,
  init: RequestInit,
): Promise<{ session: GridOAuthSession; body: string }> {
  const requestOnce = async (
    activeSession: GridOAuthSession,
  ): Promise<{ session: GridOAuthSession; status: number; body: string; errorCode?: string }> => {
    const url = `${activeSession.oauth_base_url}/api/v1${path}`;
    const resp = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeSession.access_token}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await resp.text();
    const details = parseErrorDetails(body);
    return {
      session: activeSession,
      status: resp.status,
      body,
      ...(details.errorCode
        ? {
            errorCode: details.errorCode,
          }
        : {}),
    };
  };

  let fresh = await ensureFreshGridOAuthSession(session);
  let first = await requestOnce(fresh);

  const shouldRetryAuth =
    first.status === 401 || (first.status === 403 && first.errorCode === "invalid_token");
  if (shouldRetryAuth) {
    fresh = await ensureFreshGridOAuthSession(fresh, true);
    first = await requestOnce(fresh);
  }

  if (first.status < 200 || first.status >= 300) {
    const details = parseErrorDetails(first.body);
    throw new Error(`${details.message} (HTTP ${first.status})`);
  }

  return {
    session: first.session,
    body: first.body,
  };
}

export async function listGridConsumptionApiKeys(
  session: GridOAuthSession,
): Promise<{ session: GridOAuthSession; keys: GridConsumptionApiKey[] }> {
  const result = await exchangeRequest(session, "/api-keys", {
    method: "GET",
  });
  return {
    session: result.session,
    keys: parseApiKeyList(result.body),
  };
}

export async function createGridConsumptionApiKey(
  session: GridOAuthSession,
  name: string,
  expiresAt?: string,
): Promise<{ session: GridOAuthSession; key: GridConsumptionApiKey }> {
  const payload = {
    api_key: {
      name,
      ...(expiresAt
        ? {
            expires_at: expiresAt,
          }
        : {}),
    },
  };
  const result = await exchangeRequest(session, "/api-keys", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const parsed = parseApiKeySingle(result.body);
  if (!parsed) {
    throw new Error("Exchange API key create response was invalid");
  }
  return {
    session: result.session,
    key: parsed,
  };
}

export async function revokeGridConsumptionApiKey(
  session: GridOAuthSession,
  keyId: string,
): Promise<{ session: GridOAuthSession }> {
  const result = await exchangeRequest(session, `/api-keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE",
  });
  return {
    session: result.session,
  };
}

function prefixesMatch(expectedPrefix: string, actualPrefix: string): boolean {
  const e = expectedPrefix.trim();
  const a = actualPrefix.trim();
  if (!e || !a) {
    return false;
  }
  return e.startsWith(a) || a.startsWith(e);
}

/**
 * Find a reusable cached key value if the currently-authorized account still has
 * the same active key prefix.
 */
export function findMatchingCachedGridConsumptionKey(
  session: GridOAuthSession,
  keys: readonly GridConsumptionApiKey[],
  candidateApiKey?: string,
): string | null {
  const cachedPrefix = session.key_cache?.key_prefix?.trim() ?? "";
  const candidate = candidateApiKey?.trim() ?? "";
  if (!candidate || !cachedPrefix) {
    return null;
  }
  const hasActiveMatch = keys.some((k) => k.is_active && prefixesMatch(cachedPrefix, k.key_prefix));
  return hasActiveMatch ? candidate : null;
}

export function attachGridConsumptionKeyCache(
  session: GridOAuthSession,
  key: GridConsumptionApiKey,
): GridOAuthSession {
  return {
    ...session,
    key_cache: {
      id: key.id,
      key_prefix: key.key_prefix,
      created_at: new Date().toISOString(),
    },
  };
}
