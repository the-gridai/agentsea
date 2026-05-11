import * as v from "valibot";
import { parseJsonObj } from "@grid-spawn/sdk";

export { parseJsonObj };

export function parseJsonWith<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  text: string,
  schema: T,
): v.InferOutput<T> | null {
  try {
    return v.parse(schema, JSON.parse(text));
  } catch {
    return null;
  }
}

/** Schema for responses containing a `version` field (npm registry, GitHub releases). */
export const PkgVersionSchema = v.object({
  version: v.string(),
});
