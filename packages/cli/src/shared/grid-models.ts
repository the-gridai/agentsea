// Fetch model ids exposed by The Grid OpenAI-compatible `GET /api/v1/models` catalog.

import { asyncTryCatchIf, isNetworkError } from "./result.js";

export const GRID_OPENAI_MODELS_URL = "https://api.thegrid.ai/api/v1/models";

/** Parse `{ data: [ { id: string }, … ] }` (OpenAI-style) or return []. */
export function parseGridModelsResponse(body: unknown): string[] {
  if (!body || typeof body !== "object") {
    return [];
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  const ids: string[] = [];
  for (const row of data) {
    if (row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string") {
      const id = (row as { id: string }).id.trim();
      if (id.length > 0) {
        ids.push(id);
      }
    }
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/** Returns sorted unique model ids, or [] on network / parse / non-OK response. */
export async function fetchGridModelIds(apiKey: string): Promise<string[]> {
  const key = apiKey.trim();
  if (!key) {
    return [];
  }
  const result = await asyncTryCatchIf(isNetworkError, async () => {
    const resp = await fetch(GRID_OPENAI_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      return [];
    }
    const json: unknown = await resp.json();
    return parseGridModelsResponse(json);
  });
  return result.ok ? result.data : [];
}
