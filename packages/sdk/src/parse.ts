import { isPlainObject } from "./type-guards";

/** Parse JSON and require a plain object root. */
export function parseJsonObj(text: string): Record<string, unknown> | null {
  try {
    const val: unknown = JSON.parse(text);
    if (isPlainObject(val)) {
      return val;
    }
    return null;
  } catch {
    return null;
  }
}
